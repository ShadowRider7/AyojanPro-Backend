import httpStatus from "http-status";
import {
	ContractStatus,
	EventStatus,
	type EventType,
	Role,
} from "../../../generated/prisma/enums";
import type { EventWhereInput } from "../../../generated/prisma/models";
import type { getEvent } from "../../interfaces";
import { prisma } from "../../lib/prisma";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import type {
	IEventCreate,
	IEventServiceRequirementCreate,
	IEventUpdateServiceRequirement,
	IUpdateEventPayload,
} from "./event.interface";

const createEvent = async (payload: IEventCreate, user: RequestUser) => {
	const existingClient = await prisma.client.findUnique({
		where: {
			userId: user.userId,
		},
	});

	if (!existingClient) {
		throw new AppError(httpStatus.NOT_FOUND, "Client Profile Not Found");
	}

	const {
		title,
		description,
		eventType,
		city,
		country,
		address,
		startAt,
		endAt,
	} = payload;

	const createdEvent = await prisma.event.create({
		data: {
			title,
			description,
			eventType,
			city,
			country,
			address,
			startAt,
			endAt,
			clientId: existingClient.id,
		},

		include: {
			client: true,
		},
	});

	return createdEvent;
};

const createEventService = async (
	eventId: string,
	payload: IEventServiceRequirementCreate,
	user: RequestUser,
) => {
	const existingClient = await prisma.client.findUnique({
		where: {
			userId: user.userId,
		},
	});

	if (!existingClient) {
		throw new AppError(httpStatus.NOT_FOUND, "Client Profile Not Found");
	}

	const event = await prisma.event.findUnique({
		where: { id: eventId, clientId: existingClient.id },
		include: {
			serviceRequirements: true,
		},
	});

	if (!event || event.isDeleted) {
		throw new AppError(httpStatus.NOT_FOUND, "Event Not Found");
	}

	const { serviceName, description, budget, currency, startAt, endAt } =
		payload;

	if (startAt < event.startAt || endAt > event.endAt) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Service dates must be within the event schedule",
		);
	}

	const createdEventServices = await prisma.eventServiceRequirement.create({
		data: {
			serviceName,
			description,
			budget,
			currency,
			startAt,
			endAt,
			eventId,
		},

		include: {
			event: true,
		},
	});

	return createdEventServices;
};

const getAllPublishedEvents = async (query: getEvent) => {
	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;
	const sortBy = query.sortBy ? query.sortBy : "createdAt";
	const sortOrder = query.sortOrder ? query.sortOrder : "desc";

	const andConditions: EventWhereInput[] = [
		{
			status: EventStatus.PUBLISHED,
			isDeleted: false,
		},
	];

	if (query.clientId) {
		andConditions.push({ clientId: query.clientId });
	}
	if (query.email) {
		andConditions.push({
			client: {
				user: {
					email: query.email,
				},
			},
		});
	}

	if (query.status) {
		andConditions.push({
			serviceRequirements: {
				every: {
					status: query.status,
				},
			},
		});
	}

	if (query.eventType) {
		andConditions.push({
			eventType: query.eventType as EventType,
		});
	}

	if (query.searchTerm) {
		andConditions.push({
			OR: [
				{ title: { contains: query.searchTerm, mode: "insensitive" } },
				{ description: { contains: query.searchTerm, mode: "insensitive" } },
				{ city: { contains: query.searchTerm, mode: "insensitive" } },
				{ country: { contains: query.searchTerm, mode: "insensitive" } },
				{ address: { contains: query.searchTerm, mode: "insensitive" } },

				{
					client: {
						user: {
							OR: [
								{ name: { contains: query.searchTerm, mode: "insensitive" } },
								{ email: { contains: query.searchTerm, mode: "insensitive" } },
							],
						},
					},
				},
			],
		});
	}

	const events = await prisma.event.findMany({
		where: {
			AND: andConditions,
		},

		take: limit,
		skip,
		orderBy: {
			[sortBy]: sortOrder,
		},
		include: {
			serviceRequirements: true,
			contracts: {
				include: {
					client: true,
				},
			},
			client: {
				include: {
					user: {
						select: {
							id: true,
							name: true,
							imageUrl: true,
						},
					},
				},
			},
		},
	});

	const total = await prisma.event.count({ where: { AND: andConditions } });

	return {
		data: events,
		meta: {
			page,
			limit,
			total,
			totalPages: Math.ceil(total / limit),
		},
	};
};

/**
 * The public events board.
 *
 * Anyone can browse published events — a professional does not need an
 * approved account to see what work is available. The client identity is
 * included so a professional can see who posted the event, but only the
 * display name and avatar are exposed, never the contact details.
 */
const getPublishedEventsBoard = async (query: getEvent) => {
	const limit = query.limit ? Number(query.limit) : 12;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;
	const sortBy = query.sortBy ? query.sortBy : "createdAt";
	const sortOrder = query.sortOrder ? query.sortOrder : "desc";

	const andConditions: EventWhereInput[] = [
		{
			status: EventStatus.PUBLISHED,
			isDeleted: false,
		},
	];

	if (query.eventType) {
		andConditions.push({
			eventType: query.eventType as EventType,
		});
	}

	if (query.city) {
		andConditions.push({
			city: { contains: query.city, mode: "insensitive" },
		});
	}

	if (query.searchTerm) {
		andConditions.push({
			OR: [
				{ title: { contains: query.searchTerm, mode: "insensitive" } },
				{ description: { contains: query.searchTerm, mode: "insensitive" } },
				{ city: { contains: query.searchTerm, mode: "insensitive" } },
				{ country: { contains: query.searchTerm, mode: "insensitive" } },
			],
		});
	}

	const events = await prisma.event.findMany({
		where: {
			AND: andConditions,
		},
		take: limit,
		skip,
		orderBy: {
			[sortBy]: sortOrder,
		},
		select: {
			id: true,
			title: true,
			description: true,
			eventType: true,
			address: true,
			city: true,
			country: true,
			startAt: true,
			endAt: true,
			status: true,
			createdAt: true,
			serviceRequirements: {
				select: {
					id: true,
					serviceName: true,
					description: true,
					status: true,
					startAt: true,
					endAt: true,
					budget: true,
					currency: true,
				},
			},
			client: {
				select: {
					id: true,
					user: {
						select: {
							id: true,
							name: true,
							imageUrl: true,
						},
					},
				},
			},
		},
	});

	const total = await prisma.event.count({ where: { AND: andConditions } });

	return {
		data: events,
		meta: {
			page,
			limit,
			total,
			totalPages: Math.ceil(total / limit),
		},
	};
};

/**
 * One published event for the public board. Drafts are never exposed, and
 * the client is reduced to a display name and avatar.
 */
const getPublishedEventById = async (eventId: string) => {
	const event = await prisma.event.findFirst({
		where: {
			id: eventId,
			status: EventStatus.PUBLISHED,
			isDeleted: false,
		},
		select: {
			id: true,
			title: true,
			description: true,
			eventType: true,
			address: true,
			city: true,
			country: true,
			startAt: true,
			endAt: true,
			status: true,
			createdAt: true,
			serviceRequirements: {
				select: {
					id: true,
					serviceName: true,
					description: true,
					status: true,
					startAt: true,
					endAt: true,
					budget: true,
					currency: true,
				},
			},
			client: {
				select: {
					id: true,
					user: {
						select: {
							id: true,
							name: true,
							imageUrl: true,
						},
					},
				},
			},
		},
	});

	if (!event) {
		throw new AppError(httpStatus.NOT_FOUND, "Event Not Found");
	}

	return event;
};

const getMyEvents = async (user: RequestUser) => {
	const existingClient = await prisma.client.findUnique({
		where: { userId: user.userId },
	});

	if (!existingClient) {
		throw new AppError(httpStatus.NOT_FOUND, "Client Profile Not Found");
	}

	const myEvents = await prisma.event.findMany({
		where: {
			clientId: existingClient.id,
			isDeleted: false,
		},
		include: {
			serviceRequirements: true,
		},
		orderBy: {
			createdAt: "desc",
		},
	});

	return myEvents;
};

/**
 * One event, scoped to what the requester is allowed to see.
 *
 * A client may read their own event in any state. A professional may read a
 * published event — that is the event they would bid on. An admin may read
 * any event. The public board uses `getPublishedEventById` instead, which
 * never exposes the client's contact details.
 */
const getEventById = async (eventId: string, user: RequestUser) => {
	const event = await prisma.event.findUnique({
		where: { id: eventId },
		include: {
			client: {
				select: {
					id: true,
					address: true,
					city: true,
					country: true,
					phone: true,
					user: {
						select: {
							id: true,
							name: true,
							imageUrl: true,
						},
					},
				},
			},
			serviceRequirements: {
				include: {
					contracts: true,
					proposalItems: true,
				},
			},
			contracts: {
				include: {
					professional: true,
				},
			},
		},
	});

	if (!event || event.isDeleted) {
		throw new AppError(httpStatus.NOT_FOUND, "event Not Found");
	}

	if (user.role === Role.ADMIN) {
		return event;
	}

	if (user.role === Role.CLIENT) {
		const client = await prisma.client.findUnique({
			where: { userId: user.userId },
			select: { id: true },
		});

		if (!client || event.clientId !== client.id) {
			throw new AppError(
				httpStatus.FORBIDDEN,
				"You do not have access to this event",
			);
		}

		return event;
	}

	// A professional only sees the events that are open for proposals.
	if (event.status !== EventStatus.PUBLISHED) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You do not have access to this event",
		);
	}

	return event;
};

const updateEvent = async (
	eventId: string,
	payload: IUpdateEventPayload,
	user: RequestUser,
) => {
	// 1. Authenticate client profile
	const client = await prisma.client.findUnique({
		where: { userId: user.userId },
	});

	if (!client) {
		throw new AppError(httpStatus.NOT_FOUND, "Client Profile Not Found");
	}

	const event = await prisma.event.findUnique({
		where: { id: eventId, clientId: client.id },
		include: {
			serviceRequirements: true,
		},
	});

	if (!event || event.isDeleted) {
		throw new AppError(httpStatus.NOT_FOUND, "Event Not Found");
	}

	if (event.status === EventStatus.PUBLISHED) {
		const activeContractsCount = await prisma.contract.count({
			where: {
				eventId: event.id,
				status: { notIn: [ContractStatus.CANCELLED] },
			},
		});

		if (activeContractsCount > 0) {
			throw new AppError(
				httpStatus.CONFLICT,
				"This event has active or pending contracts and cannot be modified.",
			);
		}
	}
	const newStartAt = payload.startAt ?? event.startAt;
	const newEndAt = payload.endAt ?? event.endAt;

	if (newStartAt >= newEndAt) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Event start time must be before end time",
		);
	}

	const hasTimeChange =
		payload.startAt !== undefined || payload.endAt !== undefined;

	const updatedEvent = await prisma.$transaction(async (tx) => {
		const eventUpdate = await tx.event.update({
			where: { id: event.id },
			data: {
				title: payload.title ?? event.title,
				description: payload.description ?? event.description,
				eventType: payload.eventType ?? event.eventType,
				address: payload.address ?? event.address,
				city: payload.city ?? event.city,
				country: payload.country ?? event.country,
				startAt: newStartAt,
				endAt: newEndAt,
			},
			include: {
				serviceRequirements: true,
			},
		});

		if (hasTimeChange && event.serviceRequirements.length > 0) {
			for (const sr of event.serviceRequirements) {
				const clampedStart = sr.startAt < newStartAt ? newStartAt : sr.startAt;
				const clampedEnd = sr.endAt > newEndAt ? newEndAt : sr.endAt;

				if (clampedStart >= clampedEnd) {
					throw new AppError(
						httpStatus.BAD_REQUEST,
						`Service requirement "${sr.serviceName}" dates fall outside the new event schedule. Please update or remove it.`,
					);
				}

				const needsUpdate =
					new Date(clampedStart).getTime() !== new Date(sr.startAt).getTime() ||
					new Date(clampedEnd).getTime() !== new Date(sr.endAt).getTime();

				if (needsUpdate) {
					await tx.eventServiceRequirement.update({
						where: { id: sr.id },
						data: { startAt: clampedStart, endAt: clampedEnd },
					});

					await tx.contract.updateMany({
						where: { eventServiceRequirementId: sr.id },
						data: {
							serviceStartAt: clampedStart,
							serviceEndAt: clampedEnd,
						},
					});
				}
			}
		}

		return eventUpdate;
	});

	return updatedEvent;
};

const updateEventService = async (
	eventId: string,
	serviceId: string,
	payload: IEventUpdateServiceRequirement,
	user: RequestUser,
) => {
	const existingClient = await prisma.client.findUnique({
		where: {
			userId: user.userId,
		},
	});

	if (!existingClient) {
		throw new AppError(httpStatus.NOT_FOUND, "Client Profile Not Found");
	}

	const event = await prisma.event.findUnique({
		where: { id: eventId, clientId: existingClient.id },
		include: {
			serviceRequirements: true,
		},
	});

	if (!event || event.isDeleted) {
		throw new AppError(httpStatus.NOT_FOUND, "Event Not Found");
	}

	const { serviceName, description, budget, currency, startAt, endAt } =
		payload;

	const effectiveStartAt = startAt ?? event.startAt;
	const effectiveEndAt = endAt ?? event.endAt;

	if (effectiveStartAt < event.startAt || effectiveEndAt > event.endAt) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Service dates must be within the event schedule",
		);
	}

	const updatedEventServices = await prisma.eventServiceRequirement.update({
		where: {
			id: serviceId,
		},
		data: {
			serviceName,
			description,
			budget,
			currency,
			startAt,
			endAt,
			eventId,
		},

		include: {
			event: true,
		},
	});

	return updatedEventServices;
};

const publishEvent = async (eventId: string, user: RequestUser) => {
	const existingClient = await prisma.client.findUnique({
		where: {
			userId: user.userId,
		},
	});

	if (!existingClient) {
		throw new AppError(httpStatus.NOT_FOUND, "Client Profile Not Found");
	}

	const event = await prisma.event.findUnique({
		where: { id: eventId, clientId: existingClient.id },
	});

	if (!event || event.isDeleted) {
		throw new AppError(httpStatus.NOT_FOUND, "event Not Found");
	}

	if (event.status === EventStatus.PUBLISHED) {
		throw new AppError(httpStatus.CONFLICT, "event Is Already Published");
	}

	const activeRequirementCount = await prisma.eventServiceRequirement.count({
		where: {
			eventId: event.id,
			isDeleted: false,
		},
	});

	if (activeRequirementCount < 1) {
		throw new AppError(
			httpStatus.CONFLICT,
			"Add at least one service requirement before publishing this event",
		);
	}

	const publishedEvent = await prisma.event.update({
		where: { id: event.id },
		data: { status: EventStatus.PUBLISHED },
	});

	return publishedEvent;
};

const deleteEvent = async (eventId: string, user: RequestUser) => {
	const existingUser = await prisma.user.findUnique({
		where: {
			id: user.userId,
		},
	});
	const allowedRoles = new Set<Role>([Role.ADMIN, Role.CLIENT]);

	if (!existingUser || !allowedRoles.has(existingUser.role)) {
		throw new AppError(
			httpStatus.NOT_FOUND,
			"You don't have permission to delete",
		);
	}

	const event = await prisma.event.findUnique({
		where: { id: eventId },
	});

	if (!event || event.isDeleted) {
		throw new AppError(httpStatus.NOT_FOUND, "Event Not Found");
	}

	if (event.status === EventStatus.PUBLISHED) {
		const activeContractsCount = await prisma.contract.count({
			where: {
				eventId: event.id,
				status: { notIn: [ContractStatus.CANCELLED] },
			},
		});

		if (activeContractsCount > 0) {
			throw new AppError(
				httpStatus.CONFLICT,
				"This event has active or pending contracts and cannot be modified.",
			);
		}
	}

	const deletedEvent = await prisma.event.update({
		where: { id: event.id },
		data: { isDeleted: true, deletedAt: new Date() },
	});

	return deletedEvent;
};

const deleteEventService = async (
	eventId: string,
	serviceId: string,
	user: RequestUser,
) => {
	const existingClient = await prisma.client.findUnique({
		where: {
			userId: user.userId,
		},
	});

	if (!existingClient) {
		throw new AppError(httpStatus.NOT_FOUND, "Client Profile Not Found");
	}

	const event = await prisma.event.findUnique({
		where: { id: eventId, clientId: existingClient.id },
		include: {
			serviceRequirements: true,
		},
	});

	if (!event || event.isDeleted) {
		throw new AppError(httpStatus.NOT_FOUND, "Event is already deleted");
	}

	const deleteEventService = await prisma.eventServiceRequirement.update({
		where: {
			id: serviceId,
		},
		data: {
			isDeleted: true,
			deletedAt: new Date(),
		},
	});

	return deleteEventService;
};

/**
 * The service requirements of an event, scoped like `getEventById`.
 *
 * The proposal items and contracts of a requirement are the other
 * professionals' bids, so they are only returned to the client who owns the
 * event and to an admin. A professional sees the requirements themselves.
 */
const getEventRequiredServices = async (eventId: string, user: RequestUser) => {
	const event = await prisma.event.findUnique({
		where: { id: eventId },
	});

	if (!event || event.isDeleted) {
		throw new AppError(httpStatus.NOT_FOUND, "Event Not Found");
	}

	if (event.status === EventStatus.DRAFT) {
		throw new AppError(httpStatus.FORBIDDEN, "Event has not published yet");
	}
	if (event.status === EventStatus.CANCELLED) {
		throw new AppError(httpStatus.FORBIDDEN, "Event has been canceled");
	}

	const isAdmin = user.role === Role.ADMIN;

	let ownsEvent = false;

	if (user.role === Role.CLIENT) {
		const client = await prisma.client.findUnique({
			where: { userId: user.userId },
			select: { id: true },
		});

		ownsEvent = client?.id === event.clientId;

		if (!ownsEvent) {
			throw new AppError(
				httpStatus.FORBIDDEN,
				"You do not have access to this event",
			);
		}
	} else if (user.role === Role.PROFESSIONAL && !isAdmin) {
		if (event.status !== EventStatus.PUBLISHED) {
			throw new AppError(
				httpStatus.FORBIDDEN,
				"You do not have access to this event",
			);
		}
	}

	const eventRequiredServices = await prisma.eventServiceRequirement.findMany({
		where: {
			eventId,
		},
		include: {
			...(ownsEvent || isAdmin ? { contracts: true, proposalItems: true } : {}),
			event: true,
		},
	});

	return eventRequiredServices;
};

export const eventService = {
	createEvent,
	createEventService,
	getEventById,
	getMyEvents,
	updateEvent,
	updateEventService,
	publishEvent,
	deleteEvent,
	getAllPublishedEvents,
	getPublishedEventById,
	getPublishedEventsBoard,
	deleteEventService,
	getEventRequiredServices,
};
