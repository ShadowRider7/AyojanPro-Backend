import { z } from "zod";

const raiseDisputeZodSchema = z.object({
	params: z.object({
		id: z.string().min(1, "Contract ID is required"),
	}),
	body: z.object({
		reason: z
			.string()
			.min(3, "Reason must be at least 3 characters")
			.max(255, "Reason cannot exceed 255 characters"),
		description: z
			.string()
			.min(10, "Please describe the issue in more detail")
			.max(5000, "Description cannot exceed 5000 characters"),
	}),
});

const listDisputesSchema = z.object({
	query: z.object({
		status: z
			.enum(["OPEN", "UNDER_REVIEW", "RESOLVED", "REJECTED", "CLOSED"])
			.optional(),
	}),
});

const getDisputeDetailsSchema = z.object({
	params: z.object({
		id: z.string().min(1, "Dispute ID is required"),
	}),
});

const updateDisputeStatusZodSchema = z.object({
	params: z.object({
		id: z.string().min(1, "Dispute ID is required"),
	}),
	body: z.object({
		status: z.enum(["OPEN", "UNDER_REVIEW", "REJECTED", "CLOSED"], {
			message: "Status must be OPEN, UNDER_REVIEW, REJECTED, or CLOSED",
		}),
	}),
});

const resolveDisputeZodSchema = z.object({
	params: z.object({
		id: z.string().min(1, "Dispute ID is required"),
	}),
	body: z.object({
		resolution: z
			.string()
			.min(10, "Please provide a resolution summary")
			.max(5000, "Resolution cannot exceed 5000 characters"),
		// The platform holds the client's money in escrow. When the dispute is
		// resolved in the client's favour the escrow goes back to them.
		refundClient: z.boolean().optional(),
	}),
});

export const disputeValidator = {
	raiseDisputeZodSchema,
	listDisputesSchema,
	getDisputeDetailsSchema,
	updateDisputeStatusZodSchema,
	resolveDisputeZodSchema,
};
