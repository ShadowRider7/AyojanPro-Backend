import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { proposalController } from "./proposal.controller";
import { proposalValidator } from "./proposal.validation";

const router = Router();

router.post(
	"/events/:eventId",
	auth(Role.PROFESSIONAL),
	validateRequest(proposalValidator.createProposalZodSchema),
	proposalController.createProposal,
);

router.get(
	"/requirements/:requirementId",
	auth(Role.CLIENT, Role.ADMIN),
	proposalController.getProposals,
);

router.get("/me", auth(Role.PROFESSIONAL), proposalController.getMyProposals);

router.get(
	"/:id",
	auth(Role.CLIENT, Role.PROFESSIONAL, Role.ADMIN),
	proposalController.getProposalDetails,
);

router.patch(
	"/:proposalId/accept",
	auth(Role.CLIENT),
	proposalController.acceptProposal,
);

router.patch(
	"/:proposalId/reject",
	auth(Role.CLIENT),
	proposalController.rejectProposal,
);

router.patch(
	"/:proposalId/withdraw",
	auth(Role.PROFESSIONAL),
	proposalController.withdrawProposal,
);

export const proposalRoutes = router;
