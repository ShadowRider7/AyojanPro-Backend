import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { AuthController } from "./auth.controller";
import { AuthValidation } from "./auth.validation";

const router = Router();

router.post(
	"/register",
	validateRequest(AuthValidation.ClientRegisterZodSchema),
	AuthController.registerClient,
);

router.post(
	"/verify-email",
	validateRequest(AuthValidation.VerifyEmailZodSchema),
	AuthController.verifyClientEmail,
);

router.post(
	"/login",
	validateRequest(AuthValidation.LoginZodSchema),
	AuthController.loginUser,
);

router.post(
	"/google",
	validateRequest(AuthValidation.GoogleLoginZodSchema),
	AuthController.googleLogin,
);

router.post("/refresh-token", AuthController.refreshToken);

router.post(
	"/forgot-password",
	validateRequest(AuthValidation.ForgotPasswordZodSchema),
	AuthController.forgotPassword,
);

router.post(
	"/reset-password",
	validateRequest(AuthValidation.ResetPasswordZodSchema),
	AuthController.resetPassword,
);

router.get(
	"/me",
	auth(Role.ADMIN, Role.CLIENT, Role.PROFESSIONAL),
	AuthController.getMe,
);

router.post("/logout", AuthController.logout);

export const AuthRoutes = router;
