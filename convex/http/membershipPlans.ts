import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { requireApiKey, json, errorResponse, segments, getOrNull } from "./shared";

/**
 * GET/POST /v1/membership-plans, GET/PUT/DELETE /v1/membership-plans/:id
 * — org-scoped (membership plans are an org-level resource, optionally
 * narrowed to one shop via an internal shopId field — see schema.ts),
 * unlike customers which are genuinely shop-scoped and stay under
 * /v1/shops/:shopId/... See convex/membershipPlans.ts for the
 * internalList/internalGet/internalCreate/internalUpdate/internalRemove
 * this wraps — same logic the dashboard uses, just API-key-authenticated
 * instead of Better-Auth-session-authenticated.
 */
export async function dispatchMembershipPlans(ctx: ActionCtx, request: Request): Promise<Response | null> {
	const url = new URL(request.url);
	const segs = segments(url.pathname);
	if (segs[0] !== "v1" || segs[1] !== "membership-plans") return null;
	const id = segs[2] as Id<"membershipPlans"> | undefined;
	if (segs.length > 3) return null;

	const isWrite = request.method !== "GET";
	const apiCtxOrError = await requireApiKey(ctx, request, { requireSecret: isWrite });
	if (apiCtxOrError instanceof Response) return apiCtxOrError;
	const apiCtx = apiCtxOrError;

	if (request.method === "GET" && !id) {
		const shopId = url.searchParams.get("shopId") as Id<"shops"> | null;
		let plans = await ctx.runQuery(internal.membershipPlans.internalList, { organizationId: apiCtx.organizationId });
		if (shopId) plans = plans.filter((p) => p.shopId === shopId || p.shopId == null);
		return json(plans);
	}

	if (request.method === "GET" && id) {
		const plan = await getOrNull(() => ctx.runQuery(internal.membershipPlans.internalGet, { organizationId: apiCtx.organizationId, planId: id }));
		if (!plan) return errorResponse(404, "Membership plan not found.");
		return json(plan);
	}

	if (request.method === "POST" && !id) {
		const body = await request.json().catch(() => null);
		if (!body || typeof body.name !== "string" || !body.name) return errorResponse(400, "name is required.");
		if (typeof body.pointMultiplier !== "number") return errorResponse(400, "pointMultiplier is required.");
		const planId = await ctx.runMutation(internal.membershipPlans.internalCreate, {
			organizationId: apiCtx.organizationId,
			name: body.name,
			price: typeof body.price === "number" ? body.price : undefined,
			durationDays: typeof body.durationDays === "number" ? body.durationDays : undefined,
			pointMultiplier: body.pointMultiplier,
			shopId: typeof body.shopId === "string" ? (body.shopId as Id<"shops">) : undefined
		});
		const plan = await ctx.runQuery(internal.membershipPlans.internalGet, { organizationId: apiCtx.organizationId, planId });
		return json(plan, 201);
	}

	if (request.method === "PUT" && id) {
		const existing = await getOrNull(() => ctx.runQuery(internal.membershipPlans.internalGet, { organizationId: apiCtx.organizationId, planId: id }));
		if (!existing) return errorResponse(404, "Membership plan not found.");
		const body = await request.json().catch(() => null);
		if (!body || typeof body.name !== "string" || !body.name) return errorResponse(400, "name is required.");
		if (typeof body.pointMultiplier !== "number") return errorResponse(400, "pointMultiplier is required.");
		await ctx.runMutation(internal.membershipPlans.internalUpdate, {
			organizationId: apiCtx.organizationId,
			planId: id,
			name: body.name,
			price: typeof body.price === "number" ? body.price : undefined,
			durationDays: typeof body.durationDays === "number" ? body.durationDays : undefined,
			pointMultiplier: body.pointMultiplier,
			shopId: typeof body.shopId === "string" ? (body.shopId as Id<"shops">) : undefined
		});
		const plan = await getOrNull(() => ctx.runQuery(internal.membershipPlans.internalGet, { organizationId: apiCtx.organizationId, planId: id }));
		return json(plan);
	}

	if (request.method === "DELETE" && id) {
		const existing = await getOrNull(() => ctx.runQuery(internal.membershipPlans.internalGet, { organizationId: apiCtx.organizationId, planId: id }));
		if (!existing) return errorResponse(404, "Membership plan not found.");
		await ctx.runMutation(internal.membershipPlans.internalRemove, { organizationId: apiCtx.organizationId, planId: id });
		return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
	}

	return errorResponse(404, "Not found.");
}
