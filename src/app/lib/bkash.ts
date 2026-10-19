import httpStatus from "http-status";
import config from "../config";
import { AppError } from "../utils/AppError";
import { redisClient } from "./redis";

export type BkashRefundResult =
	| { status: "completed"; reference: string | null }
	| { status: "pending"; reference: null; message: string }
	| { status: "failed"; reference: null; message: string };

/**
 * Refunds a captured bKash payment back to the client.
 *
 * The bKash tokenized checkout API only creates and executes payments — it
 * does not expose a public refund endpoint. When the merchant configures
 * BKASH_REFUND_URL the refund is forwarded to that endpoint, otherwise the
 * refund is queued for manual settlement (an admin settles it from the admin
 * panel) so the client is still recorded as owed the money.
 */
export const requestBkashRefund = async (input: {
	transactionId: string | null;
	amount: string;
	currency: string;
	reason: string;
	merchantInvoiceNumber?: string | null;
}): Promise<BkashRefundResult> => {
	if (!config.bkash_refund_url) {
		return {
			status: "pending",
			reference: null,
			message:
				"No bKash refund endpoint is configured — the refund is queued for manual settlement.",
		};
	}

	try {
		const bkashIdToken = await getBkashIdToken();

		if (!bkashIdToken) {
			return {
				status: "failed",
				reference: null,
				message: "No Bkash Access Token Found!",
			};
		}

		const response = await fetch(config.bkash_refund_url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
				Authorization: bkashIdToken,
				"X-App-Key": config.bkash_app_key,
			},
			body: JSON.stringify({
				trxID: input.transactionId,
				amount: input.amount,
				currency: input.currency,
				reason: input.reason,
				merchantInvoiceNumber: input.merchantInvoiceNumber,
			}),
		});

		const result = await response.json().catch(() => ({}));

		if (!response.ok) {
			return {
				status: "failed",
				reference: null,
				message:
					result?.statusMessage ??
					result?.message ??
					`The bKash refund request failed with status ${response.status}`,
			};
		}

		return {
			status: "completed",
			reference:
				result?.refundTrxId ?? result?.trxID ?? result?.transactionId ?? null,
		};
	} catch (error: any) {
		return {
			status: "failed",
			reference: null,
			message: error?.message ?? "The bKash refund request failed",
		};
	}
};

export const getBkashIdToken = async () => {
	try {
		const IdTokenKey = "bkash:idToken";
		const RefreshTokenKey = "bkash:refreshToken";

		let bkashIdToken = await redisClient.get(IdTokenKey);
		const bkashIdTokenTTL = await redisClient.ttl(IdTokenKey);

		const bkashRefreshToken = await redisClient.get(RefreshTokenKey);
		const bkashRefreshTokenTTL = await redisClient.ttl(RefreshTokenKey);

		if (
			(bkashIdTokenTTL <= 600 || !bkashIdToken) &&
			bkashRefreshToken &&
			bkashRefreshTokenTTL > 600
		) {
			const refreshTokenResponse = await fetch(
				`${config.bkash_base_url}/tokenized/checkout/token/refresh`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Accept: "application/json",
						username: config.bkash_username,
						password: config.bkash_password,
					},
					body: JSON.stringify({
						app_key: config.bkash_app_key,
						app_secret: config.bkash_app_secret,
						refresh_token: bkashRefreshToken,
					}),
				},
			);
			if (!refreshTokenResponse.ok) {
				throw new Error("Bkash Access Token Grant Failed");
			}

			const bkashRefreshTokenResult = await refreshTokenResponse.json();

			bkashIdToken = bkashRefreshTokenResult.id_token as string;

			await redisClient.set(IdTokenKey, bkashIdToken, {
				expiration: {
					type: "EX",
					value: 60 * 60,
				},
			});

			return bkashIdToken;
		}

		if (bkashIdTokenTTL > 600) {
			return bkashIdToken;
		}

		const response = await fetch(
			`${config.bkash_base_url}/tokenized/checkout/token/grant`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
					username: config.bkash_username,
					password: config.bkash_password,
				},
				body: JSON.stringify({
					app_key: config.bkash_app_key,
					app_secret: config.bkash_app_secret,
				}),
			},
		);

		if (!response.ok) {
			throw new Error("Bkash Access Token Grant Failed");
		}

		const result = await response.json();

		//bkash id token set
		await redisClient.set(IdTokenKey, result.id_token, {
			expiration: {
				type: "EX",
				value: 60 * 60, // 1hour
			},
		});

		//bkash refresh token set
		await redisClient.set(RefreshTokenKey, result.refresh_token, {
			expiration: {
				type: "EX",
				value: 60 * 60 * 24 * 28, // 28 days
			},
		});

		bkashIdToken = result.id_token;

		return bkashIdToken;
	} catch (error: any) {
		if (error instanceof AppError) {
			throw error;
		}
		throw new AppError(httpStatus.BAD_GATEWAY, error.message);
	}
};
