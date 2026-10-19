import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./src/generated/prisma/client";

const prisma = new PrismaClient({
	adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
	const types = await prisma.event.groupBy({
		by: ["eventType"],
		_count: { _all: true },
	});

	console.log("EVENT TYPES:", JSON.stringify(types));

	const events = await prisma.event.findMany({
		select: { id: true, title: true, eventType: true, status: true },
		orderBy: { createdAt: "desc" },
		take: 20,
	});

	console.log("EVENTS:", JSON.stringify(events, null, 2));

	const clients = await prisma.client.count();
	const pros = await prisma.professional.count();
	const contracts = await prisma.contract.count();

	console.log("COUNTS:", { clients, pros, contracts });
}

main()
	.catch((e) => {
		console.error("ERR", e.message);
		process.exit(1);
	})
	.finally(() => prisma.$disconnect());
