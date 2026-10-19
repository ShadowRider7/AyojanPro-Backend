import httpStatus from "http-status";
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

const initiatePayment = async (
	contractId: string,
	stage: PaymentStage,
	user: RequestUser,
): Promise<IInitiatePaymentResult> => {
	const transactionResult = await prisma.$transaction(async (tx) => {
		const contract = await tx.contract.findUnique({
			where: { id: contractId },
			include: { client: true },
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

		if (stage === PaymentStage.INITIAL) {
			if (contract.status !== ContractStatus.PENDING) {
				throw new AppError(
					httpStatus.BAD_REQUEST,
					"Initial Payment Can Only Be Made For A Pending Contract",
				);
			}
		}

		if (stage === PaymentStage.FINAL) {
			if (contract.status !== ContractStatus.DELIVERED) {
				throw new AppError(
					httpStatus.BAD_REQUEST,
					"Final Payment Can Only Be Made After The Contract Is Delivered",
				);
			}

			const existingPayment = await tx.payment.findUnique({
				where: { contractId },
			});

			// The advance is held by the platform (escrow) until the contract
			// is completed — it still has to be settled before the final
			// payment can be started.
			const advanceSettled =
				existingPayment?.status === PaymentStatus.ESCROWED ||
				existingPayment?.status === PaymentStatus.PARTIALLY_COMPLETED;

			if (!existingPayment || !advanceSettled) {
				throw new AppError(
					httpStatus.BAD_REQUEST,
					"Initial Payment Must Be Settled Before The Final Payment",
				);
			}
		}

		const existingPayment = await tx.payment.findUnique({
			where: { contractId },
		});

		// The payment row is reused for both stages, so only a payment that is
		// already settled for THIS stage blocks a new attempt. The advance
		// sits in the platform escrow (stage INITIAL) while the client pays
		// the final 70% (stage FINAL).
		const alreadySettled =
			existingPayment?.status === PaymentStatus.COMPLETED ||
			existingPayment?.status === PaymentStatus.ESCROWED;

		if (alreadySettled && existingPayment?.stage === stage) {
			throw new AppError(
				httpStatus.BAD_REQUEST,
				"The Payment Has Already Been Completed For This Contract",
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
			throw new AppError(
				httpStatus.BAD_GATEWAY,
				"No Bkash Access Token Found!",
			);
		}

		const merchantInvoiceNumber = `${contract.id}-${stage}`;

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

		const bkashCreatePaymentResult = await bkashCreatePaymentResponse.json();

		if (existingPayment) {
			const updatedAmount =
				stage === PaymentStage.FINAL ? fullAmount.toFixed(2) : chargeAmount;

			await tx.payment.update({
				where: { id: existingPayment.id },
				data: {
					stage,
					status: PaymentStatus.PENDING,
					method: PaymentMethod.BKASH,
					amount: updatedAmount,
					currency: contract.currency,
					merchantInvoiceNumber: bkashCreatePaymentResult.merchantInvoiceNumber,
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
					merchantInvoiceNumber: bkashCreatePaymentResult.merchantInvoiceNumber,
					bkashPaymentId: bkashCreatePaymentResult.paymentID,
					payerReference: user.email,
					metadata: bkashCreatePaymentResult,
				},
			});
		}

		return {
			paymentUrl: bkashCreatePaymentResult.bkashURL,
		};
	});

	return transactionResult;
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

const bkashPaymentCallback = async (
	query: IQuery,
): Promise<IBkashCallbackResult> => {
	const transactionResult = await prisma.$transaction(
		async (tx) => {
			const paymentId = query.paymentID;

			if (!paymentId) {
				throw new AppError(httpStatus.BAD_REQUEST, "Payment Id Missing");
			}

			const status = query.status;

			if (!status) {
				throw new AppError(httpStatus.BAD_REQUEST, "Payment Status is Missing");
			}

			const payment = await tx.payment.findUnique({
				where: { bkashPaymentId: paymentId },
			});

			if (!payment) {
				throw new AppError(httpStatus.NOT_FOUND, "Payment Not Found!");
			}

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

			const executedPaymentResult = await executedPaymentResponse.json();

			if (status === "success") {
				const isInitialStage = payment.stage === PaymentStage.INITIAL;

				const contract = await tx.contract.findUnique({
					where: { id: payment.contractId },
					include: { client: true, professional: true, event: true },
				});

				if (!contract) {
					throw new AppError(httpStatus.NOT_FOUND, "Contract Not Found!");
				}

				const updatedAmount = isInitialStage
					? payment.amount
					: Number(contract.agreedAmount ?? payment.amount).toFixed(2);

				await tx.payment.update({
					where: { id: payment.id },
					data: {
						// The money is held by the platform (escrow). It is
						// released to the professional when the contract is
						// completed — the final payment completes the contract
						// right away, the advance waits for that moment.
						status: PaymentStatus.ESCROWED,
						amount: updatedAmount,
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
					// the professional.
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
							? `An initial payment of ${updatedAmount} ${payment.currency} has been received for contract ${contractName}. The platform holds it until the contract is completed, then it is released to you. Your contract is now confirmed.`
							: `The final payment of ${updatedAmount} ${payment.currency} has been received for contract ${contractName}. The escrowed amount is released to you.`,
					},
					...(isInitialStage
						? [
								{
									userId: contract.client.userId,
									title: "Payment Held by the Platform",
									type: NotificationType.PAYMENT,
									message: `Your initial payment of ${updatedAmount} ${payment.currency} for contract ${contractName} is held by the platform. It is released to the professional once the contract is completed, and returned to you if the contract is cancelled.`,
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

			if (status === "failure") {
				const isFinalStage = payment.stage === PaymentStage.FINAL;

				const revertData: Record<string, any> = {
					failureReason:
						executedPaymentResult?.statusMessage ?? "Payment Failed",
					metadata: executedPaymentResult ?? {
						status: "failure",
					},
				};

				if (isFinalStage) {
					const contract = await tx.contract.findUnique({
						where: { id: payment.contractId },
					});

					const initialAmount = (
						Number(contract?.agreedAmount ?? payment.amount) *
						INITIAL_PAYMENT_PERCENTAGE
					).toFixed(2);

					revertData.status = PaymentStatus.ESCROWED;
					revertData.stage = PaymentStage.INITIAL;
					revertData.amount = initialAmount;
				} else {
					revertData.status = PaymentStatus.FAILED;
				}

				await tx.payment.update({
					where: { id: payment.id },
					data: revertData,
				});

				const failedContract = await tx.contract.findUnique({
					where: { id: payment.contractId },
					include: { client: true, event: true },
				});

				await createNotifications(tx, [
					{
						userId: failedContract?.client.userId ?? payment.clientId,
						title: `${isFinalStage ? "Final" : "Initial"} Payment Failed`,
						type: NotificationType.PAYMENT,
						message: `Your ${isFinalStage ? "final" : "initial"} payment for contract ${
							failedContract?.event?.title
								? `"${failedContract.event.title}"`
								: `#${payment.contractId.slice(0, 8)}`
						} has failed. Please try again.`,
					},
				]);

				return {
					redirectUrl: `${config.frontend_url}/dashboard/contracts/${payment.contractId}?payment=failure`,
				};
			}

			if (status === "cancel") {
				const isFinalStage = payment.stage === PaymentStage.FINAL;

				const revertData: Record<string, any> = {
					metadata: executedPaymentResult ?? {
						status: "cancel",
					},
				};

				if (isFinalStage) {
					const contract = await tx.contract.findUnique({
						where: { id: payment.contractId },
					});

					const initialAmount = (
						Number(contract?.agreedAmount ?? payment.amount) *
						INITIAL_PAYMENT_PERCENTAGE
					).toFixed(2);

					revertData.status = PaymentStatus.ESCROWED;
					revertData.stage = PaymentStage.INITIAL;
					revertData.amount = initialAmount;
				} else {
					revertData.status = PaymentStatus.CANCELLED;
				}

				await tx.payment.update({
					where: { id: payment.id },
					data: revertData,
				});

				const cancelledContract = await tx.contract.findUnique({
					where: { id: payment.contractId },
					include: { client: true, event: true },
				});

				await createNotifications(tx, [
					{
						userId: cancelledContract?.client.userId ?? payment.clientId,
						title: "Payment Cancelled",
						type: NotificationType.PAYMENT,
						message: `Your ${isFinalStage ? "final" : "initial"} payment for contract ${
							cancelledContract?.event?.title
								? `"${cancelledContract.event.title}"`
								: `#${payment.contractId.slice(0, 8)}`
						} was cancelled.`,
					},
				]);

				return {
					redirectUrl: `${config.frontend_url}/dashboard/contracts/${payment.contractId}?payment=cancel`,
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
