import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { eventService } from "./event.service";

const createEvent = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body;
	const user = req.user!;

	const result = await eventService.createEvent(payload, user);
	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Event created Successfully",
		data: result,
	});
});
const createEventServices = catchAsync(async (req: Request, res: Response) => {
	const eventId = req.params.eventId;
	const payload = req.body;
	const user = req.user!;

	const result = await eventService.createEventService(
		eventId as string,
		payload,
		user,
	);
	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Event Services created Successfully",
		data: result,
	});
});

const getAllPublishedEvents = catchAsync(
	async (req: Request, res: Response) => {
		const { data, meta } = await eventService.getAllPublishedEvents(req.query);
		sendResponse(res, {
			statusCode: httpStatus.OK,
			success: true,
			message: "Events Retrieved Successfully",
			data,
			meta,
		});
	},
);

const getPublishedEventsBoard = catchAsync(
	async (req: Request, res: Response) => {
		const { data, meta } = await eventService.getPublishedEventsBoard(
			req.query,
		);
		sendResponse(res, {
			statusCode: httpStatus.OK,
			success: true,
			message: "Events Retrieved Successfully",
			data,
			meta,
		});
	},
);

const getPublishedEventById = catchAsync(
	async (req: Request, res: Response) => {
		const eventId = req.params.eventId as string;

		const data = await eventService.getPublishedEventById(eventId);
		sendResponse(res, {
			statusCode: httpStatus.OK,
			success: true,
			message: "Event Retrieved Successfully",
			data,
		});
	},
);

const getMyEvents = catchAsync(async (req: Request, res: Response) => {
	const user = req.user!;

	const result = await eventService.getMyEvents(user);
	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Events Retrieved Successfully",
		data: result,
	});
});

const getEventById = catchAsync(async (req: Request, res: Response) => {
	const eventId = req.params.eventId as string;
	const user = req.user!;

	const result = await eventService.getEventById(eventId, user);
	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Event Retrieved Successfully",
		data: result,
	});
});

const updateEvent = catchAsync(async (req: Request, res: Response) => {
	const eventId = req.params.eventId as string;
	const payload = req.body;
	const user = req.user!;

	const result = await eventService.updateEvent(eventId, payload, user);
	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Event Updated Successfully",
		data: result,
	});
});

const updateEventServices = catchAsync(async (req: Request, res: Response) => {
	const { eventId, serviceId } = req.params;
	const payload = req.body;
	const user = req.user!;

	const result = await eventService.updateEventService(
		eventId as string,
		serviceId as string,
		payload,
		user,
	);
	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Event Services updated Successfully",
		data: result,
	});
});

const publishEvent = catchAsync(async (req: Request, res: Response) => {
	const eventId = req.params.eventId as string;
	const user = req.user!;

	const result = await eventService.publishEvent(eventId, user);
	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Event Published Successfully",
		data: result,
	});
});

const deleteEvent = catchAsync(async (req: Request, res: Response) => {
	const eventId = req.params.eventId as string;
	const user = req.user!;

	const result = await eventService.deleteEvent(eventId, user);
	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Event Deleted Successfully",
		data: result,
	});
});

const deleteEventService = catchAsync(async (req: Request, res: Response) => {
	const { eventId, serviceId } = req.params;
	const user = req.user!;

	const result = await eventService.deleteEventService(
		eventId as string,
		serviceId as string,
		user,
	);
	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Event Service deleted Successfully",
		data: result,
	});
});

const getEventRequiredServices = catchAsync(
	async (req: Request, res: Response) => {
		const eventId = req.params.eventId;
		const user = req.user!;
		const data = await eventService.getEventRequiredServices(
			eventId as string,
			user,
		);
		sendResponse(res, {
			statusCode: httpStatus.OK,
			success: true,
			message: "Event required Services Retrieved Successfully",
			data,
		});
	},
);

export const eventController = {
	createEvent,
	createEventServices,
	updateEventServices,
	getAllPublishedEvents,
	getPublishedEventById,
	getPublishedEventsBoard,
	deleteEvent,
	publishEvent,
	getEventById,
	getMyEvents,
	updateEvent,
	deleteEventService,
	getEventRequiredServices,
};
