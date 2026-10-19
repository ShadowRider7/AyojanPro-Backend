import type { Prisma } from "../../../generated/prisma/client";
import { PaymentStatus } from "../../../generated/prisma/enums";

type TxClient = Prisma.TransactionClient;

/**
 * ESCROW
 * ──────────────────────────
 * The platform holds the money the client paid until the contract is
 * completed. A captured payment is ESCROWED from the moment the payment
 * succeeds and is released to the professional when the contract reaches
 * COMPLETED. If the contract is cancelled instead, the money goes back to
 * the client (see refund.service.ts).
 *
 * Because the platform holds the money, a professional cannot walk away with
 * a booking they never delivered — and a client cannot lose a payment they
 * already made.
 */
export const releaseEscrowedPayments = async (
	tx: TxClient,
	contractId: string,
) => {
	await tx.payment.updateMany({
		where: { contractId, status: PaymentStatus.ESCROWED },
		data: {
			status: PaymentStatus.COMPLETED,
			releasedAt: new Date(),
		},
	});
};
