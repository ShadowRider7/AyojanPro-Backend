import httpStatus from "http-status";
import { cloudinary } from "../../lib/cloudinary";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import type { IEvidenceInput } from "./dispute.interface";
import { disputeService } from "./dispute.service";

const raiseDispute = catchAsync(async (req, res) => {
	const files = (req.files as Express.Multer.File[] | undefined) ?? [];

	const evidences: IEvidenceInput[] = [];
	for (const file of files) {
		const base64 = file.buffer.toString("base64");
		const dataUri = `data:${file.mimetype};base64,${base64}`;
		const cloudinaryResult = await cloudinary.uploader.upload(dataUri, {
			resource_type: "auto",
		});
		evidences.push({ mediaUrl: cloudinaryResult.secure_url });
	}

	const dispute = await disputeService.raiseDispute(
		req.params.id as string,
		req.body,
		evidences,
		req.user!,
	);

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Dispute raised successfully",
		data: dispute,
	});
});

const listDisputes = catchAsync(async (req, res) => {
	const disputes = await disputeService.listDisputes(req.user!, req.query);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Disputes retrieved successfully",
		data: disputes,
	});
});

const getDisputeDetails = catchAsync(async (req, res) => {
	const dispute = await disputeService.getDisputeDetails(
		req.params.id as string,
		req.user!,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Dispute retrieved successfully",
		data: dispute,
	});
});

const updateDisputeStatus = catchAsync(async (req, res) => {
	const dispute = await disputeService.updateDisputeStatus(
		req.params.id as string,
		req.body,
		req.user!,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Dispute status updated successfully",
		data: dispute,
	});
});

const resolveDispute = catchAsync(async (req, res) => {
	const dispute = await disputeService.resolveDispute(
		req.params.id as string,
		req.body.resolution,
		req.user!,
		req.body.refundClient === true,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Dispute resolved successfully",
		data: dispute,
	});
});

export const disputeController = {
	raiseDispute,
	listDisputes,
	getDisputeDetails,
	updateDisputeStatus,
	resolveDispute,
};
