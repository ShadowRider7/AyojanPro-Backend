import httpStatus from "http-status";
import { Prisma } from "../../../generated/prisma/client";
import {
	NotificationType,
	type PaymentStage,
	PaymentStatus,
	RefundStatus,
} from "../../../generated/prisma/enums";
import { requestBkashRefund } from "../../lib/bkash";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import { createNotifications } from "../../utils/notifications";

type TxClient = Prisma.TransactionClient;

/**
 * REFUNDS
 * ──────────────────────────
 * A client that already paid is refunded when the contract is cancelled by
 * the professional (or by an admin) — the client did nothing wrong, so the
 * money goes back to them. A client that cancels their own contract is not
 * refunded.
 *
 * The `Refund` row is the audit trail of that money:
 *   PENDING   → recorded, waiting to be returned to the client
 *   COMPLETED → the money is back with the client
 *   FAILED    → the settlement failed and needs a manual retry
 */
const REFUNDABLE_PAYMENT_STATUSES = new Set<PaymentStatus>([
	// The money the client paid is held by the platform (escrow) — it can
	// always be given back.
	PaymentStatus.ESCROWED,
	PaymentStatus.PARTIALLY_COMPLETED,
	PaymentStatus.COMPLETED,
]);

export const isRefundablePayment = (payment: { status: PaymentStatus }) =>
	REFUNDABLE_PAYMENT_STATUSES.has(payment.status);

/**
 * Records the refund for a cancelled contract. Runs inside the cancellation
 * transaction so the contract and the refund always move together.
 *
 * A contract can hold more than one payment — the 30% advance and the 70%
 * final payment are separate payments and both of them can sit in the
 * escrow. Every one of them is refunded, so the client gets back everything
 * they paid.
 */
export const createContractRefund = async (
	tx: TxClient,
	{
		contractId,
		clientId,
		payments,
		reason,
	}: {
		contractId: string;
		clientId: string;
		payments: {
			id: string;
			amount: Prisma.Decimal;
			currency: string;
			stage: PaymentStage;
			status: PaymentStatus;
		}[];
		reason: string;
	},
) => {
	const refunds = [];

	for (const payment of payments) {
		const refund = await tx.refund.create({
			data: {
				contractId,
				paymentId: payment.id,
				clientId,
				amount: payment.amount,
				currency: payment.currency,
				reason,
				status: RefundStatus.PENDING,
				originalStatus: payment.status,
				note: "The client is owed this money — it is returned to their bKash account.",
			},
		});

		await tx.payment.update({
			where: { id: payment.id },
			data: {
				status: PaymentStatus.REFUNDED,
				refundAmount: payment.amount,
				refundReason: reason,
				refundedAt: new Date(),
			},
		});

		refunds.push(refund);
	}

	const totalAmount = payments.reduce(
		(sum, payment) => sum + Number(payment.amount),
		0,
	);

	await tx.contract.update({
		where: { id: contractId },
		data: {
			refundIssuedAt: new Date(),
			refundAmount: new Prisma.Decimal(totalAmount.toFixed(2)),
		},
	});

	return refunds;
};

/**
 * Hands the refund over to the payment provider. Runs outside of the
 * cancellation transaction so a slow provider call cannot hold the database
 * transaction open.
 */
export const dispatchRefund = async (refundId: string) => {
	const refund = await prisma.refund.findUnique({
		where: { id: refundId },
		include: {
			payment: true,
			contract: { include: { client: true, event: true } },
		},
	});

	if (!refund) {
		throw new AppError(httpStatus.NOT_FOUND, "Refund Not Found");
	}

	if (refund.status !== RefundStatus.PENDING) {
		return refund;
	}

	const result = await requestBkashRefund({
		transactionId: refund.payment.bkashTransactionId,
		amount: refund.amount.toFixed(2),
		currency: refund.currency,
		reason: refund.reason,
		merchantInvoiceNumber: refund.payment.merchantInvoiceNumber,
	});

	if (result.status === "failed") {
		return prisma.$transaction(async (tx) => {
			const updated = await tx.refund.update({
				where: { id: refund.id },
				data: { status: RefundStatus.FAILED, note: result.message },
			});

			// The money never left the platform, so the payment goes back to
			// the state it had before the refund was issued.
			await tx.payment.update({
				where: { id: refund.paymentId },
				data: { status: refund.originalStatus },
			});

			await createNotifications(tx, [
				{
					userId: refund.contract.client.userId,
					title: "Refund Needs Attention",
					type: NotificationType.PAYMENT,
					message: `We could not return your ${refund.amount.toFixed(2)} ${refund.currency} for the cancelled contract "${refund.contract.event.title}" yet. Our team is sorting it out — you will be notified as soon as the money is on its way.`,
				},
			]);

			return updated;
		});
	}

	if (result.status === "pending") {
		return prisma.refund.update({
			where: { id: refund.id },
			data: { status: RefundStatus.PENDING, note: result.message },
		});
	}

	return prisma.$transaction(async (tx) => {
		const updated = await tx.refund.update({
			where: { id: refund.id },
			data: {
				status: RefundStatus.COMPLETED,
				reference: result.reference,
				note: "The refund was returned to the client.",
				settledAt: new Date(),
			},
		});

		await tx.payment.update({
			where: { id: refund.paymentId },
			data: { refundReference: result.reference },
		});

		await createNotifications(tx, [
			{
				userId: refund.contract.client.userId,
				title: "Refund Completed",
				type: NotificationType.PAYMENT,
				message: `Your refund of ${refund.amount.toFixed(2)} ${refund.currency} for the cancelled contract "${refund.contract.event.title}" has been returned to your bKash account.`,
			},
		]);

		return updated;
	});
};

/**
 * Manual settlement of a refund by an admin — used when the provider could
 * not settle the refund on its own.
 */
export const settleRefund = async (
	refundId: string,
	payload: {
		status: "COMPLETED" | "FAILED";
		note?: string;
		reference?: string;
	},
) => {
	const refund = await prisma.refund.findUnique({
		where: { id: refundId },
		include: {
			payment: true,
			contract: { include: { client: true, event: true } },
		},
	});

	if (!refund) {
		throw new AppError(httpStatus.NOT_FOUND, "Refund Not Found");
	}

	if (refund.status === RefundStatus.COMPLETED) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"This refund has already been settled",
		);
	}

	const status =
		payload.status === "COMPLETED"
			? RefundStatus.COMPLETED
			: RefundStatus.FAILED;

	return prisma.$transaction(async (tx) => {
		const updated = await tx.refund.update({
			where: { id: refundId },
			data: {
				status,
				note: payload.note ?? null,
				reference: payload.reference ?? refund.reference,
				settledAt: status === RefundStatus.COMPLETED ? new Date() : null,
			},
		});

		if (status === RefundStatus.COMPLETED) {
			await tx.payment.update({
				where: { id: refund.paymentId },
				data: {
					refundedAt: refund.payment.refundedAt ?? new Date(),
					refundReference: payload.reference ?? refund.reference,
				},
			});
		} else {
			// The money is still held by the platform, so the payment goes
			// back to the state it had before the refund was issued.
			await tx.payment.update({
				where: { id: refund.paymentId },
				data: { status: refund.originalStatus },
			});
		}

		await createNotifications(tx, [
			{
				userId: refund.contract.client.userId,
				title:
					status === RefundStatus.COMPLETED
						? "Refund Completed"
						: "Refund Needs Attention",
				type: NotificationType.PAYMENT,
				message:
					status === RefundStatus.COMPLETED
						? `Your refund of ${refund.amount.toFixed(2)} ${refund.currency} for the cancelled contract "${refund.contract.event.title}" has been returned to your bKash account.`
						: `We could not return your ${refund.amount.toFixed(2)} ${refund.currency} for the cancelled contract "${refund.contract.event.title}" yet. Our team is sorting it out — you will be notified as soon as the money is on its way.`,
			},
		]);

		return updated;
	});
};

export const listRefunds = async (query: { status?: string }) => {
	return prisma.refund.findMany({
		where: query.status ? { status: query.status as RefundStatus } : undefined,
		include: {
			contract: { include: { event: true } },
			client: { include: { user: true } },
		},
		orderBy: { createdAt: "desc" },
	});
};

export const RefundService = {
	createContractRefund,
	dispatchRefund,
	settleRefund,
	listRefunds,
};
