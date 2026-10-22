/**
 * End-to-end check of the two stage payment flow with the platform escrow.
 *
 *   1. the client starts the final payment of a delivered contract
 *   2. that payment fails (the bKash callback reports a failure)
 *   3. the client starts the final payment AGAIN — this used to fail with
 *      "Initial Payment Must Be Settled Before The Final Payment"
 *   4. the advance the platform holds is untouched by the failed attempt
 *   5. a final payment without a captured advance is still rejected
 *
 * The script creates its own throwaway accounts and removes them again.
 */

import type { Server } from "node:http";
import bcrypt from "bcrypt";
import app from "../src/app";
import { prisma } from "../src/app/lib/prisma";
import { redisClient } from "../src/app/lib/redis";

const PORT = 5098;
const BASE = `http://127.0.0.1:${PORT}/api/v1`;
const PASSWORD = "E2e@Test12345";
const STAMP = Date.now();

const created = {
	userIds: [] as string[],
	eventIds: [] as string[],
};

const login = async (email: string) => {
	const response = await fetch(`${BASE}/auth/login`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email, password: PASSWORD }),
	});

	const body = await response.json();

	if (!response.ok) {
		throw new Error(`Login failed for ${email}: ${JSON.stringify(body)}`);
	}

	return body.data.accessToken as string;
};

const startFinalPayment = async (contractId: string, token: string) => {
	const response = await fetch(
		`${BASE}/payment/contracts/${contractId}/final`,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
		},
	);

	return { status: response.status, body: await response.json() };
};

const failThePayment = async (paymentId: string) => {
	// The callback is what the provider calls when the customer does not
	// complete the payment.
	const response = await fetch(
		`${BASE}/payment/bkash/callback?paymentID=${paymentId}&status=failure`,
		{ redirect: "manual" },
	);

	return {
		status: response.status,
		location: response.headers.get("location"),
	};
};

const createAccounts = async () => {
	const hash = await bcrypt.hash(PASSWORD, 10);

	const clientUser = await prisma.user.create({
		data: {
			name: "E2E Client",
			email: `e2e-client-${STAMP}@test.local`,
			password: hash,
			role: "CLIENT",
			emailVerified: true,
			client: { create: { phone: "01700000000", city: "Dhaka" } },
		},
		include: { client: true },
	});

	const professionalUser = await prisma.user.create({
		data: {
			name: "E2E Professional",
			email: `e2e-prof-${STAMP}@test.local`,
			password: hash,
			role: "PROFESSIONAL",
			emailVerified: true,
			professional: {
				create: {
					name: "E2E Professional",
					email: `e2e-prof-${STAMP}@test.local`,
					phone: "01700000001",
					city: "Dhaka",
					professionalTitle: "Event Manager",
					experienceYears: 5,
					status: "APPROVED",
					acceptingBookings: true,
					services: {
						create: [
							{
								name: "E2E Service",
								minimumPrice: 1000,
								maximumPrice: 1000000,
							},
						],
					},
				},
			},
		},
		include: { professional: { include: { services: true } } },
	});

	created.userIds.push(clientUser.id, professionalUser.id);

	return {
		client: clientUser.client!,
		professional: professionalUser.professional!,
	};
};

/**
 * A delivered contract whose 30% advance sits in the platform escrow.
 */
const seedContract = async (
	accounts: { client: { id: string }; professional: { id: string } },
	options: { amount: number; advanceCaptured: boolean },
) => {
	const service = await prisma.professionalService.findFirst({
		where: { professionalId: accounts.professional.id },
	});

	const startAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
	const endAt = new Date(startAt.getTime() + 3 * 60 * 60 * 1000);

	const event = await prisma.event.create({
		data: {
			clientId: accounts.client.id,
			title: `E2E payment test ${STAMP}`,
			startAt,
			endAt,
			status: "PUBLISHED",
			serviceRequirements: {
				create: {
					serviceName: "E2E Service",
					budget: options.amount,
					startAt,
					endAt,
					status: "FILLED",
				},
			},
		},
		include: { serviceRequirements: true },
	});

	created.eventIds.push(event.id);

	const requirement = event.serviceRequirements[0];

	const proposal = await prisma.proposal.create({
		data: {
			professionalId: accounts.professional.id,
			eventId: event.id,
			items: {
				create: {
					eventServiceRequirementId: requirement.id,
					professionalServiceId: service!.id,
					proposedAmount: options.amount,
					proposedStartAt: startAt,
					proposedEndAt: endAt,
					status: "ACCEPTED",
					respondedAt: new Date(),
				},
			},
		},
		include: { items: true },
	});

	const contract = await prisma.contract.create({
		data: {
			clientId: accounts.client.id,
			professionalId: accounts.professional.id,
			eventId: event.id,
			eventServiceRequirementId: requirement.id,
			professionalServiceId: service!.id,
			proposalItemId: proposal.items[0].id,
			agreedAmount: options.amount,
			serviceStartAt: startAt,
			serviceEndAt: endAt,
			status: "DELIVERED",
			confirmedAt: new Date(),
		},
	});

	if (options.advanceCaptured) {
		await prisma.payment.create({
			data: {
				contractId: contract.id,
				clientId: accounts.client.id,
				stage: "INITIAL",
				// The platform holds the money until the contract is completed.
				status: "ESCROWED",
				amount: (options.amount * 0.3).toFixed(2),
				paidAt: new Date(),
				bkashTransactionId: `E2E-${contract.id}`,
				merchantInvoiceNumber: `${contract.id}-INITIAL`,
			},
		});
	}

	return contract.id;
};

const cleanup = async () => {
	for (const eventId of created.eventIds) {
		const event = await prisma.event.findUnique({
			where: { id: eventId },
			include: { serviceRequirements: true },
		});

		const requirementIds =
			event?.serviceRequirements.map((requirement) => requirement.id) ?? [];

		await prisma.refund.deleteMany({ where: { contract: { eventId } } });
		await prisma.payment.deleteMany({ where: { contract: { eventId } } });
		await prisma.contract.deleteMany({ where: { eventId } });
		await prisma.proposalItem.deleteMany({
			where: { eventServiceRequirementId: { in: requirementIds } },
		});
		await prisma.proposal.deleteMany({ where: { eventId } });
		await prisma.eventServiceRequirement.deleteMany({
			where: { id: { in: requirementIds } },
		});
		await prisma.event.deleteMany({ where: { id: eventId } });
	}

	for (const userId of created.userIds) {
		await prisma.notification.deleteMany({ where: { userId } });
	}

	await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
};

const main = async () => {
	// The bKash token lives in Redis.
	await redisClient.connect();

	const server: Server = app.listen(PORT);
	await new Promise((resolve) => setTimeout(resolve, 500));

	try {
		const accounts = await createAccounts();
		const clientToken = await login(`e2e-client-${STAMP}@test.local`);

		// 1 — the client starts the final payment
		const contractId = await seedContract(accounts, {
			amount: 25000,
			advanceCaptured: true,
		});

		const first = await startFinalPayment(contractId, clientToken);

		console.log(
			"[1] client starts the final payment ->",
			first.status,
			"|",
			first.body?.message,
		);

		if (first.status !== 200 || !first.body?.data?.paymentUrl) {
			throw new Error(
				`The final payment could not be started: ${JSON.stringify(first.body)}`,
			);
		}

		const firstPayment = await prisma.payment.findFirst({
			where: { contractId, stage: "FINAL" },
		});

		console.log(
			"    final payment:",
			firstPayment?.status,
			firstPayment?.amount,
			"invoice",
			firstPayment?.merchantInvoiceNumber,
		);

		// 2 — the payment fails
		const callback = await failThePayment(firstPayment!.bkashPaymentId!);

		console.log(
			"[2] the bKash callback reports a failure ->",
			callback.status,
			"|",
			callback.location,
		);

		const afterFailure = await prisma.payment.findMany({
			where: { contractId },
			orderBy: { stage: "asc" },
		});

		console.log(
			"    payments after the failure:",
			afterFailure
				.map(
					(payment) => `${payment.stage}=${payment.status}(${payment.amount})`,
				)
				.join(", "),
		);

		const advance = afterFailure.find((payment) => payment.stage === "INITIAL");

		if (advance?.status !== "ESCROWED") {
			throw new Error(
				"The advance the platform holds must not be touched by a failed final payment",
			);
		}

		const failedFinal = afterFailure.find(
			(payment) => payment.stage === "FINAL",
		);

		if (failedFinal?.status !== "FAILED") {
			throw new Error("The failed final payment must be marked as failed");
		}

		// 3 — the client tries to pay the rest AGAIN
		const retry = await startFinalPayment(contractId, clientToken);

		console.log(
			"[3] the client starts the final payment again ->",
			retry.status,
			"|",
			retry.body?.message,
		);

		if (retry.status !== 200 || !retry.body?.data?.paymentUrl) {
			throw new Error(
				`The final payment must be retryable after a failure: ${JSON.stringify(retry.body)}`,
			);
		}

		const retryPayment = await prisma.payment.findFirst({
			where: { contractId, stage: "FINAL" },
		});

		console.log(
			"    final payment:",
			retryPayment?.status,
			retryPayment?.amount,
			"invoice",
			retryPayment?.merchantInvoiceNumber,
		);

		if (
			retryPayment?.merchantInvoiceNumber ===
			firstPayment?.merchantInvoiceNumber
		) {
			throw new Error(
				"A retry must carry its own merchant invoice number — bKash rejects a duplicate one",
			);
		}

		const paymentsAfterRetry = await prisma.payment.findMany({
			where: { contractId },
			orderBy: { stage: "asc" },
		});

		console.log(
			"    payments after the retry:",
			paymentsAfterRetry
				.map(
					(payment) => `${payment.stage}=${payment.status}(${payment.amount})`,
				)
				.join(", "),
		);

		const total = paymentsAfterRetry.reduce(
			(sum, payment) => sum + Number(payment.amount),
			0,
		);

		if (total !== 25000) {
			throw new Error(
				`The advance and the final payment must add up to the agreed amount, got ${total}`,
			);
		}

		// 4 — a final payment without a captured advance is rejected
		const unpaidContract = await seedContract(accounts, {
			amount: 12000,
			advanceCaptured: false,
		});

		const rejected = await startFinalPayment(unpaidContract, clientToken);

		console.log(
			"[4] final payment without a captured advance ->",
			rejected.status,
			"|",
			rejected.body?.message,
		);

		if (rejected.status !== 400) {
			throw new Error(
				"A final payment without a captured advance must be rejected",
			);
		}

		console.log("\nAll payment retry checks passed.");
	} finally {
		await cleanup();
		server.close();
		await prisma.$disconnect();
		await redisClient.quit();
	}
};

main().catch(async (error) => {
	console.error("\nFAILED:", error);
	await cleanup();
	await prisma.$disconnect();
	await redisClient.quit();
	process.exit(1);
});
