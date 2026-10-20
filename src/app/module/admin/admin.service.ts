import httpStatus from "http-status";
import {
	type ContractStatus,
	type EventStatus,
	type PaymentStage,
	type PaymentStatus,
	Role,
	type UserStatus,
} from "../../../generated/prisma/enums";
import type { IQuery } from "../../interfaces";
import { prisma } from "../../lib/prisma";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { RefundService } from "../payment/refund.service";
import type { IUpdateRefundStatus, IUpdateUserStatus } from "./admin.interface";

const searchFilter = (search: string) => ({
	OR: [
		{ name: { contains: search, mode: "insensitive" as const } },
		{ email: { contains: search, mode: "insensitive" as const } },
	],
});

const listUsers = async (query: IQuery) => {
	const { role, status, search } = query;

	return prisma.user.findMany({
		where: {
			isDeleted: false,
			...(role ? { role: role as Role } : {}),
			...(status ? { status: status as UserStatus } : {}),
			...(search ? searchFilter(search) : {}),
		},
		omit: {
			password: true,
		},
		include: { client: true, professional: true },
		orderBy: { createdAt: "desc" },
	});
};

const listEvents = async (query: IQuery) => {
	const { status } = query;

	return prisma.event.findMany({
		where: {
			isDeleted: false,
			...(status ? { status: status as EventStatus } : {}),
		},
		include: {
			client: {
				include: {
					user: {
						omit: {
							password: true,
						},
					},
				},
			},
			serviceRequirements: true,
		},
		orderBy: { createdAt: "desc" },
	});
};

const listContracts = async (query: IQuery) => {
	const { status } = query;

	return prisma.contract.findMany({
		where: status ? { status: status as ContractStatus } : undefined,
		include: {
			client: {
				include: {
					user: {
						select: {
							id: true,
							name: true,
							email: true,
							imageUrl: true,
						},
					},
				},
			},
			professional: true,
			event: true,
			eventServiceRequirement: true,
			professionalService: true,
			payments: true,
		},
		orderBy: { createdAt: "desc" },
	});
};

const listPayments = async (query: IQuery) => {
	const { status, stage } = query;

	return prisma.payment.findMany({
		where: {
			...(status ? { status: status as PaymentStatus } : {}),
			...(stage ? { stage: stage as PaymentStage } : {}),
		},
		include: { contract: true, client: true, refund: true },
		orderBy: { createdAt: "desc" },
	});
};

const listRefunds = async (query: IQuery) => {
	return RefundService.listRefunds({ status: query.status });
};

const settleRefund = async (refundId: string, payload: IUpdateRefundStatus) => {
	return RefundService.settleRefund(refundId, payload);
};

const updateUserStatus = async (
	targetUserId: string,
	payload: IUpdateUserStatus,
	adminUser: RequestUser,
) => {
	if (targetUserId === adminUser.userId) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"You cannot change your own account status here",
		);
	}

	const targetUser = await prisma.user.findUnique({
		where: { id: targetUserId },
	});

	if (!targetUser || targetUser.isDeleted) {
		throw new AppError(httpStatus.NOT_FOUND, "User Not Found");
	}

	if (targetUser.role === Role.ADMIN) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"Admin accounts cannot be suspended or blocked through this endpoint",
		);
	}

	return prisma.user.update({
		where: { id: targetUserId },
		data: { status: payload.status },
		omit: {
			password: true,
		},
	});
};

export const adminService = {
	listUsers,
	listEvents,
	listContracts,
	listPayments,
	listRefunds,
	settleRefund,
	updateUserStatus,
};
