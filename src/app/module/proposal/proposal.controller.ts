import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { proposalService } from "./proposal.service";

const createProposal = catchAsync(async (req, res) => {
	const proposal = await proposalService.createProposal(
		req.params.eventId as string,
		req.body,
		req.user!,
	);

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Proposal submitted successfully",
		data: proposal,
	});
});

const getProposals = catchAsync(async (req, res) => {
	const proposals = await proposalService.getProposals(
		req.params.requirementId as string,
		req.user!,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Proposals retrieved successfully",
		data: proposals,
	});
});

const getMyProposals = catchAsync(async (req, res) => {
	const proposals = await proposalService.getMyProposals(req.user!);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Proposals retrieved successfully",
		data: proposals,
	});
});

const getProposalDetails = catchAsync(async (req, res) => {
	const proposal = await proposalService.getProposalDetails(
		req.params.id as string,
		req.user!,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Proposal retrieved successfully",
		data: proposal,
	});
});

// NOTE: `:proposalId` here refers to a Proposal id. Acceptance/rejection/
// withdrawal happens per Proposal, acting on all its pending items.
const acceptProposal = catchAsync(async (req, res) => {
	const result = await proposalService.acceptProposal(
		req.params.proposalId as string,
		req.user!,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Proposal accepted, contract created",
		data: result,
	});
});

const rejectProposal = catchAsync(async (req, res) => {
	const result = await proposalService.rejectProposal(
		req.params.proposalId as string,
		req.user!,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Proposal rejected",
		data: result,
	});
});

const withdrawProposal = catchAsync(async (req, res) => {
	const result = await proposalService.withdrawProposal(
		req.params.proposalId as string,
		req.user!,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Proposal withdrawn",
		data: result,
	});
});

export const proposalController = {
	createProposal,
	getProposals,
	getMyProposals,
	getProposalDetails,
	acceptProposal,
	rejectProposal,
	withdrawProposal,
};
