import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { ConvexError } from "convex/values";
import { hashApiKey } from "../lib/apiKeys";
import { rateLimiter } from "../lib/rateLimit";
import { WALLET_NOT_CONFIGURED } from "../lib/wallet/errors";
import type { ActionCtx } from "../_generated/server";

/**
 * Shared by every resource dispatcher under convex/http/ — moved here
 * unchanged from the original single-file convex/httpApiV1.ts once that
 * file grew past one resource (customers) to six. See httpApiV1.ts's own
 * comment for why Convex needs this hand-rolled path matching at all
 * (only exact `path`/`pathPrefix` routing, no named-parameter routes).
 */

export const CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
	"Access-Control-Allow-Headers": "Authorization, Content-Type"
};

export function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...CORS_HEADERS }
	});
}

export function errorResponse(status: number, message: string): Response {
	return json({ error: message }, status);
}

export type ApiKeyContext = {
	organizationId: Id<"organizations">;
	shopId: Id<"shops"> | null;
	keyType: "secret" | "publishable";
};

/**
 * The single manual tenant-isolation check for this API (mirrors
 * src/lib/server/apiAuth.ts's requireApiKey exactly): every handler below
 * calls this first and filters every subsequent query against the
 * returned organizationId/shopId — Convex documents have no RLS
 * equivalent, so there is no other enforcement layer underneath this.
 */
export async function requireApiKey(
	ctx: ActionCtx,
	request: Request,
	opts: { requireSecret?: boolean } = {}
): Promise<ApiKeyContext | Response> {
	const authHeader = request.headers.get("authorization") ?? "";
	const match = authHeader.match(/^Bearer\s+(.+)$/i);
	if (!match) {
		return errorResponse(401, "Missing or malformed Authorization header.");
	}

	const hashedKey = await hashApiKey(match[1]);

	// Keyed by the presented key's own hash — see httpApiV1.ts's git
	// history for the full rationale (unchanged from there).
	try {
		const rateLimitResult = await rateLimiter.limit(ctx, "apiRequest", { key: hashedKey });
		if (!rateLimitResult.ok) {
			const response = errorResponse(429, "Too many requests. Please slow down and try again shortly.");
			response.headers.set("Retry-After", String(Math.ceil(rateLimitResult.retryAfter / 1000)));
			return response;
		}
	} catch (err) {
		console.error("Rate limiter error — failing open", err);
	}

	const key = await ctx.runQuery(internal.apiInternal.resolveApiKey, { hashedKey });

	if (!key || key.revoked) {
		return errorResponse(401, "Invalid or revoked API key.");
	}
	if (opts.requireSecret && key.type !== "secret") {
		return errorResponse(403, "This endpoint requires a secret key.");
	}

	return { organizationId: key.organizationId, shopId: key.shopId ?? null, keyType: key.type };
}

export function assertShopInScope(apiCtx: ApiKeyContext, requestedShopId: Id<"shops">): Response | null {
	if (apiCtx.shopId !== null && apiCtx.shopId !== requestedShopId) {
		return errorResponse(403, "This API key is not scoped to the requested shop.");
	}
	return null;
}

export function isWalletNotConfigured(err: unknown): err is ConvexError<{ code: string; message: string }> {
	return err instanceof ConvexError && (err.data as { code?: string } | undefined)?.code === WALLET_NOT_CONFIGURED;
}

/** Extracts `/v1/shops/:shopId/...rest` from a pathname, or null if it doesn't match. */
export function matchShopsPath(pathname: string): { shopId: string; rest: string[] } | null {
	const segments = pathname.split("/").filter(Boolean);
	if (segments[0] !== "v1" || segments[1] !== "shops" || !segments[2]) return null;
	return { shopId: segments[2], rest: segments.slice(3) };
}

/** Segments of a pathname with empty parts removed, e.g. "/v1/tiers/abc" -> ["v1","tiers","abc"]. */
export function segments(pathname: string): string[] {
	return pathname.split("/").filter(Boolean);
}
