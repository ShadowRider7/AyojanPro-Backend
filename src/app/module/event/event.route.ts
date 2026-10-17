import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { eventController } from "./event.controller";
import { eventValidator } from "./event.validation";

const router = Router();

router.post(
	"/",
	auth(Role.CLIENT),
	validateRequest(eventValidator.eventCreateSchema),
	eventController.createEvent,
);

router.post(
	"/services/:eventId",
	auth(Role.CLIENT),
	validateRequest(eventValidator.eventServiceRequirementCreateSchema),
	eventController.createEventServices,
);

router.get(
	"/all-events",
	auth(Role.ADMIN, Role.PROFESSIONAL),
	eventController.getAllPublishedEvents,
);

router.get("/my-events", auth(Role.CLIENT), eventController.getMyEvents);

router.patch(
	"/update/:eventId",
	auth(Role.CLIENT),
	validateRequest(eventValidator.eventUpdateSchema),
	eventController.updateEvent,
);

router.get(
	"/:eventId/required-services",
	eventController.getEventRequiredServices,
);
router.patch(
	"/update/:eventId/services/:serviceId",
	auth(Role.CLIENT),
	validateRequest(eventValidator.eventServiceRequirementUpdateSchema),
	eventController.updateEventServices,
);

router.delete(
	"/:eventId/services/:serviceId",
	auth(Role.CLIENT),
	eventController.deleteEventService,
);
router.get("/:eventId", eventController.getEventById);

router.patch(
	"/publish-event/:eventId",
	auth(Role.CLIENT),
	eventController.publishEvent,
);

router.delete(
	"/:eventId",
	auth(Role.CLIENT, Role.ADMIN),
	eventController.deleteEvent,
);

export const EventRoutes = router;
