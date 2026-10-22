import type { Request, Response } from "express";
import httpStatus from "http-status";
import config from "../../config";
import { AppError } from "../../utils/AppError";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import type { IRequestUser } from "./auth.interface";
import { AuthService } from "./auth.service";

/**
 * The attributes the auth cookies are written with.
 *
 * In production the browser client and the API sit on different sites, so the
 * cookies have to be `SameSite=None; Secure` to be stored at all.
 *
 * Clearing a cookie has to repeat the very same attributes. A deletion cookie
 * without `SameSite=None; Secure` is treated as `Lax` by the browser, and a
 * `Lax` cookie is refused in a cross-site response — so the session survived
 * the logout and the user stayed signed in.
 */
const authCookieOptions = {
	httpOnly: true,
	secure: config.node_env !== "development",
	sameSite: config.node_env === "development" ? ("lax" as const) : ("none" as const),
};

const ACCESS_TOKEN_MAX_AGE = 1000 * 60 * 60 * 24; // 24 hour or 1 day
const REFRESH_TOKEN_MAX_AGE = 1000 * 60 * 60 * 24 * 7; // 7 days

const setAuthCookies = (
	res: Response,
	accessToken: string,
	refreshToken: string,
) => {
	res.cookie("accessToken", accessToken, {
		...authCookieOptions,
		maxAge: ACCESS_TOKEN_MAX_AGE,
	});
	res.cookie("refreshToken", refreshToken, {
		...authCookieOptions,
		maxAge: REFRESH_TOKEN_MAX_AGE,
	});
};

const clearAuthCookies = (res: Response) => {
	res.clearCookie("accessToken", authCookieOptions);
	res.clearCookie("refreshToken", authCookieOptions);
};

const registerClient = catchAsync(async (req: Request, res: Response) => {
	await AuthService.registerClient(req.body);
	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message:
			"Client registration successful. Verification OTP sent to your email",
		data: null,
	});
});

const verifyClientEmail = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body;

	const result = await AuthService.verifyClientEmail(payload);

	const { accessToken, refreshToken, user, client } = result;

	setAuthCookies(res, accessToken, refreshToken);

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Email Verified Successfully",
		data: {
			accessToken,
			refreshToken,
			client,
			user,
		},
	});
});

const loginUser = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body;
	const result = await AuthService.loginUser(payload);
	const { accessToken, refreshToken } = result;

	setAuthCookies(res, accessToken, refreshToken);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "User logged in successfully",
		data: {
			accessToken,
			refreshToken,
		},
	});
});

const getMe = catchAsync(async (req: Request, res: Response) => {
	const user = req.user as unknown as IRequestUser;

	if (!user) {
		throw new AppError(
			httpStatus.UNAUTHORIZED,
			"User information is missing in the request",
		);
	}

	const result = await AuthService.getMe(user);
	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "User profile fetched successfully",
		data: result,
	});
});

const refreshToken = catchAsync(async (req: Request, res: Response) => {
	if (!req.cookies.refreshToken) {
		throw new AppError(httpStatus.UNAUTHORIZED, "Refresh token is missing");
	}
	const result = await AuthService.refreshToken(req.cookies.refreshToken);
	const { accessToken, refreshToken: newRefreshToken } = result;

	setAuthCookies(res, accessToken, newRefreshToken);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "New tokens generated successfully",
		data: {
			accessToken,
			refreshToken: newRefreshToken,
		},
	});
});
const googleLogin = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body;

	const result = await AuthService.googleLogin(payload);

	const { accessToken, refreshToken } = result;

	setAuthCookies(res, accessToken, refreshToken);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "New tokens generated successfully",
		data: {
			accessToken,
			refreshToken,
		},
	});
});
const forgotPassword = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body;

	await AuthService.forgotPassword(payload);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: `OTP Sent To Email : ${payload.email}`,
		data: null,
	});
});
const resetPassword = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body;

	await AuthService.resetPassword(payload);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Password Changed Successfully",
		data: null,
	});
});
const logout = catchAsync(async (req: Request, res: Response) => {
	clearAuthCookies(res);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "User Logged Out Successfully",
		data: null,
	});
});

export const AuthController = {
	registerClient,
	verifyClientEmail,
	loginUser,
	getMe,
	refreshToken,
	googleLogin,
	forgotPassword,
	resetPassword,
	logout,
};
