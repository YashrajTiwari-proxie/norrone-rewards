import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { hashApiKey } from "./lib/apiKeys";
import { resolveRedeemCode } from "./lib/couponSigning";
import type { ActionCtx } from "./_generated/server";

/**
 * Port of src/routes/v1/... (SvelteKit +server.ts handlers) onto Convex
 * httpActions. httpActions have no ctx.db, so every DB read/write goes
 * through convex/apiInternal.ts or convex/engine.ts via
 * ctx.runQuery/ctx.runMutation — see those files' own comments.
 *
 * Convex's httpRouter only matches an exact `path` or a `pathPrefix` (no
 * named-parameter routes like SvelteKit's [shopId]), so each HTTP method
 * gets ONE route registered under pathPrefix "/v1/" here, and this file
 * does the /shops/:shopId/... segment matching by hand.
 *
 * Wallet-pass endpoints (.../wallet/apple, .../wallet/google) are NOT
 * ported — wallet passes are paused until real Apple/Google credentials
 * exist, per the migration plan.
 *
 * CORS: the API Keys dashboard page explicitly markets a "Publishable —
 * read-only, safe client-side" key type, meaning a storefront's own
 * browser JS is a supported caller — so every response here carries a
 * permissive Access-Control-Allow-Origin (this is public/read-mostly
 * per-org data behind a bearer key, not cookie-authenticated, so `*` has
 * no confused-deputy risk the way it would for a cookie-based API). The
 * OPTIONS preflight itself is handled in http.ts.
 */

const CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
	"Access-Control-Allow-Headers": "Authorization, Content-Type"
};

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...CORS_HEADERS }
	});
}

function errorResponse(status: number, message: string): Response {
	return json({ error: message }, status);
}

type ApiKeyContext = {
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
async function requireApiKey(
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
	const key = await ctx.runQuery(internal.apiInternal.resolveApiKey, { hashedKey });

	if (!key || key.revoked) {
		return errorResponse(401, "Invalid or revoked API key.");
	}
	if (opts.requireSecret && key.type !== "secret") {
		return errorResponse(403, "This endpoint requires a secret key.");
	}

	return { organizationId: key.organizationId, shopId: key.shopId ?? null, keyType: key.type };
}

function assertShopInScope(apiCtx: ApiKeyContext, requestedShopId: Id<"shops">): Response | null {
	if (apiCtx.shopId !== null && apiCtx.shopId !== requestedShopId) {
		return errorResponse(403, "This API key is not scoped to the requested shop.");
	}
	return null;
}

/** Extracts `/v1/shops/:shopId/...rest` from a pathname, or null if it doesn't match. */
function matchShopsPath(pathname: string): { shopId: string; rest: string[] } | null {
	const segments = pathname.split("/").filter(Boolean);
	if (segments[0] !== "v1" || segments[1] !== "shops" || !segments[2]) return null;
	return { shopId: segments[2], rest: segments.slice(3) };
}

export const handleV1Get = httpAction(async (ctx, request) => {
	const url = new URL(request.url);
	const shopsMatch = matchShopsPath(url.pathname);
	if (!shopsMatch) return errorResponse(404, "Not found.");

	const apiCtxOrError = await requireApiKey(ctx, request);
	if (apiCtxOrError instanceof Response) return apiCtxOrError;
	const apiCtx = apiCtxOrError;

	const shopId = shopsMatch.shopId as Id<"shops">;
	const scopeError = assertShopInScope(apiCtx, shopId);
	if (scopeError) return scopeError;

	const shop = await ctx.runQuery(internal.apiInternal.getShopInScope, {
		shopId,
		organizationId: apiCtx.organizationId
	});
	if (!shop) return errorResponse(404, "Shop not found.");

	// GET /v1/shops/:shopId/offers
	if (shopsMatch.rest.length === 1 && shopsMatch.rest[0] === "offers") {
		const offers = await ctx.runQuery(internal.apiInternal.getPublicOffers, {
			organizationId: apiCtx.organizationId,
			shopId
		});
		return json(offers);
	}

	// GET /v1/shops/:shopId/customers/:externalId(/offers)
	if (shopsMatch.rest[0] === "customers" && shopsMatch.rest[1]) {
		const externalId = shopsMatch.rest[1];

		if (shopsMatch.rest.length === 3 && shopsMatch.rest[2] === "offers") {
			const customer = await ctx.runQuery(internal.apiInternal.getCustomerByExternalId, { shopId, externalId });
			if (!customer) return errorResponse(404, "Customer not found.");
			const offers = await ctx.runQuery(internal.apiInternal.getPersonalizedOffers, { customerId: customer._id });
			return json(offers);
		}

		if (shopsMatch.rest.length === 2) {
			const view = await ctx.runQuery(internal.apiInternal.getCustomerView, { shopId, externalId });
			if (!view) return errorResponse(404, "Customer not found.");
			return json(view);
		}
	}

	return errorResponse(404, "Not found.");
});

export const handleV1Post = httpAction(async (ctx, request) => {
	const url = new URL(request.url);

	// POST /v1/coupons/:code/redeem
	const couponsSegments = url.pathname.split("/").filter(Boolean);
	if (
		couponsSegments[0] === "v1" &&
		couponsSegments[1] === "coupons" &&
		couponsSegments[2] &&
		couponsSegments[3] === "redeem" &&
		couponsSegments.length === 4
	) {
		const apiCtxOrError = await requireApiKey(ctx, request, { requireSecret: true });
		if (apiCtxOrError instanceof Response) return apiCtxOrError;
		const apiCtx = apiCtxOrError;

		const resolved = await resolveRedeemCode(couponsSegments[2]);
		if ("error" in resolved) {
			return errorResponse(400, "Coupon signature is invalid — this code may have been tampered with.");
		}

		const result = await ctx.runMutation(internal.engine.redeemCouponAction, {
			code: resolved.code,
			organizationId: apiCtx.organizationId
		});

		if ("error" in result) {
			const statusByError = { NOT_FOUND: 404, ALREADY_REDEEMED: 409, NOT_REDEEMABLE: 409, EXPIRED: 410 } as const;
			return errorResponse(statusByError[result.error], result.error);
		}
		return json({ redeemed: true });
	}

	const shopsMatch = matchShopsPath(url.pathname);
	if (!shopsMatch) return errorResponse(404, "Not found.");

	const apiCtxOrError = await requireApiKey(ctx, request, { requireSecret: true });
	if (apiCtxOrError instanceof Response) return apiCtxOrError;
	const apiCtx = apiCtxOrError;

	const shopId = shopsMatch.shopId as Id<"shops">;
	const scopeError = assertShopInScope(apiCtx, shopId);
	if (scopeError) return scopeError;

	const shop = await ctx.runQuery(internal.apiInternal.getShopInScope, {
		shopId,
		organizationId: apiCtx.organizationId
	});
	if (!shop) return errorResponse(404, "Shop not found.");

	const body = await request.json().catch(() => null);

	// POST /v1/shops/:shopId/customers
	if (shopsMatch.rest.length === 1 && shopsMatch.rest[0] === "customers") {
		if (!body || typeof body.externalId !== "string" || !body.externalId) {
			return errorResponse(400, "externalId is required.");
		}
		const result = await ctx.runMutation(internal.apiInternal.createCustomer, {
			organizationId: apiCtx.organizationId,
			shopId,
			externalId: body.externalId,
			name: typeof body.name === "string" ? body.name : undefined,
			phone: typeof body.phone === "string" ? body.phone : undefined,
			email: typeof body.email === "string" ? body.email : undefined
		});
		if (result.conflict) {
			return errorResponse(409, "A customer with this externalId already exists for this shop.");
		}
		return json(result.view, 201);
	}

	if (shopsMatch.rest[0] === "customers" && shopsMatch.rest[1]) {
		const externalId = shopsMatch.rest[1];

		// POST /v1/shops/:shopId/customers/:externalId/membership
		if (shopsMatch.rest.length === 3 && shopsMatch.rest[2] === "membership") {
			if (!body || typeof body.planId !== "string" || !body.planId) {
				return errorResponse(400, "planId is required.");
			}
			const customer = await ctx.runQuery(internal.apiInternal.getCustomerByExternalId, { shopId, externalId });
			if (!customer) return errorResponse(404, "Customer not found.");

			const plan = await ctx.runQuery(internal.apiInternal.getMembershipPlanInScope, {
				planId: body.planId as Id<"membershipPlans">,
				organizationId: apiCtx.organizationId,
				shopId
			});
			if (!plan) return errorResponse(404, "Membership plan not found.");

			await ctx.runMutation(internal.engine.enrollMembershipAction, {
				customerId: customer._id,
				planId: plan._id,
				idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined
			});

			const view = await ctx.runQuery(internal.apiInternal.getCustomerView, { shopId, externalId });
			return json(view, 201);
		}
	}

	return errorResponse(404, "Not found.");
});

export const handleV1Put = httpAction(async (ctx, request) => {
	const url = new URL(request.url);
	const shopsMatch = matchShopsPath(url.pathname);
	if (!shopsMatch || shopsMatch.rest[0] !== "customers" || !shopsMatch.rest[1] || shopsMatch.rest.length !== 2) {
		return errorResponse(404, "Not found.");
	}

	const apiCtxOrError = await requireApiKey(ctx, request, { requireSecret: true });
	if (apiCtxOrError instanceof Response) return apiCtxOrError;
	const apiCtx = apiCtxOrError;

	const shopId = shopsMatch.shopId as Id<"shops">;
	const scopeError = assertShopInScope(apiCtx, shopId);
	if (scopeError) return scopeError;

	const shop = await ctx.runQuery(internal.apiInternal.getShopInScope, {
		shopId,
		organizationId: apiCtx.organizationId
	});
	if (!shop) return errorResponse(404, "Shop not found.");

	const externalId = shopsMatch.rest[1];
	const customer = await ctx.runQuery(internal.apiInternal.getCustomerByExternalId, { shopId, externalId });
	if (!customer) return errorResponse(404, "Customer not found.");

	const body = await request.json().catch(() => null);
	if (!body) return errorResponse(400, "Invalid JSON body.");

	// PUT /v1/shops/:shopId/customers/:externalId — update_customer_stats
	const result = await ctx.runMutation(internal.engine.updateCustomerStatsAction, {
		customerId: customer._id,
		deltaSpend: typeof body.deltaSpend === "number" ? body.deltaSpend : undefined,
		deltaVisits: typeof body.deltaVisits === "number" ? body.deltaVisits : undefined,
		action: typeof body.action === "string" ? body.action : undefined,
		idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined
	});

	const view = await ctx.runQuery(internal.apiInternal.getCustomerView, { shopId, externalId });

	if ("idempotent" in result) {
		return json(view);
	}

	const grantedTiers = result.newlyGranted.tiers;
	return json({
		...view,
		newlyGranted: {
			tier: grantedTiers.length > 0 ? { name: grantedTiers[0].name } : null,
			rewards: result.newlyGranted.rewards,
			coupons: result.newlyGranted.coupons
		}
	});
});
