import httpStatus from "http-status";
import {
	ApplicationStatus,
	NotificationType,
	ProposalStatus,
	Role,
	ServiceRequirementStatus,
} from "../../../generated/prisma/enums";
import { prisma } from "../../lib/prisma";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { createNotifications } from "../../utils/notifications";
import { serviceNamesMatch } from "../../utils/serviceMatch";
import type { ICreateProposal } from "./proposal.interface";

const createProposal = async (
	eventId: string,
	payload: ICreateProposal,
	user: RequestUser,
) => {
	const existingProfessional = await prisma.professional.findUnique({
		where: { userId: user.userId },
	});

	if (!existingProfessional) {
		throw new AppError(httpStatus.NOT_FOUND, "Professional Profile Not Found");
	}

	// Browsing the published events is open to every professional, but only an
	// approved one may commit to a job by sending a proposal.
	if (existingProfessional.status !== ApplicationStatus.APPROVED) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"Your application must be approved before you can send proposals.",
		);
	}

	const event = await prisma.event.findUnique({
		where: { id: eventId },
		include: { client: { select: { userId: true } } },
	});

	if (!event || event.isDeleted) {
		throw new AppError(httpStatus.NOT_FOUND, "Event Not Found");
	}

	const { items, message } = payload;

	if (!items || items.length === 0) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"At least one proposal item is required",
		);
	}

	if (items.length > 1) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"A proposal covers one service only — send one proposal per service",
		);
	}

	const requirementIds = items.map((item) => item.eventServiceRequirementId);
	const uniqueRequirementIds = new Set(requirementIds);

	if (uniqueRequirementIds.size !== requirementIds.length) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Cannot submit the same service requirement twice in one proposal",
		);
	}

	const requirements = await prisma.eventServiceRequirement.findMany({
		where: { id: { in: requirementIds }, eventId, isDeleted: false },
	});

	if (requirements.length !== uniqueRequirementIds.size) {
		throw new AppError(
			httpStatus.NOT_FOUND,
			"One or more service requirements were not found on this event",
		);
	}

	const closedRequirements = requirements.filter(
		(r) => r.status !== "OPEN" && r.status !== "PARTIALLY_FILLED",
	);

	if (closedRequirements.length > 0) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"One or more service requirements are no longer accepting proposals",
		);
	}

	const professionalServiceIds = items.map(
		(item) => item.professionalServiceId,
	);
	const uniqueProfessionalServiceIds = new Set(professionalServiceIds);

	const ownedServices = await prisma.professionalService.findMany({
		where: {
			id: { in: professionalServiceIds },
			professionalId: existingProfessional.id,
		},
	});

	if (ownedServices.length !== uniqueProfessionalServiceIds.size) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"One or more services do not belong to you",
		);
	}

	// A professional may only propose for requirements matching a service they
	// actually offer.
	const requirement = requirements[0];
	const offeredService = ownedServices[0];

	if (
		!requirement ||
		!offeredService ||
		!serviceNamesMatch(requirement.serviceName, offeredService.name)
	) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			`"${requirement?.serviceName ?? "This service"}" does not match your service "${offeredService?.name ?? "—"}" — you can only propose for services you offer`,
		);
	}

	const existingActiveItem = await prisma.proposalItem.findFirst({
		where: {
			eventServiceRequirementId: { in: requirementIds },
			proposal: { professionalId: existingProfessional.id },
			status: { in: [ProposalStatus.PENDING, ProposalStatus.ACCEPTED] },
		},
	});

	if (existingActiveItem) {
		throw new AppError(
			httpStatus.CONFLICT,
			"You already have an active proposal item for one of these requirements",
		);
	}

	const proposal = await prisma.proposal.create({
		data: {
			eventId,
			professionalId: existingProfessional.id,
			message,
			items: {
				create: items.map((item) => ({
					eventServiceRequirementId: item.eventServiceRequirementId,
					professionalServiceId: item.professionalServiceId,
					proposedAmount: item.proposedAmount,
					currency: item.currency ?? "BDT",
					proposedStartAt: item.proposedStartAt,
					proposedEndAt: item.proposedEndAt,
				})),
			},
		},
		include: {
			items: {
				include: {
					eventServiceRequirement: true,
					professionalService: true,
				},
			},
		},
	});

	const eventOwnerUserId = event.client.userId;

	try {
		await createNotifications(prisma, [
			{
				userId: eventOwnerUserId,
				title: "New Proposal Received",
				type: NotificationType.PROPOSAL,
				message: `${existingProfessional.name} has submitted a proposal for your event "${event.title}".`,
			},
		]);
	} catch (error) {
		console.error("Failed to create proposal notification:", error);
	}

	return proposal;
};

const getProposals = async (requirementId: string, user: RequestUser) => {
	const existingUser = await prisma.user.findUnique({
		where: { id: user.userId },
	});
	const allowedRoles = new Set<Role>([Role.ADMIN, Role.CLIENT]);

	if (!existingUser || !allowedRoles.has(existingUser.role)) {
		throw new AppError(
			httpStatus.NOT_FOUND,
			"You don't have permission to get the proposals",
		);
	}

	// The bids of a requirement belong to the client who owns the event it
	// belongs to, an admin may read every bid.
	if (existingUser.role === Role.CLIENT) {
		const client = await prisma.client.findUnique({
			where: { userId: user.userId },
			select: { id: true },
		});

		if (!client) {
			throw new AppError(httpStatus.NOT_FOUND, "Client Profile Not Found");
		}

		const requirement = await prisma.eventServiceRequirement.findUnique({
			where: { id: requirementId },
			select: { event: { select: { clientId: true } } },
		});

		if (!requirement) {
			throw new AppError(httpStatus.NOT_FOUND, "Service Requirement Not Found");
		}

		if (requirement.event.clientId !== client.id) {
			throw new AppError(
				httpStatus.FORBIDDEN,
				"You do not own the event this requirement belongs to",
			);
		}
	}

	const proposals = await prisma.proposal.findMany({
		where: {
			items: {
				some: { eventServiceRequirementId: requirementId },
			},
		},
		include: {
			professional: true,
			items: {
				where: { eventServiceRequirementId: requirementId },
				include: {
					eventServiceRequirement: true,
					professionalService: true,
				},
			},
		},
	});

	return proposals;
};

const getMyProposals = async (user: RequestUser) => {
	const existingProfessional = await prisma.professional.findUnique({
		where: { userId: user.userId },
	});

	if (!existingProfessional) {
		throw new AppError(httpStatus.NOT_FOUND, "Professional Profile Not Found");
	}

	const myProposals = await prisma.proposal.findMany({
		where: {
			professionalId: existingProfessional.id,
		},
		include: {
			professional: true,
			event: true,
			items: {
				include: {
					eventServiceRequirement: true,
					professionalService: true,
				},
			},
		},
		orderBy: {
			submittedAt: "desc",
		},
	});

	return myProposals;
};

const getProposalDetails = async (proposalId: string, user: RequestUser) => {
	const proposal = await prisma.proposal.findUnique({
		where: { id: proposalId },
		include: {
			professional: true,
			event: true,
			items: {
				include: {
					eventServiceRequirement: true,
					professionalService: true,
					contract: true,
				},
			},
		},
	});

	if (!proposal) {
		throw new AppError(httpStatus.NOT_FOUND, "Proposal Not Found");
	}

	// A proposal is readable by the client who owns its event, by the
	// professional who submitted it and by an admin — nobody else.
	if (user.role === Role.ADMIN) {
		return proposal;
	}

	if (user.role === Role.PROFESSIONAL) {
		const professional = await prisma.professional.findUnique({
			where: { userId: user.userId },
			select: { id: true },
		});

		if (!professional) {
			throw new AppError(
				httpStatus.NOT_FOUND,
				"Professional Profile Not Found",
			);
		}

		if (proposal.professionalId !== professional.id) {
			throw new AppError(httpStatus.FORBIDDEN, "You do not own this proposal");
		}

		return proposal;
	}

	if (user.role === Role.CLIENT) {
		const client = await prisma.client.findUnique({
			where: { userId: user.userId },
			select: { id: true },
		});

		if (!client) {
			throw new AppError(httpStatus.NOT_FOUND, "Client Profile Not Found");
		}

		if (proposal.event.clientId !== client.id) {
			throw new AppError(
				httpStatus.FORBIDDEN,
				"You do not own the event this proposal belongs to",
			);
		}

		return proposal;
	}

	throw new AppError(
		httpStatus.FORBIDDEN,
		"You do not have access to this proposal",
	);
};

const getItemWithContext = async (itemId: string) => {
	const item = await prisma.proposalItem.findUnique({
		where: { id: itemId },
		include: {
			proposal: { include: { professional: true } },
			eventServiceRequirement: {
				include: { event: { include: { client: true } } },
			},
			professionalService: true,
		},
	});

	if (!item) {
		throw new AppError(httpStatus.NOT_FOUND, "Proposal Item Not Found");
	}

	return item;
};

const acceptProposalItem = async (itemId: string, user: RequestUser) => {
	const client = await prisma.client.findUnique({
		where: { userId: user.userId },
	});

	if (!client) {
		throw new AppError(httpStatus.NOT_FOUND, "Client Profile Not Found");
	}

	const item = await getItemWithContext(itemId);
	const requirement = item.eventServiceRequirement;
	const event = requirement.event;

	if (event.clientId !== client.id) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You do not own the event this requirement belongs to",
		);
	}

	if (item.status !== ProposalStatus.PENDING) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			`This proposal item is already ${item.status.toLowerCase()}`,
		);
	}

	if (
		requirement.status !== ServiceRequirementStatus.OPEN &&
		requirement.status !== ServiceRequirementStatus.PARTIALLY_FILLED
	) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"This service requirement is no longer open",
		);
	}

	const professional = item.proposal.professional;

	if (!professional.acceptingBookings) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"This professional is not currently accepting bookings",
		);
	}

	// Schedule conflict check: the professional cannot already be committed
	// to an overlapping confirmed/in-progress contract elsewhere.
	const conflict = await prisma.contract.findFirst({
		where: {
			professionalId: professional.id,
			status: { in: ["CONFIRMED", "IN_PROGRESS"] },
			serviceStartAt: { lt: item.proposedEndAt },
			serviceEndAt: { gt: item.proposedStartAt },
		},
	});

	if (conflict) {
		throw new AppError(
			httpStatus.CONFLICT,
			"This professional already has an overlapping contract during the proposed time",
		);
	}

	const contract = await prisma.$transaction(async (tx) => {
		// Conditional flip: only succeeds if the requirement is still open.
		const { count } = await tx.eventServiceRequirement.updateMany({
			where: {
				id: requirement.id,
				status: {
					in: [
						ServiceRequirementStatus.OPEN,
						ServiceRequirementStatus.PARTIALLY_FILLED,
					],
				},
			},
			data: { status: ServiceRequirementStatus.FILLED },
		});

		if (count === 0) {
			throw new AppError(
				httpStatus.CONFLICT,
				"This requirement was just filled by another proposal",
			);
		}

		await tx.proposalItem.update({
			where: { id: item.id },
			data: { status: ProposalStatus.ACCEPTED, respondedAt: new Date() },
		});

		// Every other still-pending item competing for this requirement is
		// auto-rejected — the requirement is now spoken for.
		const competingItems = await tx.proposalItem.findMany({
			where: {
				eventServiceRequirementId: requirement.id,
				id: { not: item.id },
				status: ProposalStatus.PENDING,
			},
			include: {
				proposal: { include: { professional: true } },
			},
		});

		await tx.proposalItem.updateMany({
			where: {
				eventServiceRequirementId: requirement.id,
				id: { not: item.id },
				status: ProposalStatus.PENDING,
			},
			data: { status: ProposalStatus.REJECTED, respondedAt: new Date() },
		});

		const createdContract = await tx.contract.create({
			data: {
				clientId: client.id,
				professionalId: professional.id,
				eventId: event.id,
				eventServiceRequirementId: requirement.id,
				professionalServiceId: item.professionalServiceId,
				proposalItemId: item.id,
				agreedAmount: item.proposedAmount,
				currency: item.currency,
				serviceStartAt: item.proposedStartAt,
				serviceEndAt: item.proposedEndAt,
			},
			include: {
				client: true,
				professional: true,
				event: true,
				eventServiceRequirement: true,
				professionalService: true,
			},
		});

		await createNotifications(tx, [
			{
				userId: professional.userId,
				title: "Proposal Accepted",
				type: NotificationType.PROPOSAL,
				message: `Your proposal for "${item.eventServiceRequirement.serviceName}" has been accepted. A contract has been created.`,
			},
			...competingItems.map((competing) => ({
				userId: competing.proposal.professional.userId,
				title: "Proposal Rejected",
				type: NotificationType.PROPOSAL,
				message: `Your proposal for "${item.eventServiceRequirement.serviceName}" has been rejected because another proposal was accepted.`,
			})),
		]);

		return createdContract;
	});

	return contract;
};

const rejectProposalItem = async (itemId: string, user: RequestUser) => {
	const client = await prisma.client.findUnique({
		where: { userId: user.userId },
	});

	if (!client) {
		throw new AppError(httpStatus.NOT_FOUND, "Client Profile Not Found");
	}

	const item = await getItemWithContext(itemId);
	const event = item.eventServiceRequirement.event;

	if (event.clientId !== client.id) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You do not own the event this requirement belongs to",
		);
	}

	if (item.status !== ProposalStatus.PENDING) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			`This proposal item is already ${item.status.toLowerCase()}`,
		);
	}

	const updated = await prisma.proposalItem.update({
		where: { id: item.id },
		data: { status: ProposalStatus.REJECTED, respondedAt: new Date() },
	});

	try {
		await createNotifications(prisma, [
			{
				userId: item.proposal.professional.userId,
				title: "Proposal Rejected",
				type: NotificationType.PROPOSAL,
				message: `Your proposal for "${item.eventServiceRequirement.serviceName}" has been rejected.`,
			},
		]);
	} catch (error) {
		console.error("Failed to create proposal rejected notification:", error);
	}

	return updated;
};

const withdrawProposalItem = async (itemId: string, user: RequestUser) => {
	const professional = await prisma.professional.findUnique({
		where: { userId: user.userId },
	});

	if (!professional) {
		throw new AppError(httpStatus.NOT_FOUND, "Professional Profile Not Found");
	}

	const item = await getItemWithContext(itemId);

	if (item.proposal.professionalId !== professional.id) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You do not own this proposal item",
		);
	}

	if (item.status !== ProposalStatus.PENDING) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			`This proposal item is already ${item.status.toLowerCase()}`,
		);
	}

	const updated = await prisma.proposalItem.update({
		where: { id: item.id },
		data: { status: ProposalStatus.WITHDRAWN, respondedAt: new Date() },
	});

	try {
		await createNotifications(prisma, [
			{
				userId: item.eventServiceRequirement.event.client.userId,
				title: "Proposal Withdrawn",
				type: NotificationType.PROPOSAL,
				message: `${item.proposal.professional.name} has withdrawn their proposal for "${item.eventServiceRequirement.serviceName}".`,
			},
		]);
	} catch (error) {
		console.error("Failed to create proposal withdrawn notification:", error);
	}

	return updated;
};

/**
 * Client accepts a Proposal — accepts all pending ProposalItems,
 * creates Contracts for each, auto-rejects competing items, and
 * marks requirements as FILLED.
 */
const acceptProposal = async (proposalId: string, user: RequestUser) => {
	const client = await prisma.client.findUnique({
		where: { userId: user.userId },
	});

	if (!client) {
		throw new AppError(httpStatus.NOT_FOUND, "Client Profile Not Found");
	}

	const proposal = await prisma.proposal.findUnique({
		where: { id: proposalId },
		include: {
			items: true,
			event: true,
		},
	});

	if (!proposal) {
		throw new AppError(httpStatus.NOT_FOUND, "Proposal Not Found");
	}

	if (proposal.event.clientId !== client.id) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You do not own the event this proposal belongs to",
		);
	}

	const pendingItems = proposal.items.filter(
		(item) => item.status === ProposalStatus.PENDING,
	);

	if (pendingItems.length === 0) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"No pending items to accept in this proposal",
		);
	}

	const results = [];
	for (const item of pendingItems) {
		const result = await acceptProposalItem(item.id, user);
		results.push(result);
	}

	return results.length === 1 ? results[0] : results;
};

/**
 * Client rejects a Proposal — rejects all pending ProposalItems.
 */
const rejectProposal = async (proposalId: string, user: RequestUser) => {
	const client = await prisma.client.findUnique({
		where: { userId: user.userId },
	});

	if (!client) {
		throw new AppError(httpStatus.NOT_FOUND, "Client Profile Not Found");
	}

	const proposal = await prisma.proposal.findUnique({
		where: { id: proposalId },
		include: {
			items: true,
			event: true,
		},
	});

	if (!proposal) {
		throw new AppError(httpStatus.NOT_FOUND, "Proposal Not Found");
	}

	if (proposal.event.clientId !== client.id) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You do not own the event this proposal belongs to",
		);
	}

	const pendingItems = proposal.items.filter(
		(item) => item.status === ProposalStatus.PENDING,
	);

	if (pendingItems.length === 0) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"No pending items to reject in this proposal",
		);
	}

	const results = [];
	for (const item of pendingItems) {
		const result = await rejectProposalItem(item.id, user);
		results.push(result);
	}

	return results.length === 1 ? results[0] : results;
};

/**
 * Professional withdraws a Proposal — withdraws all pending ProposalItems.
 */
const withdrawProposal = async (proposalId: string, user: RequestUser) => {
	const professional = await prisma.professional.findUnique({
		where: { userId: user.userId },
	});

	if (!professional) {
		throw new AppError(httpStatus.NOT_FOUND, "Professional Profile Not Found");
	}

	const proposal = await prisma.proposal.findUnique({
		where: { id: proposalId },
		include: {
			items: true,
		},
	});

	if (!proposal) {
		throw new AppError(httpStatus.NOT_FOUND, "Proposal Not Found");
	}

	if (proposal.professionalId !== professional.id) {
		throw new AppError(httpStatus.FORBIDDEN, "You do not own this proposal");
	}

	const pendingItems = proposal.items.filter(
		(item) => item.status === ProposalStatus.PENDING,
	);

	if (pendingItems.length === 0) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"No pending items to withdraw in this proposal",
		);
	}

	const results = [];
	for (const item of pendingItems) {
		const result = await withdrawProposalItem(item.id, user);
		results.push(result);
	}

	return results.length === 1 ? results[0] : results;
};

export const proposalService = {
	createProposal,
	getProposals,
	getMyProposals,
	getProposalDetails,
	acceptProposal,
	rejectProposal,
	withdrawProposal,
	acceptProposalItem,
	rejectProposalItem,
	withdrawProposalItem,
};
