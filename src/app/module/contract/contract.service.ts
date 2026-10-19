import httpStatus from "http-status";
import {
	ContractStatus,
	NotificationType,
	ProposalStatus,
	Role,
} from "../../../generated/prisma/enums";
import { prisma } from "../../lib/prisma";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { createNotifications } from "../../utils/notifications";
import { releaseEscrowedPayments } from "../payment/escrow.service";
import {
	createContractRefund,
	dispatchRefund,
	isRefundablePayment,
} from "../payment/refund.service";
import type { IAttachDeliverable } from "./contract.interface";
import {
	isProfessionalCancellationWindowOpen,
	PROFESSIONAL_CANCEL_NOTICE_MESSAGE,
	shouldRefundClient,
} from "./contract.policy";

const CONTRACT_INCLUDE = {
	client: true,
	professional: true,
	event: true,
	eventServiceRequirement: true,
	professionalService: true,
	proposalItem: true,
	payments: true,
	deliverables: true,
	refunds: true,
} as const;

const getAuthorizedContract = async (contractId: string, user: RequestUser) => {
	const contract = await prisma.contract.findUnique({
		where: { id: contractId },
		include: CONTRACT_INCLUDE,
	});

	if (!contract) {
		throw new AppError(httpStatus.NOT_FOUND, "Contract Not Found");
	}

	if (user.role === Role.ADMIN) {
		return contract;
	}

	if (user.role === Role.CLIENT && contract.client.userId === user.userId) {
		return contract;
	}

	if (
		user.role === Role.PROFESSIONAL &&
		contract.professional.userId === user.userId
	) {
		return contract;
	}

	throw new AppError(
		httpStatus.FORBIDDEN,
		"You do not have access to this contract",
	);
};

const listContracts = async (user: RequestUser) => {
	if (user.role === Role.CLIENT) {
		const client = await prisma.client.findUnique({
			where: { userId: user.userId },
		});
		if (!client)
			throw new AppError(httpStatus.NOT_FOUND, "Client Profile Not Found");

		return prisma.contract.findMany({
			where: { clientId: client.id },
			include: CONTRACT_INCLUDE,
			orderBy: { createdAt: "desc" },
		});
	}

	if (user.role === Role.PROFESSIONAL) {
		const professional = await prisma.professional.findUnique({
			where: { userId: user.userId },
		});
		if (!professional)
			throw new AppError(
				httpStatus.NOT_FOUND,
				"Professional Profile Not Found",
			);

		return prisma.contract.findMany({
			where: { professionalId: professional.id },
			include: CONTRACT_INCLUDE,
			orderBy: { createdAt: "desc" },
		});
	}

	// ADMIN sees everything.
	return prisma.contract.findMany({
		include: CONTRACT_INCLUDE,
		orderBy: { createdAt: "desc" },
	});
};

const getContractDetails = async (contractId: string, user: RequestUser) => {
	return getAuthorizedContract(contractId, user);
};

const CANCELLABLE_STATUSES = new Set(["PENDING", "CONFIRMED", "IN_PROGRESS"]);

const CANCELLER_LABEL: Record<Role, string> = {
	[Role.CLIENT]: "the client",
	[Role.PROFESSIONAL]: "the professional",
	[Role.ADMIN]: "an admin",
};

const cancelContract = async (
	contractId: string,
	reason: string | undefined,
	user: RequestUser,
) => {
	const contract = await getAuthorizedContract(contractId, user);

	if (!CANCELLABLE_STATUSES.has(contract.status)) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			`A contract in status ${contract.status} cannot be cancelled`,
		);
	}

	// A professional may only drop a booked slot while it is still at least
	// 48 hours away — inside that window the client raises a dispute instead.
	if (
		user.role === Role.PROFESSIONAL &&
		!isProfessionalCancellationWindowOpen(contract.serviceStartAt)
	) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			PROFESSIONAL_CANCEL_NOTICE_MESSAGE,
		);
	}

	// The client is refunded when the contract is cancelled by the professional
	// (or by an admin): they did nothing wrong, so the money goes back to them.
	// A client that cancels their own contract is not refunded.
	const refundablePayment = shouldRefundClient(user.role)
		? contract.payments.find((payment) => isRefundablePayment(payment))
		: undefined;

	const { refund } = await prisma.$transaction(async (tx) => {
		const cancelled = await tx.contract.update({
			where: { id: contractId },
			data: {
				status: ContractStatus.CANCELLED,
				cancelledAt: new Date(),
				cancellationReason: reason,
				cancelledByUserId: user.userId,
				cancelledByRole: user.role,
			},
		});

		// Cancelling frees the professional's schedule and re-opens the
		// requirement for other proposals (see requirements doc §28).
		await tx.eventServiceRequirement.update({
			where: { id: contract.eventServiceRequirementId },
			data: { status: "OPEN" },
		});

		// The acceptance behind the contract is undone as well: a professional
		// that cancels withdraws their own offer, a client (or admin)
		// cancellation rejects it. Either way the item stops being an active
		// proposal, so the professional can propose for the re-opened
		// requirement again.
		const proposalStatus =
			user.role === Role.PROFESSIONAL
				? ProposalStatus.WITHDRAWN
				: ProposalStatus.REJECTED;

		await tx.proposalItem.updateMany({
			where: {
				id: contract.proposalItemId,
				status: ProposalStatus.ACCEPTED,
			},
			data: {
				status: proposalStatus,
				respondedAt: new Date(),
			},
		});

		let createdRefund = null;

		if (refundablePayment) {
			createdRefund = await createContractRefund(tx, {
				contractId,
				clientId: contract.clientId,
				payment: refundablePayment,
				reason:
					reason?.trim() ||
					`The contract was cancelled by ${CANCELLER_LABEL[user.role]}.`,
			});
		}

		const cancelMessage = `The contract for "${contract.event.title}" has been cancelled by ${CANCELLER_LABEL[user.role]}${reason ? `: ${reason}` : "."}`;

		const refundMessage = createdRefund
			? ` A refund of ${createdRefund.amount.toFixed(2)} ${createdRefund.currency} has been issued to your bKash account.`
			: "";

		// The proposal behind the contract moves with it — the professional
		// hears about their own proposal, the client about theirs.
		const proposalState = proposalStatus.toLowerCase();

		const notifications = [];
		if (user.role !== Role.PROFESSIONAL) {
			notifications.push({
				userId: contract.professional.userId,
				title: "Contract Cancelled",
				type: NotificationType.CONTRACT,
				message: `${cancelMessage} Your proposal is now marked ${proposalState}.`,
			});
		}
		if (user.role !== Role.CLIENT) {
			notifications.push({
				userId: contract.client.userId,
				title: "Contract Cancelled",
				type: NotificationType.CONTRACT,
				message: `${cancelMessage}${refundMessage} The professional's proposal is now marked ${proposalState}.`,
			});
		}

		await createNotifications(tx, notifications);

		return { refund: createdRefund, cancelled };
	});

	// The refund is handed over to the payment provider outside of the
	// transaction — the cancellation itself is already committed, so a failing
	// provider call must not fail the whole request.
	if (refund) {
		try {
			await dispatchRefund(refund.id);
		} catch (error) {
			console.error("Refund dispatch failed", error);
		}
	}

	return prisma.contract.findUnique({
		where: { id: contractId },
		include: CONTRACT_INCLUDE,
	});
};

const attachDeliverable = async (
	contractId: string,
	payload: IAttachDeliverable,
	user: RequestUser,
) => {
	const contract = await getAuthorizedContract(contractId, user);

	if (
		user.role !== Role.PROFESSIONAL ||
		contract.professional.userId !== user.userId
	) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"Only the assigned professional can submit a deliverable",
		);
	}

	if (
		contract.status !== ContractStatus.CONFIRMED &&
		contract.status !== ContractStatus.IN_PROGRESS
	) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Deliverables can only be submitted while the contract is confirmed or in progress",
		);
	}

	if (!payload.externalUrl || payload.externalUrl.length === 0) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"At least one deliverable link is required",
		);
	}

	const result = await prisma.$transaction(async (tx) => {
		const deliverable = await tx.deliverable.upsert({
			where: { contractId },
			create: {
				contractId,
				title: payload.title,
				description: payload.description,
				externalUrl: payload.externalUrl,
			},
			update: {
				title: payload.title,
				description: payload.description,
				externalUrl: payload.externalUrl,
			},
		});

		const updatedContract = await tx.contract.update({
			where: { id: contractId },
			data: { status: "DELIVERED" },
		});

		await createNotifications(tx, [
			{
				userId: contract.client.userId,
				title: "Deliverable Submitted",
				type: NotificationType.CONTRACT,
				message: `${contract.professional.name} has submitted deliverables for the contract "${contract.event.title}".`,
			},
		]);

		return { deliverable, contract: updatedContract };
	});

	return result;
};

const getDeliverable = async (contractId: string, user: RequestUser) => {
	await getAuthorizedContract(contractId, user);

	const deliverable = await prisma.deliverable.findUnique({
		where: { contractId },
	});
	return deliverable;
};

const markContractCompleted = async (contractId: string) => {
	return prisma.$transaction(async (tx) => {
		const contract = await tx.contract.update({
			where: { id: contractId },
			data: { status: ContractStatus.COMPLETED, completedAt: new Date() },
			include: { client: true, professional: true, event: true },
		});

		await tx.eventServiceRequirement.update({
			where: { id: contract.eventServiceRequirementId },
			data: { status: "COMPLETED" },
		});

		// The contract is completed, so the money the platform held in escrow
		// is released to the professional.
		await releaseEscrowedPayments(tx, contractId);

		await createNotifications(tx, [
			{
				userId: contract.client.userId,
				title: "Contract Completed",
				type: NotificationType.CONTRACT,
				message: `The contract for "${contract.event.title}" has been completed successfully.`,
			},
			{
				userId: contract.professional.userId,
				title: "Contract Completed",
				type: NotificationType.CONTRACT,
				message: `The contract for "${contract.event.title}" has been completed successfully. The escrowed amount is released to you.`,
			},
		]);

		return contract;
	});
};

const completeContract = async (contractId: string, user: RequestUser) => {
	const contract = await getAuthorizedContract(contractId, user);

	if (contract.status !== ContractStatus.DELIVERED) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Contract must be DELIVERED before it can be marked completed",
		);
	}

	// The final payment is settled but still held by the platform (escrow) —
	// completing the contract releases it to the professional.
	const finalPaymentSettled = contract.payments.some(
		(p) =>
			p.stage === "FINAL" &&
			(p.status === "ESCROWED" || p.status === "COMPLETED"),
	);

	if (!finalPaymentSettled) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Final payment must be settled before the contract can be marked completed",
		);
	}

	return markContractCompleted(contractId);
};

export const contractService = {
	listContracts,
	getContractDetails,
	cancelContract,
	attachDeliverable,
	getDeliverable,
	completeContract,
	markContractCompleted,
};
