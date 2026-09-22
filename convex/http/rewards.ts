import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { requireApiKey, json, errorResponse, segments, getOrNull } from "./shared";

/** GET/POST /v1/rewards, GET/PUT/DELETE /v1/rewards/:id — see membershipPlans.ts's identical shape/comment. */
export async function dispatchRewards(ctx: ActionCtx, request: Request): Promise<Response | null> {
	const url = new URL(request.url);
	const segs = segments(url.pathname);
	if (segs[0] !== "v1" || segs[1] !== "rewards") return null;
	const id = segs[2] as Id<"rewardDefinitions"> | undefined;
	if (segs.length > 3) return null;

	const isWrite = request.method !== "GET";
	const apiCtxOrError = await requireApiKey(ctx, request, { requireSecret: isWrite });
	if (apiCtxOrError instanceof Response) return apiCtxOrError;
	const apiCtx = apiCtxOrError;

	if (request.method === "GET" && !id) {
		const shopId = url.searchParams.get("shopId") as Id<"shops"> | null;
		let rewards = await ctx.runQuery(internal.rewards.internalList, { organizationId: apiCtx.organizationId });
		if (shopId) rewards = rewards.filter((r) => r.shopId === shopId || r.shopId == null);
		return json(rewards);
	}

	if (request.method === "GET" && id) {
		const reward = await getOrNull(() => ctx.runQuery(internal.rewards.internalGet, { organizationId: apiCtx.organizationId, rewardId: id }));
		if (!reward) return errorResponse(404, "Reward not found.");
		return json(reward);
	}

	if (request.method === "POST" && !id) {
		const body = await request.json().catch(() => null);
		if (!body || typeof body.name !== "string" || !body.name) return errorResponse(400, "name is required.");
		const rewardId = await ctx.runMutation(internal.rewards.internalCreate, {
			organizationId: apiCtx.organizationId,
			name: body.name,
			description: typeof body.description === "string" ? body.description : undefined,
			memberOnly: typeof body.memberOnly === "boolean" ? body.memberOnly : false,
			shopId: typeof body.shopId === "string" ? (body.shopId as Id<"shops">) : undefined
		});
		const reward = await ctx.runQuery(internal.rewards.internalGet, { organizationId: apiCtx.organizationId, rewardId });
		return json(reward, 201);
	}

	if (request.method === "PUT" && id) {
		const existing = await getOrNull(() => ctx.runQuery(internal.rewards.internalGet, { organizationId: apiCtx.organizationId, rewardId: id }));
		if (!existing) return errorResponse(404, "Reward not found.");
		const body = await request.json().catch(() => null);
		if (!body || typeof body.name !== "string" || !body.name) return errorResponse(400, "name is required.");
		await ctx.runMutation(internal.rewards.internalUpdate, {
			organizationId: apiCtx.organizationId,
			rewardId: id,
			name: body.name,
			description: typeof body.description === "string" ? body.description : undefined,
			memberOnly: typeof body.memberOnly === "boolean" ? body.memberOnly : false,
			shopId: typeof body.shopId === "string" ? (body.shopId as Id<"shops">) : undefined
		});
		const reward = await getOrNull(() => ctx.runQuery(internal.rewards.internalGet, { organizationId: apiCtx.organizationId, rewardId: id }));
		return json(reward);
	}

	if (request.method === "DELETE" && id) {
		const existing = await getOrNull(() => ctx.runQuery(internal.rewards.internalGet, { organizationId: apiCtx.organizationId, rewardId: id }));
		if (!existing) return errorResponse(404, "Reward not found.");
		await ctx.runMutation(internal.rewards.internalRemove, { organizationId: apiCtx.organizationId, rewardId: id });
		return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
	}

	return errorResponse(404, "Not found.");
}
