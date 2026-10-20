import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { ReviewServices } from "./review.service";

const createReview = catchAsync(async (req: Request, res: Response) => {
	const contractId = req.params.id;
	const payload = req.body;
	const user = req.user!;

	const result = await ReviewServices.createReview(
		contractId as string,
		payload,
		user,
	);

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Review Submitted Successfully",
		data: result,
	});
});

const getProfessionalReviews = catchAsync(
	async (req: Request, res: Response) => {
		const user = req.user!;

		const result = await ReviewServices.getProfessionalReviews(user, req.query);

		sendResponse(res, {
			statusCode: httpStatus.OK,
			success: true,
			message: "Professional Reviews Fetched Successfully",
			data: result,
		});
	},
);

const getClientReviews = catchAsync(async (req: Request, res: Response) => {
	const user = req.user!;

	const result = await ReviewServices.getClientReviews(user, req.query);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Client Reviews Fetched Successfully",
		data: result,
	});
});

export const ReviewController = {
	createReview,
	getProfessionalReviews,
	getClientReviews,
};
