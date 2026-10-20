import type { EventType } from "../../../generated/prisma/enums";

export interface IEventServiceRequirementCreate {
	serviceName: string;
	description?: string;
	budget: number;
	currency?: string;
	startAt: Date | string;
	endAt: Date | string;
}

export interface IEventUpdateServiceRequirement {
	serviceName?: string;
	description?: string;
	budget?: number;
	currency?: string;
	startAt?: Date | string;
	endAt?: Date | string;
}

export interface IEventCreate {
	title: string;
	description?: string;
	eventType?: EventType;
	city?: string;
	country?: string;
	address?: string;
	startAt: Date | string;
	endAt: Date | string;
}
export interface IUpdateEventPayload {
	title?: string;
	description?: string;
	eventType?: EventType;
	city?: string;
	country?: string;
	address?: string;
	startAt?: Date | string;
	endAt?: Date | string;
}
