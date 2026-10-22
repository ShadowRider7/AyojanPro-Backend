import bcrypt from "bcrypt";
import crypto from "crypto";
import ejs from "ejs";
import httpStatus from "http-status";
import path from "path";
import {
	ApplicationStatus,
	NotificationType,
	Role,
} from "../../../generated/prisma/enums";
import type { ProfessionalWhereInput } from "../../../generated/prisma/models";
import config from "../../config";
import type { IQuery } from "../../interfaces";
import { cloudinary } from "../../lib/cloudinary";
import { transporter } from "../../lib/nodemailer";
import { prisma } from "../../lib/prisma";
import { redisClient } from "../../lib/redis";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { createNotifications } from "../../utils/notifications";
import type {
	IApplyAsProfessionalPayload,
	IApproveProfessionalPayload,
	ICreateExperience,
	ICreatePortfolioItemInput,
	ICreateService,
	ICreateSkill,
	IUpdateExperience,
	IUpdatePortfolioItemInput,
	IUpdateProfessionalProfileInput,
	IUpdateService,
	IVerifyProfessionalEmailPayload,
} from "./professional.interface";

const applyAsProfessional = async (
	payload: IApplyAsProfessionalPayload,
	resume: Express.Multer.File | null,
	additionalFiles: Express.Multer.File[],
) => {
	const isUserExists = await prisma.user.findUnique({
		where: {
			email: payload.user.email,
		},
	});

	if (isUserExists) {
		throw new AppError(
			httpStatus.CONFLICT,
			"User Already Exists With This Email",
		);
	}

	const resumeBase64 = resume?.buffer.toString("base64");
	const resumeDataUri = `data:${resume?.mimetype};base64,${resumeBase64}`;

	const resumeUploadResult = await cloudinary.uploader.upload(resumeDataUri, {
		resource_type: "auto",
	});

	const additionalFilesUploadResults = [];
	for (const file of additionalFiles) {
		const base64 = file.buffer.toString("base64");
		const dataUri = `data:${file.mimetype};base64,${base64}`;
		const result = await cloudinary.uploader.upload(dataUri, {
			resource_type: "auto",
		});
		additionalFilesUploadResults.push(result);
	}

	const randomProfessionalPassword = Math.random().toString(36).slice(-8);

	const hashedPassword = await bcrypt.hash(
		randomProfessionalPassword,
		Number(config.bcrypt_salt_rounds),
	);

	const professionalApplication = await prisma.user.create({
		data: {
			...payload.user,
			password: hashedPassword,
			role: Role.PROFESSIONAL,
			needPasswordChange: true,
			professional: {
				create: {
					name: payload.user.name,
					email: payload.user.email,
					...payload.professional,
					resume: resumeUploadResult.secure_url,
					resumePublicId: resumeUploadResult.public_id,
					additionalFiles: additionalFilesUploadResults.map((file) => ({
						url: file.secure_url,
						publicId: file.public_id,
					})),
				},
			},
		},

		omit: {
			password: true,
		},
		include: {
			professional: true,
		},
	});

	const expirationSeconds = 60 * 60;

	const otpKey = `professional-application-otp:${payload.user.email}`;
	const otpValue = crypto.randomInt(100000, 1000000).toString();

	await redisClient.set(otpKey, otpValue, {
		expiration: {
			type: "EX",
			value: expirationSeconds,
		},
	});

	const passKey = `professional-application-pass:${payload.user.email}`;
	const passValue = randomProfessionalPassword.toString();

	await redisClient.set(passKey, passValue, {
		expiration: {
			type: "EX",
			value: expirationSeconds,
		},
	});

	const templatePath = path.join(
		process.cwd(),
		"src/app/templates/registration-user-otp.ejs",
	);

	const templateData = {
		name: payload.user.name,
		email: payload.user.email,
		otp: otpValue,
		expirationMinutes: expirationSeconds / 60,
	};

	const html = await ejs.renderFile(templatePath, templateData);

	await transporter.sendMail({
		from: config.email_sender,
		to: payload.user.email,
		subject: "Professional Application - Email Verification",
		html,
	});

	return professionalApplication;
};
const verifyProfessionalEmail = async (
	payload: IVerifyProfessionalEmailPayload,
) => {
	const otp = payload.otp;
	const email = payload.email.trim().toLowerCase();

	const existingUser = await prisma.user.findUnique({
		where: { email, role: Role.PROFESSIONAL },
	});

	if (!existingUser) {
		throw new AppError(
			httpStatus.NOT_FOUND,
			"Professional Application Not Found. Please Apply Again.",
		);
	}

	if (existingUser.emailVerified) {
		throw new AppError(httpStatus.CONFLICT, "Email Already Verified");
	}

	const otpKey = `professional-application-otp:${email}`;

	const redisOtp = await redisClient.get(otpKey);

	if (!redisOtp) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"OTP Expired. Your Application Window Has Closed, Please Apply Again.",
		);
	}

	if (redisOtp !== otp) {
		throw new AppError(httpStatus.BAD_REQUEST, "OTP Does Not Match");
	}

	await redisClient.del(otpKey);

	const verifiedUser = await prisma.user.update({
		where: { id: existingUser.id },
		data: { emailVerified: true },
		omit: { password: true },
		include: { professional: true },
	});

	return verifiedUser;
};

const approveProfessional = async (
	payload: IApproveProfessionalPayload,
	reviewer: RequestUser,
) => {
	const { professionalId, status, rejectionReason } = payload;

	const existingProfessional = await prisma.professional.findUnique({
		where: { id: professionalId },
		include: { user: true },
	});

	if (!existingProfessional) {
		throw new AppError(
			httpStatus.NOT_FOUND,
			"Professional Application Not Found",
		);
	}

	if (existingProfessional.isDeleted) {
		throw new AppError(
			httpStatus.GONE,
			"Professional Application Has Been Deleted",
		);
	}

	if (!existingProfessional.user.emailVerified) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Professional Has Not Verified Their Email Yet. Application Cannot Be Reviewed.",
		);
	}

	if (existingProfessional.status !== ApplicationStatus.PENDING) {
		throw new AppError(
			httpStatus.CONFLICT,
			`Professional Application Has Already Been ${existingProfessional.status.toLowerCase()}`,
		);
	}

	if (status === ApplicationStatus.REJECTED && !rejectionReason) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Rejection Reason Is Required When Rejecting A Doctor Application",
		);
	}

	const updatedProfessional = await prisma.professional.update({
		where: { id: professionalId },
		data: {
			status,
			rejectionReason:
				status === ApplicationStatus.REJECTED ? rejectionReason : null,
			reviewedById: reviewer.userId,
			reviewedAt: new Date(),
		},
		include: {
			user: {
				omit: {
					password: true,
				},
			},
		},
	});

	const isApproved = status === ApplicationStatus.APPROVED;

	const passKey = `professional-application-pass:${updatedProfessional.email}`;
	const redisPass = await redisClient.get(passKey);

	const templatePath = path.join(
		process.cwd(),
		`src/app/templates/${
			isApproved
				? "professional-application-approved.ejs"
				: "professional-application-rejected.ejs"
		}`,
	);

	const templateData = {
		name: updatedProfessional.user.name,
		reason: updatedProfessional.rejectionReason,
		password: isApproved ? redisPass : undefined,
	};

	const html = await ejs.renderFile(templatePath, templateData);

	await transporter.sendMail({
		from: config.email_sender,
		to: updatedProfessional.user.email,
		subject: isApproved
			? "Your professional Application Has Been Approved"
			: "Your professional Application Has Been Rejected",
		html,
	});

	await redisClient.del(passKey);

	try {
		await createNotifications(prisma, [
			{
				userId: updatedProfessional.user.id,
				title: isApproved ? "Application Approved" : "Application Rejected",
				type: NotificationType.APPLICATION,
				message: isApproved
					? "Congratulations! Your professional application has been approved."
					: `Your professional application has been rejected${
							updatedProfessional.rejectionReason
								? `: ${updatedProfessional.rejectionReason}`
								: "."
						}`,
			},
		]);
	} catch (error) {
		console.error("Failed to create application status notification:", error);
	}

	return updatedProfessional;
};

const getAllProfessionals = async (query: IQuery) => {
	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;
	const sortBy = query.sortBy ? query.sortBy : "createdAt";
	const sortOrder = query.sortOrder ? query.sortOrder : "desc";

	const andConditions: ProfessionalWhereInput[] = [
		{
			user: {
				emailVerified: true,
			},
		},
	];

	//Searching
	if (query.searchTerm) {
		andConditions.push({
			OR: [
				{ name: { contains: query.searchTerm, mode: "insensitive" } },
				{ email: { contains: query.searchTerm, mode: "insensitive" } },
				{
					professionalTitle: {
						contains: query.searchTerm,
						mode: "insensitive",
					},
				},
				{
					city: {
						contains: query.searchTerm,
						mode: "insensitive",
					},
				},
				{ country: { contains: query.searchTerm, mode: "insensitive" } },
				{ bio: { contains: query.searchTerm, mode: "insensitive" } },
			],
		});
	}

	// 2. Exact Title Filtering
	if (query.professionalTitle) {
		andConditions.push({
			professionalTitle: {
				equals: query.professionalTitle,
				mode: "insensitive",
			},
		});
	}

	// 3. Location Filtering (Targeted searches)
	if (query.city) {
		andConditions.push({
			city: { equals: query.city, mode: "insensitive" },
		});
	}
	if (query.country) {
		andConditions.push({
			country: { equals: query.country, mode: "insensitive" },
		});
	}

	// 4. Experience Range Filtering (Essential for jobs/hiring portals)
	if (query.minExperience || query.maxExperience) {
		andConditions.push({
			experienceYears: {
				...(query.minExperience && {
					gte: Number(query.minExperience),
				}),
				...(query.maxExperience && {
					lte: Number(query.maxExperience),
				}),
			},
		});
	}

	// 5. Rating Filtering (e.g., "Show only 4+ star professionals")
	if (query.minRating) {
		andConditions.push({
			averageRating: {
				gte: Number(query.minRating),
			},
		});
	}

	// 6. Boolean Booking status parsing
	if (query.acceptingBookings) {
		const isAccepting = String(query.acceptingBookings) === "true";
		andConditions.push({ acceptingBookings: isAccepting });
	}

	// 7. Workflow Management Status
	if (query.status) {
		andConditions.push({
			status: query.status,
		});
	}

	andConditions.push({ isDeleted: false });

	const allProfessionals = await prisma.professional.findMany({
		where: {
			AND: andConditions.length > 0 ? andConditions : undefined,
		},

		take: limit,
		skip: skip,

		orderBy: {
			[sortBy]: sortOrder,
		},

		include: {
			user: {
				omit: {
					password: true,
				},
			},
			services: true,
			reviews: true,
			contracts: true,
			skills: true,
			proposals: true,
		},
	});

	const totalProfessionalCount = await prisma.professional.count({
		where: {
			AND: andConditions,
		},
	});

	return {
		data: allProfessionals,
		meta: {
			page: page,
			limit: limit,
			total: totalProfessionalCount,
			totalPages: Math.ceil(totalProfessionalCount / limit),
		},
	};
};

const updateProfessionalProfile = async (
	payload: IUpdateProfessionalProfileInput,
	user: RequestUser,
) => {
	const existingProfessional = await prisma.professional.findUnique({
		where: { userId: user.userId },
	});

	if (!existingProfessional) {
		throw new AppError(httpStatus.NOT_FOUND, "Professional Profile Not Found");
	}

	const updatedProfessional = await prisma.professional.update({
		where: { id: existingProfessional.id },
		data: payload,
	});

	return updatedProfessional;
};

const getAllProfessionalListPublic = async (query: IQuery) => {
	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;
	const sortBy = query.sortBy ? query.sortBy : "createdAt";
	const sortOrder = query.sortOrder ? query.sortOrder : "desc";

	const andConditions: ProfessionalWhereInput[] = [
		{ isDeleted: false },
		{ status: ApplicationStatus.APPROVED },
	];

	if (query.searchTerm) {
		andConditions.push({
			OR: [
				{ name: { contains: query.searchTerm, mode: "insensitive" } },
				{
					professionalTitle: {
						contains: query.searchTerm,
						mode: "insensitive",
					},
				},
				{ city: { contains: query.searchTerm, mode: "insensitive" } },
				{ country: { contains: query.searchTerm, mode: "insensitive" } },
			],
		});
	}

	if (query.professionalTitle) {
		andConditions.push({
			professionalTitle: {
				equals: query.professionalTitle,
				mode: "insensitive",
			},
		});
	}

	const allProfessionals = await prisma.professional.findMany({
		where: {
			AND: andConditions,
		},

		take: limit,
		skip,

		orderBy: {
			[sortBy]: sortOrder,
		},

		select: {
			id: true,
			name: true,
			professionalTitle: true,
			experienceYears: true,
			bio: true,
			averageRating: true,
			totalReviews: true,
			createdAt: true,
			user: {
				select: {
					imageUrl: true,
				},
			},
			skills: {
				select: {
					skill: {
						select: {
							id: true,
							name: true,
						},
					},
				},
			},
			experiences: true,
			services: true,
			portfolioItems: true,
			reviews: true,
		},
	});

	const totalProfessionalCount = await prisma.professional.count({
		where: { AND: andConditions },
	});

	return {
		data: allProfessionals,
		meta: {
			page,
			limit,
			total: totalProfessionalCount,
			totalPages: Math.ceil(totalProfessionalCount / limit),
		},
	};
};

const getSingleProfessionalPublicProfile = async (professionalId: string) => {
	const professional = await prisma.professional.findFirst({
		where: {
			id: professionalId,
			isDeleted: false,
			status: ApplicationStatus.APPROVED,
		},
		select: {
			id: true,
			name: true,
			professionalTitle: true,
			experienceYears: true,
			bio: true,
			averageRating: true,
			totalReviews: true,
			createdAt: true,
			user: {
				select: {
					imageUrl: true,
				},
			},
			skills: {
				select: {
					skill: {
						select: {
							id: true,
							name: true,
						},
					},
				},
			},
			experiences: true,
			services: true,
			portfolioItems: true,
			reviews: true,
		},
	});

	if (!professional) {
		throw new AppError(httpStatus.NOT_FOUND, "Professional Not Found");
	}

	return professional;
};
const addServices = async (payload: ICreateService, user: RequestUser) => {
	const existingProfessional = await prisma.professional.findUnique({
		where: { userId: user.userId },
	});

	if (!existingProfessional) {
		throw new AppError(httpStatus.NOT_FOUND, "Professional Profile Not Found");
	}
	const professionalId = existingProfessional.id;
	const { name, description, pricingNote, minimumPrice, maximumPrice } =
		payload;

	const addedService = await prisma.professionalService.create({
		data: {
			name,
			description,
			pricingNote,
			minimumPrice,
			maximumPrice,
			professionalId,
		},
		include: {
			professional: true,
		},
	});

	return addedService;
};
const getMyServices = async (user: RequestUser) => {
	const existingProfessional = await prisma.professional.findUnique({
		where: { userId: user.userId },
	});

	if (!existingProfessional) {
		throw new AppError(httpStatus.NOT_FOUND, "Professional Profile Not Found");
	}

	const myServices = await prisma.professionalService.findMany({
		where: {
			professionalId: existingProfessional.id,
		},
		include: {
			contracts: true,
			professional: true,
			proposalItems: true,
			_count: true,
		},
	});
	return myServices;
};
const updateService = async (
	payload: IUpdateService,
	serviceId: string,
	user: RequestUser,
) => {
	const existingProfessional = await prisma.professional.findUnique({
		where: { userId: user.userId },
	});

	if (!existingProfessional) {
		throw new AppError(httpStatus.NOT_FOUND, "Professional Profile Not Found");
	}
	const existingService = await prisma.professionalService.findUnique({
		where: {
			id: serviceId,
		},
	});
	if (!existingService) {
		throw new AppError(httpStatus.NOT_FOUND, "Service not found");
	}
	const { name, description, pricingNote, minimumPrice, maximumPrice } =
		payload;
	const updatedService = await prisma.professionalService.update({
		where: {
			id: serviceId,
		},
		data: {
			name,
			description,
			pricingNote,
			minimumPrice,
			maximumPrice,
		},
		include: {
			professional: true,
			_count: true,
		},
	});
	return updatedService;
};
const deleteService = async (serviceId: string, user: RequestUser) => {
	const existingProfessional = await prisma.professional.findUnique({
		where: { userId: user.userId },
	});

	if (!existingProfessional) {
		throw new AppError(httpStatus.NOT_FOUND, "Professional Profile Not Found");
	}

	const existingService = await prisma.professionalService.findUnique({
		where: {
			id: serviceId,
		},
	});
	if (!existingService) {
		throw new AppError(httpStatus.NOT_FOUND, "Service is already deleted");
	}
	await prisma.professionalService.delete({
		where: {
			id: serviceId,
		},
	});
};

const addSkill = async (payload: ICreateSkill, user: RequestUser) => {
	const existingProfessional = await prisma.professional.findUnique({
		where: { userId: user.userId },
	});

	if (!existingProfessional) {
		throw new AppError(httpStatus.NOT_FOUND, "Professional Profile Not Found");
	}
	const professionalId = existingProfessional.id;
	const { name, description } = payload;

	const addedSkill = await prisma.skill.create({
		data: {
			name,
			description,
			professionals: {
				create: {
					professionalId,
				},
			},
		},
		include: {
			professionals: true,
		},
	});

	return addedSkill;
};

const deleteSkill = async (skillId: string, user: RequestUser) => {
	const existingProfessional = await prisma.professional.findUnique({
		where: { userId: user.userId },
	});

	if (!existingProfessional) {
		throw new AppError(httpStatus.NOT_FOUND, "Professional Profile Not Found");
	}

	const existingSKill = await prisma.skill.findUnique({
		where: {
			id: skillId,
		},
	});
	if (!existingSKill) {
		throw new AppError(httpStatus.NOT_FOUND, "Skill is already deleted");
	}
	await prisma.skill.delete({
		where: {
			id: skillId,
		},
	});
};

const createPortfolio = async (
	payload: ICreatePortfolioItemInput,
	mediaFile: Express.Multer.File,
	user: RequestUser,
) => {
	const existingProfessional = await prisma.professional.findUnique({
		where: { userId: user.userId },
	});

	if (!existingProfessional) {
		throw new AppError(httpStatus.NOT_FOUND, "Professional Profile Not Found");
	}

	const mediaBase64 = mediaFile?.buffer.toString("base64");
	const mediaDataUri = `data:${mediaFile?.mimetype};base64,${mediaBase64}`;

	const mediaUploadResult = await cloudinary.uploader.upload(mediaDataUri, {
		resource_type: "auto",
	});

	const createdPortfolio = await prisma.portfolioItem.create({
		data: {
			title: payload.title,
			description: payload.description,
			eventType: payload.eventType,
			workDate: payload.workDate ? new Date(payload.workDate) : null,
			externalUrl: payload.externalUrl,
			mediaUrl: mediaUploadResult.secure_url,
			publicId: mediaUploadResult.public_id,
			professionalId: existingProfessional.id,
		},
		include: {
			professional: true,
		},
	});
	return createdPortfolio;
};

const getMyPortfolioItems = async (user: RequestUser) => {
	const existingProfessional = await prisma.professional.findUnique({
		where: { userId: user.userId },
	});

	if (!existingProfessional) {
		throw new AppError(httpStatus.NOT_FOUND, "Professional Profile Not Found");
	}

	const myPortfolioItems = await prisma.portfolioItem.findMany({
		where: {
			professionalId: existingProfessional.id,
		},
	});
	return myPortfolioItems;
};

const updatePortfolioItem = async (
	payload: IUpdatePortfolioItemInput,
	portfolioId: string,
	user: RequestUser,
) => {
	const existingProfessional = await prisma.professional.findUnique({
		where: { userId: user.userId },
	});

	if (!existingProfessional) {
		throw new AppError(httpStatus.NOT_FOUND, "Professional Profile Not Found");
	}
	const existingPortfolio = await prisma.portfolioItem.findUnique({
		where: {
			id: portfolioId,
		},
	});
	if (!existingPortfolio) {
		throw new AppError(httpStatus.NOT_FOUND, "Portfolio not found");
	}
	const updatedPortfolio = await prisma.portfolioItem.update({
		where: {
			id: portfolioId,
		},
		data: payload,
	});
	return updatedPortfolio;
};

const deletePortfolio = async (portfolioId: string, user: RequestUser) => {
	const existingProfessional = await prisma.professional.findUnique({
		where: { userId: user.userId },
	});

	if (!existingProfessional) {
		throw new AppError(httpStatus.NOT_FOUND, "Professional Profile Not Found");
	}
	const existingPortfolio = await prisma.portfolioItem.findUnique({
		where: {
			id: portfolioId,
		},
	});
	if (!existingPortfolio) {
		throw new AppError(httpStatus.NOT_FOUND, "Portfolio is already deleted");
	}

	await prisma.portfolioItem.delete({
		where: {
			id: portfolioId,
		},
	});
};

const addExperience = async (payload: ICreateExperience, user: RequestUser) => {
	const existingProfessional = await prisma.professional.findUnique({
		where: { userId: user.userId },
	});

	if (!existingProfessional) {
		throw new AppError(httpStatus.NOT_FOUND, "Professional Profile Not Found");
	}
	const professionalId = existingProfessional.id;

	const addedExperience = await prisma.experience.create({
		data: {
			...payload,
			professionalId,
		},
		include: {
			professional: true,
		},
	});

	return addedExperience;
};

const updateExperience = async (
	payload: IUpdateExperience,
	experienceId: string,
	user: RequestUser,
) => {
	const existingProfessional = await prisma.professional.findUnique({
		where: { userId: user.userId },
	});

	if (!existingProfessional) {
		throw new AppError(httpStatus.NOT_FOUND, "Professional Profile Not Found");
	}
	const existingExperience = await prisma.experience.findUnique({
		where: {
			id: experienceId,
		},
	});
	if (!existingExperience) {
		throw new AppError(httpStatus.NOT_FOUND, "Experience not found");
	}
	const updatedExperience = await prisma.experience.update({
		where: {
			id: experienceId,
		},
		data: {
			...payload,
		},
		include: {
			professional: true,
		},
	});
	return updatedExperience;
};
const deleteExperience = async (experienceId: string, user: RequestUser) => {
	const existingProfessional = await prisma.professional.findUnique({
		where: { userId: user.userId },
	});

	if (!existingProfessional) {
		throw new AppError(httpStatus.NOT_FOUND, "Professional Profile Not Found");
	}

	const existingExperience = await prisma.experience.findUnique({
		where: {
			id: experienceId,
		},
	});
	if (!existingExperience) {
		throw new AppError(httpStatus.NOT_FOUND, "Experience is already deleted");
	}
	await prisma.experience.delete({
		where: {
			id: experienceId,
		},
	});
};

export const professionalService = {
	applyAsProfessional,
	verifyProfessionalEmail,
	approveProfessional,
	updateProfessionalProfile,
	addServices,
	getMyServices,
	updateService,
	deleteService,
	addSkill,
	deleteSkill,
	createPortfolio,
	getMyPortfolioItems,
	updatePortfolioItem,
	deletePortfolio,
	getAllProfessionals,
	getSingleProfessionalPublicProfile,
	getAllProfessionalListPublic,
	addExperience,
	updateExperience,
	deleteExperience,
};
