import { z } from "zod";

const updateUserStatusZodSchema = z.object({
	body: z.object({
		status: z.enum(["ACTIVE", "SUSPENDED", "BLOCKED"]),
	}),
});

const settleRefundZodSchema = z.object({
	body: z.object({
		status: z.enum(["COMPLETED", "FAILED"]),
		note: z.string().max(2000, "Note cannot exceed 2000 characters").optional(),
		reference: z.string().max(255).optional(),
	}),
});

export const adminValidator = {
	updateUserStatusZodSchema,
	settleRefundZodSchema,
};
