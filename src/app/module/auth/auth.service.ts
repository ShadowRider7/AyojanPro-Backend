/** biome-ignore-all lint/style/useConst: <explanation> */
import bcrypt from "bcrypt";
import crypto from "crypto";
import ejs from "ejs";
import type { TokenPayload } from "google-auth-library";
import httpStatus from "http-status";
import type { JwtPayload, SignOptions } from "jsonwebtoken";
import path from "path";
import {
	AuthProvider,
	Role,
	UserStatus,
} from "../../../generated/prisma/enums";
import config from "../../config";
import { googleClient } from "../../lib/googleAuth";
import { transporter } from "../../lib/nodemailer";
import { prisma } from "../../lib/prisma";
import { redisClient } from "../../lib/redis";
import { AppError } from "../../utils/AppError";
import { jwtUtils } from "../../utils/jwt";
import type {
	IForgotPasswordPayload,
	IGoogleLoginPayload,
	ILoginUserPayload,
	IRegisterClientPayload,
	IRequestUser,
	IResetPasswordPayload,
	IVerifyEmailPayload,
} from "./auth.interface";

const registerClient = async (payload: IRegisterClientPayload) => {
	const { name, password, client: clientData } = payload;

	const email = payload.email.trim().toLowerCase();

	const isClientExists = await prisma.user.findUnique({
		where: { email },
	});

	if (isClientExists) {
		throw new AppError(
			httpStatus.CONFLICT,
			"Client with this email already exists",
		);
	}

	const hashedPassword = await bcrypt.hash(password, 8);

	const expirationSeconds = 5 * 60;

	const otpKey = `client-registration-otp:${email}`;
	const otpValue = crypto.randomInt(100000, 1000000).toString();

	await redisClient.set(otpKey, otpValue, {
		expiration: {
			type: "EX",
			value: expirationSeconds,
		},
	});

	const clientRegistrationKey = `client-registration-data:${email}`;
	const redisClientDataPayload = {
		name,
		email,
		password: hashedPassword,
		client: clientData,
	};

	await redisClient.set(
		clientRegistrationKey,
		JSON.stringify(redisClientDataPayload),
		{
			expiration: {
				type: "EX",
				value: expirationSeconds,
			},
		},
	);

	const templatePath = path.join(
		process.cwd(),
		"src/app/templates/registration-user-otp.ejs",
	);

	const templateData = {
		name,
		email,
		otp: otpValue,
		expirationMinutes: expirationSeconds / 60,
	};

	const html = await ejs.renderFile(templatePath, templateData);

	await transporter.sendMail({
		from: config.email_sender,
		to: email,
		subject: "Email Verification",
		html,
	});
};

const verifyClientEmail = async (payload: IVerifyEmailPayload) => {
	const otp = payload.otp;
	const email = payload.email.trim().toLowerCase();

	const isUserExist = await prisma.user.findUnique({
		where: { email },
	});

	if (isUserExist?.status === "SUSPENDED") {
		throw new AppError(httpStatus.FORBIDDEN, "User is suspended");
	}

	if (isUserExist?.emailVerified) {
		throw new AppError(httpStatus.CONFLICT, "Email ALready Verified");
	}
	if (isUserExist?.isDeleted || isUserExist?.status === "DELETED") {
		throw new AppError(httpStatus.FORBIDDEN, "User is Deleted");
	}

	const otpKey = `client-registration-otp:${email}`;

	const redisOtp = await redisClient.get(otpKey);

	if (!redisOtp) {
		throw new AppError(httpStatus.BAD_REQUEST, "Invalid OTP");
	}

	if (redisOtp !== otp) {
		throw new AppError(httpStatus.BAD_REQUEST, "OTP Does Not Match");
	}

	await redisClient.del(otpKey);

	const clientRegistrationKey = `client-registration-data:${email}`;

	const redisUserData = await redisClient.get(clientRegistrationKey);

	if (!redisUserData) {
		throw new AppError(httpStatus.NOT_FOUND, "redis client data not available");
	}

	const clientPayload: IRegisterClientPayload = JSON.parse(redisUserData);

	const createdUser = await prisma.user.create({
		data: {
			name: clientPayload.name,
			email: clientPayload.email,
			password: clientPayload.password,
			role: Role.CLIENT,
			status: UserStatus.ACTIVE,
			emailVerified: true,
			client: {
				create: {
					address: clientPayload.client.address,
					bio: clientPayload.client.bio,
					city: clientPayload.client.city,
					country: clientPayload.client.country,
					phone: clientPayload.client.phone,
				},
			},
		},
		omit: { password: true },
		include: { client: true },
	});

	await redisClient.del(clientRegistrationKey);

	const templatePath = path.join(
		process.cwd(),
		"src/app/templates/user-welcome-email.ejs",
	);

	const templateData = {
		name: createdUser.name,
		role: Role.CLIENT,
	};

	const html = await ejs.renderFile(templatePath, templateData);

	await transporter.sendMail({
		from: config.email_sender,
		to: email,
		subject: "Welcome To AyojanPro System",
		html,
	});

	const { client, ...user } = createdUser;
	const jwtPayload = {
		userId: user.id,
		name: user.name,
		email: user.email,
		role: user.role,
	};

	const accessToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_access_secret,
		config.jwt_access_expires_in as SignOptions,
	);

	const refreshToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_refresh_secret,
		config.jwt_refresh_expires_in as SignOptions,
	);

	return {
		user,
		client,
		accessToken,
		refreshToken,
	};
};

const loginUser = async (payload: ILoginUserPayload) => {
	const { password } = payload;
	const email = payload.email.trim().toLowerCase();

	const user = await prisma.user.findUnique({
		where: { email },
	});

	if (!user) {
		throw new AppError(httpStatus.NOT_FOUND, "User Not Found");
	}

	if (user.isDeleted || user.status === UserStatus.DELETED) {
		throw new AppError(httpStatus.FORBIDDEN, "User is deleted");
	}

	// Only an active account may sign in — a suspended or blocked account is
	// refused as well.
	if (user.status !== UserStatus.ACTIVE) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			`User is ${user.status.toLowerCase()}`,
		);
	}

	if (user.password === null && user.googleId !== null) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"User Already Has Account Registered With Google. Try To Login With Google.",
		);
	}

	const isPasswordMatched = await bcrypt.compare(
		password,
		user.password as string,
	);

	if (!isPasswordMatched) {
		throw new AppError(httpStatus.UNAUTHORIZED, "Invalid credentials");
	}

	const jwtPayload = {
		userId: user.id,
		name: user.name,
		email: user.email,
		role: user.role,
	};

	const accessToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_access_secret,
		config.jwt_access_expires_in as SignOptions,
	);

	const refreshToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_refresh_secret,
		config.jwt_refresh_expires_in as SignOptions,
	);

	return {
		accessToken,
		refreshToken,
	};
};

const getMe = async (user: IRequestUser) => {
	const isUserExists = await prisma.user.findUnique({
		where: {
			id: user.userId,
		},
		include: {
			client: true,
			professional: true,
		},
		omit: {
			password: true,
		},
	});

	if (!isUserExists) {
		throw new AppError(httpStatus.NOT_FOUND, "User not found");
	}

	return isUserExists;
};

const refreshToken = async (token: string) => {
	const verifiedRefreshToken = jwtUtils.verifyToken(
		token,
		config.jwt_refresh_secret,
	);

	if (!verifiedRefreshToken.success || !verifiedRefreshToken.data) {
		throw new AppError(
			httpStatus.UNAUTHORIZED,
			config.node_env === "development"
				? verifiedRefreshToken.error
				: "Invalid refresh token",
		);
	}

	const data = verifiedRefreshToken.data as JwtPayload;

	const user = await prisma.user.findUnique({
		where: { id: data.userId },
	});

	if (!user) {
		throw new AppError(
			httpStatus.UNAUTHORIZED,
			"User is inactive or not found",
		);
	}

	// Only an active account may refresh its tokens.
	if (user.isDeleted || user.status !== UserStatus.ACTIVE) {
		throw new AppError(
			httpStatus.UNAUTHORIZED,
			`User is ${user.status.toLowerCase()}`,
		);
	}

	const jwtPayload = {
		userId: user.id,
		name: user.name,
		email: user.email,
		role: user.role,
	};

	const accessToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_access_secret,
		config.jwt_access_expires_in as SignOptions,
	);

	const refreshToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_refresh_secret,
		config.jwt_refresh_expires_in as SignOptions,
	);

	return {
		accessToken,
		refreshToken,
	};
};

const googleLogin = async (payload: IGoogleLoginPayload) => {
	let googleIdTokenPayload: TokenPayload | null | undefined = null;

	try {
		const ticket = await googleClient.verifyIdToken({
			idToken: payload.idToken,
			audience: config.google_client_id,
		});

		googleIdTokenPayload = ticket.getPayload();
	} catch (error) {
		console.log("Google ID Token Verification Failed", error);
		throw new AppError(
			httpStatus.UNAUTHORIZED,
			"Invalid Or Expired Google Id Token",
		);
	}

	if (!googleIdTokenPayload) {
		throw new AppError(
			httpStatus.UNAUTHORIZED,
			"Invalid Or Expired Google Id Token",
		);
	}

	if (!googleIdTokenPayload.email) {
		throw new AppError(httpStatus.BAD_REQUEST, "Google Email Not Found");
	}
	if (!googleIdTokenPayload.name) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Google Email User Name Not Found",
		);
	}

	const ifUserExistWithGoogleAuth = await prisma.user.findUnique({
		where: {
			googleId: googleIdTokenPayload.sub,
		},
	});

	let user = ifUserExistWithGoogleAuth;

	if (!ifUserExistWithGoogleAuth) {
		const ifUserExistWithCredentials = await prisma.user.findUnique({
			where: {
				email: googleIdTokenPayload.email,
				authProvider: AuthProvider.CREDENTIAL,
			},
		});

		if (ifUserExistWithCredentials) {
			if (!ifUserExistWithCredentials.emailVerified) {
				throw new AppError(httpStatus.FORBIDDEN, "Email Not Verified");
			}

			if (ifUserExistWithCredentials.status === UserStatus.SUSPENDED) {
				throw new AppError(httpStatus.FORBIDDEN, "User Is suspended");
			}

			if (
				ifUserExistWithCredentials.isDeleted ||
				ifUserExistWithCredentials.status === UserStatus.DELETED
			) {
				throw new AppError(httpStatus.FORBIDDEN, "User Is Deleted");
			}

			user = await prisma.user.update({
				where: {
					id: ifUserExistWithCredentials.id,
				},

				data: {
					googleId: googleIdTokenPayload.sub,
				},
			});
		} else {
			user = await prisma.user.create({
				data: {
					name: googleIdTokenPayload.name,
					email: googleIdTokenPayload.email,
					role: Role.CLIENT,
					googleId: googleIdTokenPayload.sub,
					authProvider: AuthProvider.GOOGLE,
					emailVerified: true,
					client: {
						create: {},
					},
				},
			});
			const templatePath = path.join(
				process.cwd(),
				"src/app/templates/user-welcome-email.ejs",
			);

			const templateData = {
				name: user.name,
				role: Role.CLIENT,
			};

			const html = await ejs.renderFile(templatePath, templateData);

			await transporter.sendMail({
				from: config.email_sender,
				to: user.email,
				subject: "Welcome To AyojanPro System",
				html,
			});
		}
	}

	if (!user) {
		throw new AppError(httpStatus.NOT_FOUND, "User Not Found");
	}

	if (user.status === UserStatus.SUSPENDED) {
		throw new AppError(httpStatus.FORBIDDEN, "User Is suspended");
	}

	if (user.isDeleted || user.status === UserStatus.DELETED) {
		throw new AppError(httpStatus.FORBIDDEN, "User Is Deleted");
	}

	const jwtPayload = {
		userId: user.id,
		name: user.name,
		email: user.email,
		role: user.role,
	};

	const accessToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_access_secret,
		config.jwt_access_expires_in as SignOptions,
	);

	const refreshToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_refresh_secret,
		config.jwt_refresh_expires_in as SignOptions,
	);

	return {
		accessToken,
		refreshToken,
	};
};

const forgotPassword = async (payload: IForgotPasswordPayload) => {
	const { email } = payload;

	const isUserExist = await prisma.user.findUnique({
		where: {
			email,
		},
	});

	if (!isUserExist) {
		throw new AppError(httpStatus.NOT_FOUND, "User Does Not Exist!");
	}

	if (isUserExist.status === "SUSPENDED") {
		throw new AppError(httpStatus.FORBIDDEN, "User is suspended");
	}

	if (!isUserExist.emailVerified) {
		throw new AppError(httpStatus.FORBIDDEN, "User Not Verified");
	}

	if (isUserExist.isDeleted || isUserExist.status === "DELETED") {
		throw new AppError(httpStatus.FORBIDDEN, "User is Deleted");
	}

	if (isUserExist.googleId && isUserExist.authProvider === "GOOGLE") {
		throw new AppError(httpStatus.BAD_REQUEST, "User Has Account With Google");
	}

	const otp = crypto.randomInt(100000, 1000000).toString();

	const key = `forgot-password-otp:${isUserExist.email}`;

	const expirationSeconds = 5 * 60;

	await redisClient.set(key, otp, {
		expiration: {
			type: "EX",
			value: expirationSeconds,
		},
	});

	const templatePath = path.join(
		process.cwd(),
		"src/app/templates/forgot-password.ejs",
	);

	const templateData = {
		name: isUserExist.name,
		otp,
		expirationMinutes: expirationSeconds / 60,
	};

	const html = await ejs.renderFile(templatePath, templateData);

	await transporter.sendMail({
		from: config.email_sender,
		to: isUserExist.email,
		subject: "Forgot Password",
		html,
	});
};

const resetPassword = async (payload: IResetPasswordPayload) => {
	const { email, otp, newPassword } = payload;

	const isUserExist = await prisma.user.findUnique({
		where: {
			email,
		},
	});

	if (!isUserExist) {
		throw new AppError(httpStatus.NOT_FOUND, "User Does Not Exist!");
	}

	if (isUserExist.status === "SUSPENDED") {
		throw new AppError(httpStatus.FORBIDDEN, "User is suspended");
	}

	if (!isUserExist.emailVerified) {
		throw new AppError(httpStatus.FORBIDDEN, "User Not Verified");
	}

	if (isUserExist.isDeleted || isUserExist.status === "DELETED") {
		throw new AppError(httpStatus.FORBIDDEN, "User is Deleted");
	}

	if (isUserExist.googleId && isUserExist.authProvider === "GOOGLE") {
		throw new AppError(httpStatus.BAD_REQUEST, "User Has Account With Google");
	}

	const key = `forgot-password-otp:${isUserExist.email}`;

	const redisOtp = await redisClient.get(key);

	if (!redisOtp) {
		throw new AppError(httpStatus.BAD_REQUEST, "Invalid OTP");
	}

	if (redisOtp !== otp) {
		throw new AppError(httpStatus.BAD_REQUEST, "OTP Does Not Match");
	}

	const hashedNewPassword = await bcrypt.hash(
		newPassword,
		Number(config.bcrypt_salt_rounds),
	);

	await prisma.user.update({
		where: {
			email: isUserExist.email,
		},
		data: {
			password: hashedNewPassword,
		},
	});

	await redisClient.del([key]);

	const templatePath = path.join(
		process.cwd(),
		"src/app/templates/reset-password-success.ejs",
	);

	const templateData = {
		name: isUserExist.name,
	};

	const html = await ejs.renderFile(templatePath, templateData);

	await transporter.sendMail({
		from: config.email_sender,
		to: isUserExist.email,
		subject: "Password Changed",
		html,
	});
};

export const AuthService = {
	registerClient,
	verifyClientEmail,
	loginUser,
	getMe,
	refreshToken,
	googleLogin,
	forgotPassword,
	resetPassword,
};
