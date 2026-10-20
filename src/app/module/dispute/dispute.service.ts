import httpStatus from "http-status";
import type { Prisma } from "../../../generated/prisma/client";
import {
	ContractStatus,
	DisputeRaisedBy,
	DisputeStatus,
	NotificationType,
	Role,
} from "../../../generated/prisma/enums";
import type { IQuery } from "../../interfaces";
import { prisma } from "../../lib/prisma";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { createNotifications } from "../../utils/notifications";
import {
	createContractRefund,
	dispatchRefund,
	isRefundablePayment,
} from "../payment/refund.service";
import type {
	IEvidenceInput,
	IRaiseDispute,
	IUpdateDisputeStatus,
} from "./dispute.interface";

const DISPUTE_INCLUDE = {
	contract: {
		include: { client: true, professional: true },
	},
	// The user fields are selected explicitly so the password hash is never
	// part of a response.
	raisedBy: {
		select: {
			id: true,
			name: true,
			email: true,
			imageUrl: true,
			role: true,
			createdAt: true,
		},
	},
	resolvedBy: {
		select: {
			id: true,
			name: true,
			email: true,
			imageUrl: true,
			role: true,
			createdAt: true,
		},
	},
} as const;

const TERMINAL_STATUSES = new Set<DisputeStatus>([
	DisputeStatus.RESOLVED,
	DisputeStatus.REJECTED,
	DisputeStatus.CLOSED,
]);

const getAuthorizedDispute = async (disputeId: string, user: RequestUser) => {
	const dispute = await prisma.dispute.findUnique({
		where: { id: disputeId },
		include: DISPUTE_INCLUDE,
	});

	if (!dispute) {
		throw new AppError(httpStatus.NOT_FOUND, "Dispute Not Found");
	}

	if (user.role === Role.ADMIN) return dispute;

	const { client, professional } = dispute.contract;
	const isParty =
		(user.role === Role.CLIENT && client.userId === user.userId) ||
		(user.role === Role.PROFESSIONAL && professional.userId === user.userId);

	if (!isParty) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You do not have access to this dispute",
		);
	}

	return dispute;
};

const raiseDispute = async (
	contractId: string,
	payload: IRaiseDispute,
	evidences: IEvidenceInput[],
	user: RequestUser,
) => {
	const contract = await prisma.contract.findUnique({
		where: { id: contractId },
		include: { client: true, professional: true, event: true, disputes: true },
	});

	if (!contract) {
		throw new AppError(httpStatus.NOT_FOUND, "Contract Not Found");
	}

	let raisedByRole: DisputeRaisedBy;

	if (user.role === Role.CLIENT && contract.client.userId === user.userId) {
		raisedByRole = DisputeRaisedBy.CLIENT;
	} else if (
		user.role === Role.PROFESSIONAL &&
		contract.professional.userId === user.userId
	) {
		raisedByRole = DisputeRaisedBy.PROFESSIONAL;
	} else {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"Only the client or professional on this contract can raise a dispute",
		);
	}

	if (contract.status === ContractStatus.CANCELLED) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Cannot raise a dispute on a cancelled contract",
		);
	}

	if (evidences.length === 0) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"At least one piece of evidence is required to raise a dispute",
		);
	}

	const alreadyActive = contract.disputes.some(
		(d) =>
			d.status === DisputeStatus.OPEN ||
			d.status === DisputeStatus.UNDER_REVIEW,
	);

	if (alreadyActive) {
		throw new AppError(
			httpStatus.CONFLICT,
			"This contract already has an active dispute",
		);
	}

	const dispute = await prisma.$transaction(async (tx) => {
		const created = await tx.dispute.create({
			data: {
				contractId,
				raisedById: user.userId,
				raisedByRole,
				reason: payload.reason,
				description: payload.description,
				evidences: evidences as unknown as Prisma.InputJsonValue,
			},
			include: DISPUTE_INCLUDE,
		});

		// Freeze the contract while the dispute is being looked into.
		await tx.contract.update({
			where: { id: contractId },
			data: { status: ContractStatus.DISPUTED },
		});

		await createNotifications(tx, [
			{
				userId:
					raisedByRole === DisputeRaisedBy.CLIENT
						? contract.professional.userId
						: contract.client.userId,
				title: "Dispute Raised",
				type: NotificationType.DISPUTE,
				message: `A dispute has been raised on the contract for "${contract.event.title}" by the ${raisedByRole.toLowerCase()}.`,
			},
		]);

		return created;
	});

	return dispute;
};

const listDisputes = async (user: RequestUser, query: IQuery) => {
	if (user.role !== Role.ADMIN) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"Only admins can list all disputes",
		);
	}

	const { status } = query;

	return prisma.dispute.findMany({
		where: status ? { status: status as DisputeStatus } : undefined,
		include: DISPUTE_INCLUDE,
		orderBy: { createdAt: "desc" },
	});
};

const getDisputeDetails = async (disputeId: string, user: RequestUser) => {
	return getAuthorizedDispute(disputeId, user);
};

/**
 * Admin-only non-resolving status transitions (OPEN, UNDER_REVIEW,
 * REJECTED, CLOSED). RESOLVED is handled separately by resolveDispute,
 * since it also records the resolution text and updates the contract.
 *
 * NOTE: rejecting or closing a dispute currently reverts the contract to
 * IN_PROGRESS as a reasonable default, since the schema doesn't retain the
 * contract's pre-dispute status. If contracts frequently get disputed
 * before ever starting, consider adding a `statusBeforeDispute` field to
 * Contract so this can restore the exact prior state instead.
 */
const updateDisputeStatus = async (
	disputeId: string,
	payload: IUpdateDisputeStatus,
	user: RequestUser,
) => {
	if (user.role !== Role.ADMIN) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"Only admins can update dispute status",
		);
	}

	const dispute = await prisma.dispute.findUnique({ where: { id: disputeId } });

	if (!dispute) {
		throw new AppError(httpStatus.NOT_FOUND, "Dispute Not Found");
	}

	if (TERMINAL_STATUSES.has(dispute.status)) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			`This dispute is already ${dispute.status.toLowerCase()} and cannot be changed`,
		);
	}

	return prisma.$transaction(async (tx) => {
		const updated = await tx.dispute.update({
			where: { id: disputeId },
			data: { status: payload.status },
		});

		if (payload.status === "REJECTED" || payload.status === "CLOSED") {
			await tx.contract.updateMany({
				where: { id: dispute.contractId, status: ContractStatus.DISPUTED },
				data: { status: ContractStatus.IN_PROGRESS },
			});
		}

		const contract = await tx.contract.findUnique({
			where: { id: dispute.contractId },
			include: { client: true, professional: true, event: true },
		});

		await createNotifications(tx, [
			{
				userId: contract?.client.userId ?? "",
				title: "Dispute Status Updated",
				type: NotificationType.DISPUTE,
				message: `The dispute on the contract${
					contract?.event?.title ? ` for "${contract.event.title}"` : ""
				} has been updated to ${payload.status}.`,
			},
			{
				userId: contract?.professional.userId ?? "",
				title: "Dispute Status Updated",
				type: NotificationType.DISPUTE,
				message: `The dispute on the contract${
					contract?.event?.title ? ` for "${contract.event.title}"` : ""
				} has been updated to ${payload.status}.`,
			},
		]);

		return updated;
	});
};

/**
 * Admin resolves a dispute: records the resolution, closes the dispute out,
 * and moves the contract to RESOLVED (a terminal-ish state distinct from
 * COMPLETED/CANCELLED, per the ContractStatus enum).
 */
const resolveDispute = async (
	disputeId: string,
	resolution: string,
	user: RequestUser,
	refundClient = false,
) => {
	if (user.role !== Role.ADMIN) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"Only admins can resolve disputes",
		);
	}

	const dispute = await prisma.dispute.findUnique({ where: { id: disputeId } });

	if (!dispute) {
		throw new AppError(httpStatus.NOT_FOUND, "Dispute Not Found");
	}

	if (TERMINAL_STATUSES.has(dispute.status)) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			`This dispute is already ${dispute.status.toLowerCase()}`,
		);
	}

	// The platform holds the client's money in escrow. When the dispute is
	// resolved in the client's favour the escrow goes back to them.
	const contractWithPayments = await prisma.contract.findUnique({
		where: { id: dispute.contractId },
		include: { payments: true },
	});

	const refundablePayment = refundClient
		? contractWithPayments?.payments.find((payment) =>
				isRefundablePayment(payment),
			)
		: undefined;

	const { refund } = await prisma.$transaction(async (tx) => {
		const resolved = await tx.dispute.update({
			where: { id: disputeId },
			data: {
				status: ContractStatus.RESOLVED,
				resolution,
				resolvedById: user.userId,
				resolvedAt: new Date(),
			},
		});

		await tx.contract.update({
			where: { id: dispute.contractId },
			data: { status: ContractStatus.RESOLVED },
		});

		let createdRefund = null;

		if (refundablePayment) {
			createdRefund = await createContractRefund(tx, {
				contractId: dispute.contractId,
				clientId: contractWithPayments!.clientId,
				payment: refundablePayment,
				reason: `The dispute was resolved in the client's favour: ${resolution}`,
			});
		}

		const contract = await tx.contract.findUnique({
			where: { id: dispute.contractId },
			include: { client: true, professional: true, event: true },
		});

		await createNotifications(tx, [
			{
				userId: contract?.client.userId ?? "",
				title: "Dispute Resolved",
				type: NotificationType.DISPUTE,
				message: `The dispute on the contract${
					contract?.event?.title ? ` for "${contract.event.title}"` : ""
				} has been resolved.${
					createdRefund
						? ` A refund of ${createdRefund.amount.toFixed(2)} ${createdRefund.currency} has been issued to your bKash account.`
						: ""
				}`,
			},
			{
				userId: contract?.professional.userId ?? "",
				title: "Dispute Resolved",
				type: NotificationType.DISPUTE,
				message: `The dispute on the contract${
					contract?.event?.title ? ` for "${contract.event.title}"` : ""
				} has been resolved.`,
			},
		]);

		return { refund: createdRefund, dispute: resolved };
	});

	// The refund is handed over to the payment provider outside of the
	// transaction.
	if (refund) {
		try {
			await dispatchRefund(refund.id);
		} catch (error) {
			console.error("Refund dispatch failed", error);
		}
	}

	return prisma.dispute.findUnique({ where: { id: disputeId } });
};

export const disputeService = {
	raiseDispute,
	listDisputes,
	getDisputeDetails,
	updateDisputeStatus,
	resolveDispute,
};
