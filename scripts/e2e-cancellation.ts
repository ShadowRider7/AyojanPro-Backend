/**
 * End-to-end check of the new cancellation policy + refund flow.
 *
 *   1. a professional cancelling inside the 48h window is rejected
 *   2. a professional cancelling outside the window succeeds and the client
 *      gets the captured payment refunded
 *   3. a client cancelling is accepted and is not refunded
 *
 * The script creates its own throwaway accounts and removes them again.
 */

import type { Server } from "node:http";
import bcrypt from "bcrypt";
import app from "../src/app";
import { prisma } from "../src/app/lib/prisma";

const PORT = 5099;
const BASE = `http://127.0.0.1:${PORT}/api/v1`;
const PASSWORD = "E2e@Test12345";
const STAMP = Date.now();

const created = {
	userIds: [] as string[],
	eventIds: [] as string[],
	clientUserId: "",
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

const cancel = async (contractId: string, token: string, reason: string) => {
	const response = await fetch(`${BASE}/contract/${contractId}/cancel`, {
		method: "PATCH",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${token}`,
		},
		body: JSON.stringify({ reason }),
	});

	return { status: response.status, body: await response.json() };
};

const createAccounts = async () => {
	const hash = await bcrypt.hash(PASSWORD, 10);

	const adminUser = await prisma.user.create({
		data: {
			name: "E2E Admin",
			email: `e2e-admin-${STAMP}@test.local`,
			password: hash,
			role: "ADMIN",
			emailVerified: true,
		},
	});

	created.userIds.push(adminUser.id);

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
	created.clientUserId = clientUser.id;

	return {
		client: clientUser.client!,
		professional: professionalUser.professional!,
	};
};

const seedContract = async (
	accounts: { client: { id: string }; professional: { id: string } },
	options: { hoursFromNow: number; amount: number; paid: boolean },
) => {
	const service = await prisma.professionalService.findFirst({
		where: { professionalId: accounts.professional.id },
	});

	const startAt = new Date(Date.now() + options.hoursFromNow * 60 * 60 * 1000);
	const endAt = new Date(startAt.getTime() + 3 * 60 * 60 * 1000);

	const event = await prisma.event.create({
		data: {
			clientId: accounts.client.id,
			title: `E2E cancellation test ${STAMP}`,
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
			status: "CONFIRMED",
			confirmedAt: new Date(),
		},
	});

	if (options.paid) {
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
	const server: Server = app.listen(PORT);
	await new Promise((resolve) => setTimeout(resolve, 500));

	try {
		const accounts = await createAccounts();

		const professionalToken = await login(`e2e-prof-${STAMP}@test.local`);
		const clientToken = await login(`e2e-client-${STAMP}@test.local`);

		// 1 — inside the 5 day window the professional is blocked
		const insideWindow = await seedContract(accounts, {
			hoursFromNow: 72,
			amount: 10000,
			paid: true,
		});

		const blocked = await cancel(
			insideWindow,
			professionalToken,
			"Something came up",
		);

		console.log(
			"[1] professional cancels 3 days before the service ->",
			blocked.status,
			"|",
			blocked.body?.message,
		);

		if (blocked.status !== 400) {
			throw new Error("Expected the cancellation to be rejected");
		}

		const untouched = await prisma.contract.findUnique({
			where: { id: insideWindow },
		});

		if (untouched?.status !== "CONFIRMED") {
			throw new Error("The contract must stay untouched");
		}

		// 2 — outside the window the professional cancels, the client is refunded
		const outsideWindow = await seedContract(accounts, {
			hoursFromNow: 168,
			amount: 20000,
			paid: true,
		});

		const allowed = await cancel(
			outsideWindow,
			professionalToken,
			"I am not available anymore",
		);

		console.log(
			"[2] professional cancels 7 days before the service ->",
			allowed.status,
			"|",
			allowed.body?.message,
		);

		const refundedContract = await prisma.contract.findUnique({
			where: { id: outsideWindow },
			include: { refunds: true, payments: true },
		});

		console.log(
			"    contract:",
			refundedContract?.status,
			"| cancelledBy:",
			refundedContract?.cancelledByRole,
			"| refundAmount:",
			refundedContract?.refundAmount?.toString(),
		);
		console.log(
			"    payment:",
			refundedContract?.payments[0]?.status,
			"| refund:",
			refundedContract?.refunds[0]?.status,
			refundedContract?.refunds[0]?.amount?.toString(),
		);

		if (refundedContract?.refunds.length !== 1) {
			throw new Error("Expected exactly one refund to be created");
		}

		if (refundedContract?.payments[0]?.status !== "REFUNDED") {
			throw new Error("Expected the payment to be refunded");
		}

		const clientNotifications = await prisma.notification.findMany({
			where: {
				userId: created.clientUserId,
				title: "Contract Cancelled",
			},
		});

		console.log("    client notification:", clientNotifications[0]?.message);

		// 3 — a client cancellation is accepted and is not refunded
		const clientCancel = await seedContract(accounts, {
			hoursFromNow: 168,
			amount: 30000,
			paid: true,
		});

		const clientResult = await cancel(
			clientCancel,
			clientToken,
			"The event is off",
		);

		console.log(
			"[3] client cancels ->",
			clientResult.status,
			"|",
			clientResult.body?.message,
		);

		const clientContract = await prisma.contract.findUnique({
			where: { id: clientCancel },
			include: { refunds: true, payments: true },
		});

		console.log(
			"    contract:",
			clientContract?.status,
			"| cancelledBy:",
			clientContract?.cancelledByRole,
			"| refunds:",
			clientContract?.refunds.length,
			"| payment:",
			clientContract?.payments[0]?.status,
		);

		if (clientContract?.refunds.length !== 0) {
			throw new Error("A client cancellation must not create a refund");
		}

		if (clientContract?.payments[0]?.status !== "ESCROWED") {
			throw new Error(
				"A client cancellation keeps the money in the platform escrow",
			);
		}

		// 4 — the escrow is released to the professional when the contract is
		// completed
		const escrowContract = await seedContract(accounts, {
			hoursFromNow: 168,
			amount: 40000,
			paid: false,
		});

		await prisma.contract.update({
			where: { id: escrowContract },
			data: { status: "DELIVERED" },
		});

		await prisma.payment.create({
			data: {
				contractId: escrowContract,
				clientId: accounts.client.id,
				stage: "FINAL",
				status: "ESCROWED",
				amount: 40000,
				paidAt: new Date(),
				merchantInvoiceNumber: `${escrowContract}-FINAL`,
			},
		});

		const completeResponse = await fetch(
			`${BASE}/contract/${escrowContract}/complete`,
			{
				method: "PATCH",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${clientToken}`,
				},
			},
		);
		const completeBody = await completeResponse.json();

		console.log(
			"[4] client completes the contract ->",
			completeResponse.status,
			"|",
			completeBody?.message,
		);

		const releasedPayment = await prisma.payment.findFirst({
			where: { contractId: escrowContract },
		});

		console.log(
			"    payment after completion:",
			releasedPayment?.status,
			"| released at:",
			releasedPayment?.releasedAt?.toISOString(),
		);

		if (releasedPayment?.status !== "COMPLETED") {
			throw new Error("The escrow must be released on completion");
		}

		if (!releasedPayment?.releasedAt) {
			throw new Error("The release must be timestamped");
		}

		// 5 — an admin settles the outstanding refund manually
		const adminToken = await login(`e2e-admin-${STAMP}@test.local`);

		const listResponse = await fetch(`${BASE}/admin/refunds`, {
			headers: { Authorization: `Bearer ${adminToken}` },
		});
		const listBody = await listResponse.json();

		console.log(
			"[5] admin lists refunds ->",
			listResponse.status,
			"| refunds:",
			listBody?.data?.length,
		);

		const pendingRefund = listBody?.data?.find(
			(refund: { contractId: string }) => refund.contractId === outsideWindow,
		);

		if (!pendingRefund) {
			throw new Error("The refund must show up in the admin list");
		}

		const settleResponse = await fetch(
			`${BASE}/admin/refunds/${pendingRefund.id}/settle`,
			{
				method: "PATCH",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${adminToken}`,
				},
				body: JSON.stringify({
					status: "COMPLETED",
					note: "Settled manually by the E2E check.",
					reference: "E2E-REFUND-1",
				}),
			},
		);
		const settleBody = await settleResponse.json();

		console.log(
			"    admin settles the refund ->",
			settleResponse.status,
			"| status:",
			settleBody?.data?.status,
			"| reference:",
			settleBody?.data?.reference,
		);

		if (settleBody?.data?.status !== "COMPLETED") {
			throw new Error("The refund must be settled");
		}

		const settledPayment = await prisma.payment.findFirst({
			where: { contractId: outsideWindow },
		});

		console.log(
			"    payment after settlement:",
			settledPayment?.status,
			"| refund reference:",
			settledPayment?.refundReference,
		);

		if (settledPayment?.refundReference !== "E2E-REFUND-1") {
			throw new Error("The settled refund must be stored on the payment");
		}

		// 6 — a dispute resolved in the client's favour returns the escrow
		const disputedContract = await seedContract(accounts, {
			hoursFromNow: 168,
			amount: 50000,
			paid: true,
		});

		const dispute = await prisma.dispute.create({
			data: {
				contractId: disputedContract,
				raisedById: created.clientUserId,
				raisedByRole: "CLIENT",
				reason: "The professional did not show up",
				description: "Nobody came to the event on the agreed day.",
			},
		});

		const resolveResponse = await fetch(
			`${BASE}/dispute/${dispute.id}/resolve`,
			{
				method: "PATCH",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${adminToken}`,
				},
				body: JSON.stringify({
					resolution:
						"The professional did not deliver, the client is refunded.",
					refundClient: true,
				}),
			},
		);
		const resolveBody = await resolveResponse.json();

		console.log(
			"[6] admin resolves the dispute with a refund ->",
			resolveResponse.status,
			"|",
			resolveBody?.message,
		);

		const disputeRefund = await prisma.refund.findFirst({
			where: { contractId: disputedContract },
		});
		const disputedPayment = await prisma.payment.findFirst({
			where: { contractId: disputedContract },
		});

		console.log(
			"    refund:",
			disputeRefund?.status,
			disputeRefund?.amount?.toString(),
			"| payment:",
			disputedPayment?.status,
		);

		if (!disputeRefund) {
			throw new Error("Resolving the dispute must refund the client");
		}

		if (disputedPayment?.status !== "REFUNDED") {
			throw new Error("The escrowed payment must be refunded");
		}

		// 7 — the final payment can still be started while the advance sits
		// in the platform escrow
		const finalContract = await seedContract(accounts, {
			hoursFromNow: 168,
			amount: 60000,
			paid: true,
		});

		await prisma.contract.update({
			where: { id: finalContract },
			data: { status: "DELIVERED" },
		});

		const finalPaymentResponse = await fetch(
			`${BASE}/payment/contracts/${finalContract}/final`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${clientToken}`,
				},
			},
		);
		const finalPaymentBody = await finalPaymentResponse.json();

		console.log(
			"[7] client starts the final payment with an escrowed advance ->",
			finalPaymentResponse.status,
			"|",
			finalPaymentBody?.message ??
				`payment url: ${Boolean(finalPaymentBody?.data?.paymentUrl)}`,
		);

		if (finalPaymentResponse.status === 400) {
			throw new Error(
				`The final payment must not be blocked: ${finalPaymentBody?.message}`,
			);
		}

		console.log("\nAll cancellation policy checks passed.");
	} finally {
		await cleanup();
		server.close();
		await prisma.$disconnect();
	}
};

main().catch(async (error) => {
	console.error(error);
	process.exit(1);
});
