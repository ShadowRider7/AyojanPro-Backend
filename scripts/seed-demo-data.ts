/**
 * Seeds a complete demo dataset for AyojanPro: client accounts, professional
 * accounts (applied, email verified, approved by an admin), their skills,
 * services and experience, the events those clients post, and a proposal on
 * every matching requirement.
 *
 * The script drives the real HTTP API (it boots the Express app on a spare
 * port) so every row is created through the same validation, business rules
 * and notifications as a real user. Only the two steps that need a real inbox
 * or a real resume file are assisted:
 *
 *   - the registration / application OTPs are read straight from Redis,
 *   - the demo admin is created directly with Prisma.
 *
 * The credentials of every seeded account are written to a markdown document
 * (default: `docs/demo_accounts.md`, override with `DEMO_DOC_PATH`).
 *
 *   npx tsx scripts/seed-demo-data.ts
 */

import fs from "node:fs";
import type { Server } from "node:http";
import path from "node:path";
import bcrypt from "bcrypt";
import app from "../src/app";
import { prisma } from "../src/app/lib/prisma";
import { redisClient } from "../src/app/lib/redis";
import {
	DEMO_ADMIN,
	DEMO_CLIENT_PASSWORD,
	DEMO_PROFESSIONAL_PASSWORD,
	demoClients,
	demoEvents,
	demoProfessionals,
	demoProposals,
} from "./demo-dataset";

const PORT = Number(process.env.SEED_PORT ?? 5098);
const BASE = `http://127.0.0.1:${PORT}/api/v1`;
const DOC_PATH = path.resolve(
	process.env.DEMO_DOC_PATH ??
		path.join(process.cwd(), "docs", "demo_accounts.md"),
);

type ApiEnvelope<T> = {
	success: boolean;
	statusCode: number;
	message: string;
	data: T;
};

/** A tiny but valid PDF used as the demo resume upload. */
const buildResumePdf = (name: string, title: string) =>
	Buffer.from(
		`%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj
trailer<</Root 1 0 R/Info<</Title(${name} - ${title})>>>
%%EOF
`,
		"utf8",
	);

const sleep = (ms: number) =>
	new Promise((resolve) => {
		setTimeout(resolve, ms);
	});

/**
 * The Redis connection can be dropped by the server at any time and
 * node-redis v6 has no offline queue — a command on a closed socket fails
 * with "The client is closed". The seed script therefore makes sure the
 * connection is alive before every request and retries the request once.
 */
const ensureRedis = async () => {
	if (redisClient.isOpen) {
		return;
	}

	try {
		await redisClient.connect();
	} catch {
		// Another connect() is already in flight — wait for it.
		await sleep(500);
	}
};

const api = async <T>(
	method: string,
	endpoint: string,
	options: {
		token?: string;
		body?: unknown;
		form?: FormData;
	} = {},
): Promise<T> => {
	const headers: Record<string, string> = {};

	if (options.token) {
		headers.Authorization = `Bearer ${options.token}`;
	}

	let body: BodyInit | undefined;

	if (options.form) {
		body = options.form;
	} else if (options.body !== undefined) {
		headers["Content-Type"] = "application/json";
		body = JSON.stringify(options.body);
	}

	let lastError: unknown;

	for (let attempt = 1; attempt <= 3; attempt++) {
		await ensureRedis();

		try {
			const response = await fetch(`${BASE}${endpoint}`, {
				method,
				headers,
				body,
			});
			const text = await response.text();

			let payload: ApiEnvelope<T> | null = null;

			try {
				payload = text ? (JSON.parse(text) as ApiEnvelope<T>) : null;
			} catch {
				payload = null;
			}

			if (!response.ok) {
				throw new Error(
					`${method} ${endpoint} failed with ${response.status}: ${
						payload?.message ?? text
					}`,
				);
			}

			return payload?.data as T;
		} catch (error) {
			lastError = error;

			// A 4xx is a real answer from the API — only retry the 5xx and
			// the transport errors.
			const message = (error as Error).message;
			const isClientError = /\bfailed with 4\d\d\b/.test(message);

			if (isClientError || attempt === 3) {
				throw error;
			}

			await sleep(1000 * attempt);
		}
	}

	throw lastError;
};

const readOtp = async (key: string): Promise<string> => {
	await ensureRedis();

	const otp = await redisClient.get(key);

	if (!otp) {
		throw new Error(`No OTP stored under "${key}"`);
	}

	return otp;
};

const startServer = (): Promise<Server> =>
	new Promise((resolve) => {
		const server = app.listen(PORT, () => {
			console.log(`Demo API listening on ${BASE}`);
			resolve(server);
		});
	});

type SeededAccount = {
	name: string;
	email: string;
	password: string;
	role: "ADMIN" | "CLIENT" | "PROFESSIONAL";
	note: string;
};

const accounts: SeededAccount[] = [];

const log = (message: string) => console.log(`  ${message}`);

/**
 * Removes the accounts of a previous run so the script can be executed again
 * without hitting "email already exists".
 *
 * The rows are removed in dependency order: several relations use
 * `onDelete: Restrict` (a proposal item points at a professional service, a
 * contract points at almost everything), so a plain `deleteMany` on the users
 * would be rejected by the database.
 */
const resetDemoData = async () => {
	const emails = [
		DEMO_ADMIN.email,
		...demoClients.map((client) => client.email),
		...demoProfessionals.map((professional) => professional.email),
	];

	const isDemoUser = { email: { in: emails } };
	const isDemoClient = { user: isDemoUser };
	const isDemoProfessional = { user: isDemoUser };
	const isDemoEvent = { client: isDemoClient };

	const contracts = await prisma.contract.findMany({
		where: {
			OR: [{ client: isDemoClient }, { professional: isDemoProfessional }],
		},
		select: { id: true },
	});
	const contractIds = contracts.map((contract) => contract.id);

	await prisma.refund.deleteMany({
		where: { contractId: { in: contractIds } },
	});
	await prisma.payment.deleteMany({
		where: { contractId: { in: contractIds } },
	});
	await prisma.review.deleteMany({
		where: {
			OR: [{ client: isDemoClient }, { professional: isDemoProfessional }],
		},
	});
	await prisma.dispute.deleteMany({ where: { raisedBy: isDemoUser } });
	await prisma.contract.deleteMany({ where: { id: { in: contractIds } } });

	await prisma.proposalItem.deleteMany({
		where: {
			OR: [
				{ professionalService: { professional: isDemoProfessional } },
				{ eventServiceRequirement: { event: isDemoEvent } },
			],
		},
	});
	await prisma.proposal.deleteMany({
		where: {
			OR: [{ professional: isDemoProfessional }, { event: isDemoEvent }],
		},
	});
	await prisma.event.deleteMany({ where: isDemoEvent });

	const removed = await prisma.user.deleteMany({
		where: { email: { in: emails } },
	});

	if (removed.count > 0) {
		log(`removed ${removed.count} account(s) from a previous run`);
	}
};

const seedAdmin = async () => {
	const password = await bcrypt.hash(DEMO_ADMIN.password, 10);

	await prisma.user.create({
		data: {
			name: DEMO_ADMIN.name,
			email: DEMO_ADMIN.email,
			password,
			role: "ADMIN",
			status: "ACTIVE",
			emailVerified: true,
		},
	});

	const { accessToken } = await api<{ accessToken: string }>(
		"POST",
		"/auth/login",
		{ body: { email: DEMO_ADMIN.email, password: DEMO_ADMIN.password } },
	);

	accounts.push({
		name: DEMO_ADMIN.name,
		email: DEMO_ADMIN.email,
		password: DEMO_ADMIN.password,
		role: "ADMIN",
		note: "Reviews and approves professional applications.",
	});

	log(`admin ${DEMO_ADMIN.email} ready`);

	return accessToken;
};

const seedClients = async () => {
	const tokens = new Map<string, string>();

	for (const client of demoClients) {
		await api<null>("POST", "/auth/register", {
			body: {
				name: client.name,
				email: client.email,
				password: DEMO_CLIENT_PASSWORD,
				client: {
					phone: client.phone,
					bio: client.bio,
					address: client.address,
					city: client.city,
					country: client.country,
				},
			},
		});

		const otp = await readOtp(`client-registration-otp:${client.email}`);

		await api<unknown>("POST", "/auth/verify-email", {
			body: { email: client.email, otp },
		});

		const { accessToken } = await api<{ accessToken: string }>(
			"POST",
			"/auth/login",
			{ body: { email: client.email, password: DEMO_CLIENT_PASSWORD } },
		);

		tokens.set(client.email, accessToken);

		accounts.push({
			name: client.name,
			email: client.email,
			password: DEMO_CLIENT_PASSWORD,
			role: "CLIENT",
			note: `${client.city}, ${client.country}`,
		});

		log(`client ${client.email} registered + verified`);
	}

	return tokens;
};

type SeededProfessional = {
	email: string;
	name: string;
	professionalId: string;
	token: string;
	serviceIds: Map<string, string>;
};

const seedProfessionals = async (adminToken: string) => {
	const seeded: SeededProfessional[] = [];

	for (const professional of demoProfessionals) {
		// 1. Apply — the public entry point, resume included.
		const form = new FormData();

		form.append(
			"data",
			JSON.stringify({
				user: { name: professional.name, email: professional.email },
				professional: {
					phone: professional.phone,
					address: professional.address,
					city: professional.city,
					country: professional.country,
					professionalTitle: professional.professionalTitle,
					bio: professional.bio,
					experienceYears: professional.experienceYears,
				},
			}),
		);
		form.append(
			"resume",
			new Blob(
				[buildResumePdf(professional.name, professional.professionalTitle)],
				{ type: "application/pdf" },
			),
			"resume.pdf",
		);

		const application = await api<{ professional: { id: string } }>(
			"POST",
			"/professional/apply-as-professional",
			{ form },
		);

		const professionalId = application.professional.id;

		// 2. Verify the application email with the OTP kept in Redis.
		const otp = await readOtp(
			`professional-application-otp:${professional.email}`,
		);

		await api<unknown>(
			"POST",
			"/professional/apply-as-professional/verify-email",
			{ body: { email: professional.email, otp } },
		);

		// 3. Approve the application as an admin.
		await api<unknown>("POST", "/professional/approve-professional", {
			token: adminToken,
			body: { professionalId, status: "APPROVED" },
		});

		// 4. Replace the random application password with a known one.
		await api<null>("POST", "/auth/forgot-password", {
			body: { email: professional.email },
		});

		const resetOtp = await readOtp(`forgot-password-otp:${professional.email}`);

		await api<null>("POST", "/auth/reset-password", {
			body: {
				email: professional.email,
				otp: resetOtp,
				newPassword: DEMO_PROFESSIONAL_PASSWORD,
				confirmPassword: DEMO_PROFESSIONAL_PASSWORD,
			},
		});

		const { accessToken } = await api<{ accessToken: string }>(
			"POST",
			"/auth/login",
			{
				body: {
					email: professional.email,
					password: DEMO_PROFESSIONAL_PASSWORD,
				},
			},
		);

		// 5. Complete the public profile.
		await api<unknown>("PATCH", "/professional/update-my-profile", {
			token: accessToken,
			body: {
				bio: professional.bio,
				professionalTitle: professional.professionalTitle,
				phone: professional.phone,
				address: professional.address,
				city: professional.city,
				country: professional.country,
				experienceYears: professional.experienceYears,
				acceptingBookings: true,
			},
		});

		for (const skill of professional.skills) {
			try {
				await api<unknown>("POST", "/professional/skill", {
					token: accessToken,
					body: skill,
				});
			} catch (error) {
				// Skill names are unique for the whole platform — reuse the
				// existing skill and attach it to this professional instead.
				const existingSkill = await prisma.skill.findUnique({
					where: { name: skill.name },
				});

				if (!existingSkill) {
					throw error;
				}

				await prisma.professionalSkill.upsert({
					where: {
						professionalId_skillId: {
							professionalId,
							skillId: existingSkill.id,
						},
					},
					create: { professionalId, skillId: existingSkill.id },
					update: {},
				});
			}
		}

		const serviceIds = new Map<string, string>();

		for (const service of professional.services) {
			const created = await api<{ id: string }>(
				"POST",
				"/professional/service",
				{ token: accessToken, body: service },
			);

			serviceIds.set(service.name, created.id);
		}

		for (const experience of professional.experiences) {
			await api<unknown>("POST", "/professional/experience", {
				token: accessToken,
				body: experience,
			});
		}

		seeded.push({
			email: professional.email,
			name: professional.name,
			professionalId,
			token: accessToken,
			serviceIds,
		});

		accounts.push({
			name: professional.name,
			email: professional.email,
			password: DEMO_PROFESSIONAL_PASSWORD,
			role: "PROFESSIONAL",
			note: `${professional.professionalTitle} — ${professional.city}`,
		});

		log(
			`professional ${professional.email} applied, verified, approved, profile filled`,
		);
	}

	return seeded;
};

type SeededEvent = {
	title: string;
	id: string;
	requirements: { id: string; serviceName: string }[];
};

const seedEvents = async (clientTokens: Map<string, string>) => {
	const seeded: SeededEvent[] = [];

	for (const event of demoEvents) {
		const token = clientTokens.get(event.clientEmail);

		if (!token) {
			throw new Error(`No client token for ${event.clientEmail}`);
		}

		const created = await api<{ id: string }>("POST", "/event", {
			token,
			body: {
				title: event.title,
				description: event.description,
				eventType: event.eventType,
				address: event.address,
				city: event.city,
				country: event.country,
				startAt: event.startAt,
				endAt: event.endAt,
			},
		});

		const requirements: { id: string; serviceName: string }[] = [];

		for (const requirement of event.requirements) {
			const createdRequirement = await api<{ id: string }>(
				"POST",
				`/event/services/${created.id}`,
				{ token, body: requirement },
			);

			requirements.push({
				id: createdRequirement.id,
				serviceName: requirement.serviceName,
			});
		}

		await api<unknown>("PATCH", `/event/publish-event/${created.id}`, {
			token,
		});

		seeded.push({ title: event.title, id: created.id, requirements });

		log(`event "${event.title}" published (${requirements.length} services)`);
	}

	return seeded;
};

const seedProposals = async (
	professionals: SeededProfessional[],
	events: SeededEvent[],
) => {
	for (const proposal of demoProposals) {
		const professional = professionals.find(
			(candidate) => candidate.email === proposal.professionalEmail,
		);
		const event = events.find(
			(candidate) => candidate.title === proposal.eventTitle,
		);

		if (!professional || !event) {
			throw new Error(
				`Proposal references unknown professional or event: ${proposal.eventTitle}`,
			);
		}

		const requirement = event.requirements.find(
			(candidate) => candidate.serviceName === proposal.serviceName,
		);
		const serviceId = professional.serviceIds.get(proposal.serviceName);

		if (!requirement || !serviceId) {
			throw new Error(
				`Proposal references an unknown service: ${proposal.serviceName}`,
			);
		}

		await api<unknown>("POST", `/proposal/events/${event.id}`, {
			token: professional.token,
			body: {
				message: proposal.message,
				items: [
					{
						eventServiceRequirementId: requirement.id,
						professionalServiceId: serviceId,
						proposedAmount: proposal.proposedAmount,
						currency: proposal.currency,
						proposedStartAt: proposal.proposedStartAt,
						proposedEndAt: proposal.proposedEndAt,
					},
				],
			},
		});

		log(`proposal sent by ${professional.email} for "${proposal.serviceName}"`);
	}
};

const buildDocument = () => {
	const lines: string[] = [];

	lines.push("# AyojanPro demo accounts");
	lines.push("");
	lines.push(
		"Demo dataset created with `scripts/seed-demo-data.ts` in the backend repo. Every mailbox below is a **fake Gmail address** that nobody owns, so no real inbox is involved — the accounts are created through the real API (registration, email verification, admin approval) and the OTPs are read from Redis by the seed script.",
	);
	lines.push("");
	lines.push(`Generated: ${new Date().toISOString()}`);
	lines.push("");

	lines.push("## Accounts");
	lines.push("");
	lines.push("| Role | Name | Email | Password | Notes |");
	lines.push("| --- | --- | --- | --- | --- |");

	for (const account of accounts) {
		lines.push(
			`| ${account.role} | ${account.name} | \`${account.email}\` | \`${account.password}\` | ${account.note} |`,
		);
	}

	lines.push("");
	lines.push(
		"Sign in at `http://localhost:3000` with the email and the password above. The admin account is the one that approves professional applications.",
	);
	lines.push("");

	lines.push("## Client profiles");
	lines.push("");

	for (const client of demoClients) {
		lines.push(`### ${client.name} — ${client.email}`);
		lines.push("");
		lines.push(`- **Phone:** ${client.phone}`);
		lines.push(
			`- **Location:** ${client.address}, ${client.city}, ${client.country}`,
		);
		lines.push(`- **Bio:** ${client.bio}`);
		lines.push("");
	}

	lines.push("## Professional profiles");
	lines.push("");

	for (const professional of demoProfessionals) {
		lines.push(`### ${professional.name} — ${professional.email}`);
		lines.push("");
		lines.push(`- **Title:** ${professional.professionalTitle}`);
		lines.push(
			`- **Location:** ${professional.address}, ${professional.city}, ${professional.country}`,
		);
		lines.push(`- **Phone:** ${professional.phone}`);
		lines.push(`- **Experience:** ${professional.experienceYears} years`);
		lines.push(`- **Status:** APPROVED (verified + approved by the admin)`);
		lines.push(`- **Bio:** ${professional.bio}`);
		lines.push("");
		lines.push("**Skills**");
		lines.push("");
		for (const skill of professional.skills) {
			lines.push(`- ${skill.name} — ${skill.description}`);
		}
		lines.push("");
		lines.push("**Services**");
		lines.push("");
		lines.push("| Service | Price range | Notes |");
		lines.push("| --- | --- | --- |");
		for (const service of professional.services) {
			lines.push(
				`| ${service.name} | ${service.minimumPrice} – ${service.maximumPrice} BDT | ${service.pricingNote} |`,
			);
		}
		lines.push("");
		lines.push("**Experience**");
		lines.push("");
		for (const experience of professional.experiences) {
			lines.push(
				`- **${experience.title}** at ${experience.organization} (${experience.startDate} → ${experience.endDate}) — ${experience.description}`,
			);
		}
		lines.push("");
	}

	lines.push("## Events");
	lines.push("");

	for (const event of demoEvents) {
		const client = demoClients.find(
			(candidate) => candidate.email === event.clientEmail,
		);

		lines.push(
			`### ${event.title} — ${event.eventType.replace(/_/g, " ").toLowerCase()}`,
		);
		lines.push("");
		lines.push(`- **Client:** ${client?.name} (${event.clientEmail})`);
		lines.push(`- **When:** ${event.startAt} → ${event.endAt}`);
		lines.push(
			`- **Where:** ${event.address}, ${event.city}, ${event.country}`,
		);
		lines.push(`- **Description:** ${event.description}`);
		lines.push("- **Status:** PUBLISHED");
		lines.push("");
		lines.push("| Required service | Budget | Description |");
		lines.push("| --- | --- | --- |");
		for (const requirement of event.requirements) {
			lines.push(
				`| ${requirement.serviceName} | ${requirement.budget} ${requirement.currency} | ${requirement.description} |`,
			);
		}
		lines.push("");
	}

	lines.push("## Proposals");
	lines.push("");

	for (const proposal of demoProposals) {
		const professional = demoProfessionals.find(
			(candidate) => candidate.email === proposal.professionalEmail,
		);

		lines.push(
			`- **${professional?.name}** → "${proposal.eventTitle}" · ${proposal.serviceName} · ${proposal.proposedAmount} ${proposal.currency}`,
		);
	}

	lines.push("");
	lines.push("## Re-running the seed");
	lines.push("");
	lines.push("```bash");
	lines.push("# from the backend repo (AyojanPro)");
	lines.push("npx tsx scripts/seed-demo-data.ts");
	lines.push("```");
	lines.push("");
	lines.push(
		"The script deletes the accounts listed above before recreating them, so it can be run again at any time. Set `DEMO_DOC_PATH` to write the credentials document somewhere else:",
	);
	lines.push("");
	lines.push("```bash");
	lines.push(
		"DEMO_DOC_PATH=../ayojanpro-frontend/docs/demo_accounts.md npx tsx scripts/seed-demo-data.ts",
	);
	lines.push("```");
	lines.push("");

	return lines.join("\n");
};

const writeDocument = () => {
	fs.mkdirSync(path.dirname(DOC_PATH), { recursive: true });
	fs.writeFileSync(DOC_PATH, buildDocument(), "utf8");

	console.log(`\nCredentials written to ${DOC_PATH}`);
};

const main = async () => {
	await prisma.$connect();
	await ensureRedis();

	const server = await startServer();

	try {
		console.log("\nSeeding demo data");
		await resetDemoData();
		const adminToken = await seedAdmin();
		const clientTokens = await seedClients();
		const professionals = await seedProfessionals(adminToken);
		const events = await seedEvents(clientTokens);
		await seedProposals(professionals, events);
		writeDocument();

		console.log(
			`\nDone — ${accounts.length} accounts, ${events.length} events, ${demoProposals.length} proposals.`,
		);
	} finally {
		// The keep-alive sockets of `fetch` would keep the server open.
		server.closeAllConnections();
		server.close();
		await prisma.$disconnect();

		try {
			await Promise.race([
				redisClient.quit(),
				sleep(2000).then(() => redisClient.destroy()),
			]);
		} catch {
			redisClient.destroy();
		}
	}
};

main().catch((error) => {
	console.error("\nSeed failed:", error);
	process.exit(1);
});
