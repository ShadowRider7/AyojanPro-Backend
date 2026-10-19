import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { adminService } from "./admin.service";

const listUsers = catchAsync(async (req, res) => {
	const users = await adminService.listUsers(req.query);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Users retrieved successfully",
		data: users,
	});
});

const listEvents = catchAsync(async (req, res) => {
	const events = await adminService.listEvents(req.query);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Events retrieved successfully",
		data: events,
	});
});

const listContracts = catchAsync(async (req, res) => {
	const contracts = await adminService.listContracts(req.query);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Contracts retrieved successfully",
		data: contracts,
	});
});

const listPayments = catchAsync(async (req, res) => {
	const payments = await adminService.listPayments(req.query);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Payments retrieved successfully",
		data: payments,
	});
});

const listRefunds = catchAsync(async (req, res) => {
	const refunds = await adminService.listRefunds(req.query);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Refunds retrieved successfully",
		data: refunds,
	});
});

const settleRefund = catchAsync(async (req, res) => {
	const refund = await adminService.settleRefund(
		req.params.id as string,
		req.body,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Refund settled successfully",
		data: refund,
	});
});

const updateUserStatus = catchAsync(async (req, res) => {
	const user = await adminService.updateUserStatus(
		req.params.id as string,
		req.body,
		req.user!,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "User status updated successfully",
		data: user,
	});
});

export const adminController = {
	listUsers,
	listEvents,
	listContracts,
	listPayments,
	listRefunds,
	settleRefund,
	updateUserStatus,
};
