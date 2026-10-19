import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { adminController } from "./admin.controller";
import { adminValidator } from "./admin.validator";

const router = Router();

router.get("/users", auth(Role.ADMIN), adminController.listUsers);

router.get("/events", auth(Role.ADMIN), adminController.listEvents);

router.get("/contracts", auth(Role.ADMIN), adminController.listContracts);

router.get("/payments", auth(Role.ADMIN), adminController.listPayments);

router.get("/refunds", auth(Role.ADMIN), adminController.listRefunds);

router.patch(
	"/refunds/:id/settle",
	auth(Role.ADMIN),
	validateRequest(adminValidator.settleRefundZodSchema),
	adminController.settleRefund,
);

router.patch(
	"/users/:id/status",
	auth(Role.ADMIN),
	validateRequest(adminValidator.updateUserStatusZodSchema),
	adminController.updateUserStatus,
);

export const adminRoutes = router;
