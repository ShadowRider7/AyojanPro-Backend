import httpStatus from "http-status";
import { randomBytes } from "node:crypto";
import {
	ContractStatus,
	NotificationType,
	PaymentMethod,
	PaymentStage,
	PaymentStatus,
	Role,
} from "../../../generated/prisma/enums";
import config from "../../config";
import type { IQuery } from "../../interfaces";
import { getBkashIdToken } from "../../lib/bkash";
import { prisma } from "../../lib/prisma";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { createNotifications } from "../../utils/notifications";
import { releaseEscrowedPayments } from "./escrow.service";
import type {
	IBkashCallbackResult,
	IContractPaymentsResult,
	IInitiatePaymentResult,
} from "./payment.interface";

const INITIAL_PAYMENT_PERCENTAGE = 0.3;
const FINAL_PAYMENT_PERCENTAGE = 0.7;

/**
 * A payment that carries money for the client:
 *   ESCROWED           → the platform holds the money until the contract is
 *                        completed (the advance) or released (the final
 *                        payment completes the contract)
 *   COMPLETED          → the money was released to the professional
 *   PARTIALLY_COMPLETED→ part of the money was already paid out
 */
const SETTLED_STATUSES = new Set<PaymentStatus>([
	PaymentStatus.ESCROWED,
	PaymentStatus.COMPLETED,
	PaymentStatus.PARTIALLY_COMPLETED,
]);

/**
 * The merchant invoice number of a payment attempt.
 *
 * bKash rejects a duplicate merchant invoice number (2029/2031), so every
 * attempt carries its own number — a client that has to retry a payment must
 * not be blocked by the invoice number of the failed attempt.
 *
 * The number starts with `${contractId}-${stage}` so a callback can still be
 * matched against the payment it belongs to.
 */
const buildMerchantInvoiceNumber = (contractId: string, stage: PaymentStage) =>
	`${contractId}-${stage}-${randomBytes(6).toString("hex")}`;

const parseBkashDate = (value: unknown): Date | null => {
	if (value === null || value === undefined) {
		return null;
	}
	if (typeof value === "number") {
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? null : date;
	}

	if (typeof value !== "string") {
		return null;
	}

	const normalized = value.replace(
		/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}):(\d{3})/,
		"$1.$2",
	);

	const date = new Date(normalized);

	if (Number.isNaN(date.getTime())) {
		return null;
	}

	return date;
};

/**
 * STARTS A PAYMENT
 * ──────────────────────────
 * A contract is paid in two stages: the 30% advance (INITIAL) confirms the
 * contract, the 70% final payment (FINAL) completes it. Both are separate
 * payments with their own row — one payment per (contract, stage).
 *
 * The platform holds both of them in escrow: the money is only released to
 * the professional when the contract is completed.
 */
const initiatePayment = async (
	contractId: string,
	stage: PaymentStage,
	user: RequestUser,
): Promise<IInitiatePaymentResult> => {
	const contract = await prisma.contract.findUnique({
		where: { id: contractId },
		include: { client: true, payments: true },
	});

	if (!contract) {
		throw new AppError(httpStatus.NOT_FOUND, "Contract Not Found");
	}

	if (contract.client.userId !== user.userId) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You Are Not Authorized To Pay For This Contract",
		);
	}

	// The payment of THIS stage. The advance and the final payment are two
	// different payments, so they never share a row.
	const stagePayment = contract.payments.find(
		(payment) => payment.stage === stage,
	);

	if (stage === PaymentStage.INITIAL) {
		if (contract.status !== ContractStatus.PENDING) {
			throw new AppError(
				httpStatus.BAD_REQUEST,
				"Initial Payment Can Only Be Made For A Pending Contract",
			);
		}
	} else {
		if (contract.status !== ContractStatus.DELIVERED) {
			throw new AppError(
				httpStatus.BAD_REQUEST,
				"Final Payment Can Only Be Made After The Contract Is Delivered",
			);
		}

		// The advance is held by the platform (escrow) until the contract is
		// completed — it has to be captured before the final payment starts.
		const advance = contract.payments.find(
			(payment) => payment.stage === PaymentStage.INITIAL,
		);

		const advanceSettled = !!advance && SETTLED_STATUSES.has(advance.status);

		if (!advanceSettled) {
			throw new AppError(
				httpStatus.BAD_REQUEST,
				"Initial Payment Must Be Settled Before The Final Payment",
			);
		}
	}

	// A stage that already carries money cannot be paid a second time.
	if (stagePayment && SETTLED_STATUSES.has(stagePayment.status)) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			stage === PaymentStage.INITIAL
				? "The Initial Payment Has Already Been Completed For This Contract"
				: "The Final Payment Has Already Been Completed For This Contract",
		);
	}

	const fullAmount = Number(contract.agreedAmount);

	const percentage =
		stage === PaymentStage.INITIAL
			? INITIAL_PAYMENT_PERCENTAGE
			: FINAL_PAYMENT_PERCENTAGE;

	const chargeAmount = (fullAmount * percentage).toFixed(2);

	const bkashIdToken = await getBkashIdToken();

	if (!bkashIdToken) {
		throw new AppError(httpStatus.BAD_GATEWAY, "No Bkash Access Token Found!");
	}

	const merchantInvoiceNumber = buildMerchantInvoiceNumber(contractId, stage);

	const bkashCreatePaymentResponse = await fetch(
		`${config.bkash_base_url}/tokenized/checkout/create`,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
				Authorization: bkashIdToken,
				"X-App-Key": config.bkash_app_key,
			},
			body: JSON.stringify({
				mode: "0011",
				payerReference: user.email,
				callbackURL: `${config.bkash_callback_url}/payment/bkash/callback`,
				amount: chargeAmount,
				currency: "BDT",
				intent: "sale",
				merchantInvoiceNumber,
			}),
		},
	);

	const bkashCreatePaymentResult = await bkashCreatePaymentResponse
		.json()
		.catch(() => ({}));

	// bKash answers with an error envelope (statusCode/statusMessage) instead
	// of a checkout URL when it refuses the request — a duplicate merchant
	// invoice number for example. Without a checkout session there is nothing
	// to pay, so the payment must not be marked as pending.
	const isCheckoutSessionCreated =
		bkashCreatePaymentResponse.ok &&
		!!bkashCreatePaymentResult?.bkashURL &&
		!!bkashCreatePaymentResult?.paymentID &&
		(!bkashCreatePaymentResult?.statusCode ||
			bkashCreatePaymentResult.statusCode === "0000");

	if (!isCheckoutSessionCreated) {
		throw new AppError(
			httpStatus.BAD_GATEWAY,
			bkashCreatePaymentResult?.statusMessage ??
				bkashCreatePaymentResult?.errorMessage ??
				"The bKash payment session could not be created. Please try again.",
		);
	}

	// The session exists — the payment of this stage is now waiting for the
	// client. A failed attempt is simply restarted: the row of this stage is
	// reused and points at the new checkout session.
	await prisma.$transaction(async (tx) => {
		const existingPayment = await tx.payment.findFirst({
			where: { contractId, stage },
		});

		if (existingPayment) {
			await tx.payment.update({
				where: { id: existingPayment.id },
				data: {
					status: PaymentStatus.PENDING,
					method: PaymentMethod.BKASH,
					amount: chargeAmount,
					currency: contract.currency,
					merchantInvoiceNumber,
					bkashPaymentId: bkashCreatePaymentResult.paymentID,
					payerReference: user.email,
					failureReason: null,
					metadata: bkashCreatePaymentResult,
				},
			});
		} else {
			await tx.payment.create({
				data: {
					contractId: contract.id,
					clientId: contract.clientId,
					stage,
					status: PaymentStatus.PENDING,
					method: PaymentMethod.BKASH,
					amount: chargeAmount,
					currency: contract.currency,
					merchantInvoiceNumber,
					bkashPaymentId: bkashCreatePaymentResult.paymentID,
					payerReference: user.email,
					metadata: bkashCreatePaymentResult,
				},
			});
		}
	});

	return {
		paymentUrl: bkashCreatePaymentResult.bkashURL,
	};
};

const initiateInitialPayment = async (
	contractId: string,
	user: RequestUser,
): Promise<IInitiatePaymentResult> => {
	return initiatePayment(contractId, PaymentStage.INITIAL, user);
};

const initiateFinalPayment = async (
	contractId: string,
	user: RequestUser,
): Promise<IInitiatePaymentResult> => {
	return initiatePayment(contractId, PaymentStage.FINAL, user);
};

/**
 * THE bKASH CALLBACK
 * ──────────────────────────
 * The callback is the only place where a payment is verified — the status
 * query parameter comes from the browser and can never confirm a payment on
 * its own. The bKash execute API is the authoritative source.
 *
 * The callback only ever touches the payment row of its own stage: a failed
 * final payment leaves the escrowed advance untouched, so the client can
 * simply retry the payment.
 */
const bkashPaymentCallback = async (
	query: IQuery,
): Promise<IBkashCallbackResult> => {
	const paymentId = query.paymentID;

	if (!paymentId) {
		throw new AppError(httpStatus.BAD_REQUEST, "Payment Id Missing");
	}

	const status = query.status;

	if (!status) {
		throw new AppError(httpStatus.BAD_REQUEST, "Payment Status is Missing");
	}

	const knownPayment = await prisma.payment.findUnique({
		where: { bkashPaymentId: paymentId },
	});

	if (!knownPayment) {
		// The callback belongs to a checkout session that is not the current
		// one — an attempt the client already retried, for example. There is
		// nothing to settle, so the client is sent back to the contracts.
		return {
			redirectUrl: `${config.frontend_url}/dashboard/contracts?payment=error`,
		};
	}

	const transactionResult = await prisma.$transaction(
		async (tx) => {
			const payment = await tx.payment.findUnique({
				where: { bkashPaymentId: paymentId },
			});

			if (!payment) {
				return {
					redirectUrl: `${config.frontend_url}/dashboard/contracts?payment=error`,
				};
			}

			// The merchant invoice number of a row starts with
			// `${contractId}-${stage}`, so a callback that does not belong to
			// this contract and stage must never settle this payment. The
			// number is only enforced when the provider echoed one back — the
			// bKash execute response stays the authoritative signal either way.
			const expectedInvoicePrefix = `${payment.contractId}-${payment.stage}-`;
			const isInvoiceMismatch =
				!!payment.merchantInvoiceNumber &&
				!payment.merchantInvoiceNumber.startsWith(expectedInvoicePrefix);

			const bkashIdToken = await getBkashIdToken();

			if (!bkashIdToken) {
				throw new AppError(
					httpStatus.BAD_GATEWAY,
					"No Bkash Access Token Found!",
				);
			}

			const executedPaymentResponse = await fetch(
				`${config.bkash_base_url}/tokenized/checkout/execute`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Accept: "application/json",
						Authorization: bkashIdToken,
						"X-App-Key": config.bkash_app_key,
					},
					body: JSON.stringify({
						paymentID: paymentId,
					}),
				},
			);

			const executedPaymentResult = await executedPaymentResponse
				.json()
				.catch(() => ({}));

			// The bKash execute API is the only trustworthy source for the
			// outcome of the payment — the `status` query parameter is
			// supplied by the caller and can never confirm a payment on its
			// own. bKash reports a successful execution with the status code
			// "0000".
			const isPaymentConfirmed =
				executedPaymentResult?.statusCode === "0000" ||
				executedPaymentResult?.status === "success";

			// Anything that is not a confirmed execution is a failure — the
			// caller may only tell a cancel apart from a failure. A callback
			// whose invoice number does not belong to this payment can never
			// settle it, whatever the provider answered.
			const callbackStatus: string =
				isInvoiceMismatch || !isPaymentConfirmed
					? status === "cancel" && !isInvoiceMismatch
						? "cancel"
						: "failure"
					: "success";

			// A payment that is already settled must never be downgraded by a
			// repeated callback — the bKash execute API only works once, so
			// the second call of a genuine payment would report a failure.
			const isPaymentSettled = SETTLED_STATUSES.has(payment.status);

			if (callbackStatus === "success") {
				const isInitialStage = payment.stage === PaymentStage.INITIAL;

				const contract = await tx.contract.findUnique({
					where: { id: payment.contractId },
					include: { client: true, professional: true, event: true },
				});

				if (!contract) {
					throw new AppError(httpStatus.NOT_FOUND, "Contract Not Found!");
				}

				await tx.payment.update({
					where: { id: payment.id },
					data: {
						// The money is held by the platform (escrow). It is
						// released to the professional when the contract is
						// completed — the final payment completes the contract
						// right away, the advance waits for that moment.
						status: PaymentStatus.ESCROWED,
						bkashTransactionId: executedPaymentResult?.trxID ?? null,
						transactionTime: parseBkashDate(
							executedPaymentResult?.paymentExecuteTime,
						),
						paidAt: new Date(),
						metadata: executedPaymentResult ?? {
							status: "success",
							note: "Execute API was unavailable",
						},
					},
				});

				await tx.contract.update({
					where: { id: payment.contractId },
					data: {
						status: isInitialStage
							? ContractStatus.CONFIRMED
							: ContractStatus.COMPLETED,
						...(isInitialStage
							? { confirmedAt: new Date() }
							: { completedAt: new Date() }),
					},
				});

				if (!isInitialStage) {
					// The contract is completed, so the escrow is released to
					// the professional — the advance the platform held and
					// the final payment are both released.
					await releaseEscrowedPayments(tx, payment.contractId);
				}

				const contractName = contract.event?.title
					? `"${contract.event.title}"`
					: `#${payment.contractId.slice(0, 8)}`;

				await createNotifications(tx, [
					{
						userId: contract.professional.userId,
						title: isInitialStage
							? "Initial Payment Received"
							: "Final Payment Received",
						type: NotificationType.PAYMENT,
						message: isInitialStage
							? `An initial payment of ${payment.amount.toFixed(2)} ${payment.currency} has been received for contract ${contractName}. The platform holds it until the contract is completed, then it is released to you. Your contract is now confirmed.`
							: `The final payment of ${payment.amount.toFixed(2)} ${payment.currency} has been received for contract ${contractName}. The escrowed amount is released to you.`,
					},
					...(isInitialStage
						? [
								{
									userId: contract.client.userId,
									title: "Payment Held by the Platform",
									type: NotificationType.PAYMENT,
									message: `Your initial payment of ${payment.amount.toFixed(2)} ${payment.currency} for contract ${contractName} is held by the platform. It is released to the professional once the contract is completed, and returned to you if the contract is cancelled.`,
								},
							]
						: [
								{
									userId: contract.professional.userId,
									title: "Contract Completed",
									type: NotificationType.CONTRACT,
									message: `The contract ${contractName} has been completed after the final payment.`,
								},
								{
									userId: contract.client.userId,
									title: "Contract Completed",
									type: NotificationType.CONTRACT,
									message: `The contract ${contractName} has been completed successfully.`,
								},
							]),
				]);

				return {
					redirectUrl: `${config.frontend_url}/dashboard/contracts/${payment.contractId}?payment=success`,
				};
			}

			if (callbackStatus === "failure" || callbackStatus === "cancel") {
				if (isPaymentSettled) {
					return {
						redirectUrl: `${config.frontend_url}/dashboard/contracts/${payment.contractId}?payment=success`,
					};
				}

				const isFinalStage = payment.stage === PaymentStage.FINAL;

				// Only the payment of this stage is touched: a failed final
				// payment never touches the advance the platform holds, so the
				// client can simply retry the payment.
				await tx.payment.update({
					where: { id: payment.id },
					data: {
						status:
							callbackStatus === "cancel"
								? PaymentStatus.CANCELLED
								: PaymentStatus.FAILED,
						failureReason:
							callbackStatus === "cancel"
								? "The client cancelled the payment"
								: (executedPaymentResult?.statusMessage ?? "Payment Failed"),
						metadata: executedPaymentResult ?? {
							status: callbackStatus,
						},
					},
				});

				const affectedContract = await tx.contract.findUnique({
					where: { id: payment.contractId },
					include: { client: true, event: true },
				});

				await createNotifications(tx, [
					{
						userId: affectedContract?.client.userId ?? payment.clientId,
						title: `${
							isFinalStage ? "Final" : "Initial"
						} Payment ${callbackStatus === "cancel" ? "Cancelled" : "Failed"}`,
						type: NotificationType.PAYMENT,
						message:
							callbackStatus === "cancel"
								? `Your ${isFinalStage ? "final" : "initial"} payment for contract ${
										affectedContract?.event?.title
											? `"${affectedContract.event.title}"`
											: `#${payment.contractId.slice(0, 8)}`
									} was cancelled. You can try again whenever you are ready.`
								: `Your ${isFinalStage ? "final" : "initial"} payment for contract ${
										affectedContract?.event?.title
											? `"${affectedContract.event.title}"`
											: `#${payment.contractId.slice(0, 8)}`
									} has failed. Please try again.`,
					},
				]);

				return {
					redirectUrl: `${config.frontend_url}/dashboard/contracts/${payment.contractId}?payment=${
						callbackStatus === "cancel" ? "cancel" : "failure"
					}`,
				};
			}

			return {
				redirectUrl: `${config.frontend_url}/dashboard/contracts/${payment.contractId}?payment=error`,
			};
		},
		{
			maxWait: 10000, // default: 2000
			timeout: 30000, // default: 5000
		},
	);

	return transactionResult;
};

const getContractPayments = async (
	contractId: string,
	user: RequestUser,
): Promise<IContractPaymentsResult> => {
	const contract = await prisma.contract.findUnique({
		where: { id: contractId },
		include: { client: true, professional: true },
	});

	if (!contract) {
		throw new AppError(httpStatus.NOT_FOUND, "Contract Not Found");
	}

	const isClient = contract.client.userId === user.userId;
	const isProfessional = contract.professional.userId === user.userId;
	const isAdmin = user.role === Role.ADMIN;

	if (!isClient && !isProfessional && !isAdmin) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You Are Not Authorized To View Payments For This Contract",
		);
	}

	const payments = await prisma.payment.findMany({
		where: { contractId },
		include: { refund: true },
		orderBy: { createdAt: "asc" },
	});

	return payments;
};

export const PaymentServices = {
	initiateInitialPayment,
	initiateFinalPayment,
	bkashPaymentCallback,
	getContractPayments,
};
