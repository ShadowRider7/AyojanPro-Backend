import type {
	EventType,
	ServiceRequirementStatus,
} from "../../generated/prisma/enums";

export interface IQuery {
	searchTerm?: string;
	page?: string;
	limit?: string;
	sortOrder?: string;
	sortBy?: string;

	//any other filter fields can be added here
	[key: string]: any;
}
export interface getEvent extends IQuery {
	status?: ServiceRequirementStatus;
	eventType?: EventType;
}
