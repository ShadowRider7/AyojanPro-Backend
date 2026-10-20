import { EventType } from "../../../generated/prisma/enums";

/**
 * The event types a client can pick when they create an event.
 *
 * The list is closed so the marketing home page, the header menu and every
 * filter can offer the same options. `OTHER` is the catch-all for anything
 * that does not fit the named types.
 */
export const EVENT_TYPE_VALUES = Object.values(EventType) as [
	EventType,
	...EventType[],
];

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
	[EventType.WEDDING]: "Wedding",
	[EventType.WEDDING_RECEPTION]: "Wedding reception",
	[EventType.BIRTHDAY]: "Birthday",
	[EventType.ANNIVERSARY]: "Anniversary",
	[EventType.CORPORATE]: "Corporate event",
	[EventType.CONFERENCE]: "Conference",
	[EventType.CONCERT]: "Concert",
	[EventType.FESTIVAL]: "Festival",
	[EventType.EXHIBITION]: "Exhibition",
	[EventType.SPORTS]: "Sports event",
	[EventType.OTHER]: "Other",
};
