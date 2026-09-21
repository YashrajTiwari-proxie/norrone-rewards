import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireApiKey, errorResponse, segments } from "./http/shared";
import { dispatchCustomers } from "./http/customers";
import { dispatchMembershipPlans } from "./http/membershipPlans";
import { dispatchTiers } from "./http/tiers";
import { dispatchRewards } from "./http/rewards";
import { dispatchCoupons } from "./http/coupons";
import { resolveRedeemCode } from "./lib/couponSigning";

/**
 * Composition root for the public /v1/... API (convex/http.ts registers
 * one route per HTTP method, pointing here). Each resource lives in its
 * own file under convex/http/ (customers, membershipPlans, tiers,
 * rewards, coupons) — this file just tries each dispatcher in turn and
 * 404s if none matched. See convex/http/shared.ts for the auth/CORS
 * helpers every dispatcher shares, and convex/http/customers.ts's own
 * comment for why customers stay under /v1/shops/:shopId/... while the
 * other four resources are org-scoped at /v1/<resource>.
 *
 * The one route handled directly here rather than in a dispatcher:
 * POST /v1/coupons/:code/redeem — an action on a coupon *instance* (by
 * its signed code), not CRUD on a coupon *definition*, and doesn't fit
 * either shape cleanly. Tried before dispatchCoupons so it's never
 * shadowed by that dispatcher's /v1/coupons/:id routes (different
 * segment count/literal, but kept explicit and first regardless).
 */

async function handleRedeem(ctx: Parameters<typeof dispatchCustomers>[0], request: Request): Promise<Response | null> {
	const url = new URL(request.url);
	const segs = segments(url.pathname);
	if (!(segs[0] === "v1" && segs[1] === "coupons" && segs[2] && segs[3] === "redeem" && segs.length === 4)) return null;

	const apiCtxOrError = await requireApiKey(ctx, request, { requireSecret: true });
	if (apiCtxOrError instanceof Response) return apiCtxOrError;
	const apiCtx = apiCtxOrError;

	const resolved = await resolveRedeemCode(segs[2]);
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
	return new Response(JSON.stringify({ redeemed: true }), { status: 200, headers: { "content-type": "application/json" } });
}

const DISPATCHERS = [dispatchCustomers, dispatchMembershipPlans, dispatchTiers, dispatchRewards, dispatchCoupons];

async function dispatch(ctx: Parameters<typeof dispatchCustomers>[0], request: Request): Promise<Response> {
	const redeemResponse = await handleRedeem(ctx, request);
	if (redeemResponse) return redeemResponse;

	for (const dispatcher of DISPATCHERS) {
		const response = await dispatcher(ctx, request);
		if (response) return response;
	}
	return errorResponse(404, "Not found.");
}

export const handleV1Get = httpAction(dispatch);
export const handleV1Post = httpAction(dispatch);
export const handleV1Put = httpAction(dispatch);
export const handleV1Delete = httpAction(dispatch);
