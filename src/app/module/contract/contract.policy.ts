import { Role } from "../../../generated/prisma/enums";

/**
 * CANCELLATION POLICY
 * ──────────────────────────
 * A contract can be cancelled while it is still PENDING, CONFIRMED or
 * IN_PROGRESS. Who may cancel it and what happens to the money depends on
 * who cancels:
 *
 *   • Client cancels      → no refund. The client gave up the booking, so any
 *                          money already paid stays with the platform.
 *   • Professional cancels → the client is refunded in full, because the
 *                          client did nothing wrong. The professional may only
 *                          do this while the service is still at least
 *                          PROFESSIONAL_CANCEL_NOTICE_HOURS hours away.
 *   • Admin cancels       → treated like a professional cancellation, the
 *                          client is refunded.
 *
 * The 5 day notice window keeps the professional from dropping a booked slot
 * on the client at the last minute. Inside that window the client has to
 * raise a dispute instead, which an admin reviews.
 */
export const PROFESSIONAL_CANCEL_NOTICE_HOURS = 120;

export const PROFESSIONAL_CANCEL_NOTICE_DAYS = 5;

const HOUR_IN_MS = 60 * 60 * 1000;

export const PROFESSIONAL_CANCEL_NOTICE_MS =
	PROFESSIONAL_CANCEL_NOTICE_HOURS * HOUR_IN_MS;

/**
 * The last moment a professional is allowed to cancel a contract.
 */
export const getProfessionalCancellationDeadline = (serviceStartAt: Date) =>
	new Date(serviceStartAt.getTime() - PROFESSIONAL_CANCEL_NOTICE_MS);

/**
 * True while the professional still has time to cancel on their own.
 */
export const isProfessionalCancellationWindowOpen = (
	serviceStartAt: Date,
	now: Date = new Date(),
) =>
	now.getTime() <=
	getProfessionalCancellationDeadline(serviceStartAt).getTime();

export const PROFESSIONAL_CANCEL_NOTICE_MESSAGE = `Professionals can only cancel a contract at least ${PROFESSIONAL_CANCEL_NOTICE_DAYS} days (${PROFESSIONAL_CANCEL_NOTICE_HOURS} hours) before the service starts. Raise a dispute instead and an admin will review it.`;

/**
 * The client is only refunded when the contract was cancelled by somebody
 * other than the client.
 */
export const shouldRefundClient = (cancelledByRole: Role) =>
	cancelledByRole === Role.PROFESSIONAL || cancelledByRole === Role.ADMIN;
