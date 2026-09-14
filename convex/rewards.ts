import { v, ConvexError } from "convex/values";
import { orgStaffQuery, orgStaffMutation, assertShopInOrg } from "./lib/authz";

const metricLabel: Record<string, string> = {
	SPEND: "spend",
	VISITS: "visits",
	POINTS: "points",
	TIER_LEVEL: "tier level",
	MEMBERSHIP_ACTIVE: "active membership"
};
const opLabel: Record<string, string> = { GTE: "≥", LTE: "≤", EQ: "=" };

export const list = orgStaffQuery("rewards:read")({
	args: {},
	handler: async (ctx) => {
		const shops = await ctx.db
			.query("shops")
			.withIndex("by_organization", (q) => q.eq("organizationId", ctx.organizationId))
			.collect();
		const shopNameById = new Map(shops.map((s) => [s._id, s.name]));

		const rewards = await ctx.db
			.query("rewardDefinitions")
			.withIndex("by_organization", (q) => q.eq("organizationId", ctx.organizationId))
			.collect();
		rewards.sort((a, b) => a.name.localeCompare(b.name));

		return await Promise.all(
			rewards.map(async (reward) => {
				const conditions = await ctx.db
					.query("eligibilityConditions")
					.withIndex("by_target", (q) => q.eq("targetType", "REWARD").eq("targetId", reward._id))
					.collect();
				const grants = await ctx.db
					.query("customerRewards")
					.filter((q) => q.eq(q.field("rewardId"), reward._id))
					.collect();

				const conditionSummary =
					conditions.map((c) => `${metricLabel[c.metric] ?? c.metric} ${opLabel[c.operator] ?? c.operator} ${c.value}`).join(", ") ||
					"No conditions";

				return {
					...reward,
					scopeName: reward.shopId ? (shopNameById.get(reward.shopId) ?? "This shop") : "All shops",
					conditionSummary,
					conditions,
					grantedCount: grants.length
				};
			})
		);
	}
});

const rewardFields = {
	name: v.string(),
	description: v.optional(v.string()),
	memberOnly: v.boolean(),
	shopId: v.optional(v.id("shops"))
};

export const create = orgStaffMutation("rewards:write")({
	args: rewardFields,
	handler: async (ctx, args) => {
		await assertShopInOrg(ctx, args.shopId, ctx.organizationId);
		await ctx.db.insert("rewardDefinitions", { organizationId: ctx.organizationId, ...args });
	}
});

export const update = orgStaffMutation("rewards:write")({
	args: { rewardId: v.id("rewardDefinitions"), ...rewardFields },
	handler: async (ctx, args) => {
		const { rewardId, ...fields } = args;
		const reward = await ctx.db.get(rewardId);
		if (!reward || reward.organizationId !== ctx.organizationId) {
			throw new ConvexError({ code: "NOT_FOUND", message: "Reward not found in this organization" });
		}
		await assertShopInOrg(ctx, fields.shopId, ctx.organizationId);
		await ctx.db.patch(rewardId, fields);
	}
});

export const remove = orgStaffMutation("rewards:write")({
	args: { rewardId: v.id("rewardDefinitions") },
	handler: async (ctx, args) => {
		const reward = await ctx.db.get(args.rewardId);
		if (!reward || reward.organizationId !== ctx.organizationId) {
			throw new ConvexError({ code: "NOT_FOUND", message: "Reward not found in this organization" });
		}
		await ctx.db.delete(args.rewardId);
	}
});

export const addCondition = orgStaffMutation("rewards:write")({
	args: {
		rewardId: v.id("rewardDefinitions"),
		metric: v.union(v.literal("SPEND"), v.literal("VISITS"), v.literal("POINTS"), v.literal("TIER_LEVEL"), v.literal("MEMBERSHIP_ACTIVE")),
		operator: v.union(v.literal("GTE"), v.literal("LTE"), v.literal("EQ")),
		value: v.number(),
		period: v.union(v.literal("LIFETIME"), v.literal("MONTHLY"), v.literal("YEARLY"))
	},
	handler: async (ctx, args) => {
		const { rewardId, ...fields } = args;
		const reward = await ctx.db.get(rewardId);
		if (!reward || reward.organizationId !== ctx.organizationId) {
			throw new ConvexError({ code: "NOT_FOUND", message: "Reward not found in this organization" });
		}
		await ctx.db.insert("eligibilityConditions", {
			organizationId: ctx.organizationId,
			targetType: "REWARD",
			targetId: rewardId,
			...fields
		});
	}
});

export const removeCondition = orgStaffMutation("rewards:write")({
	args: { conditionId: v.id("eligibilityConditions") },
	handler: async (ctx, args) => {
		const condition = await ctx.db.get(args.conditionId);
		if (!condition || condition.organizationId !== ctx.organizationId) {
			throw new ConvexError({ code: "NOT_FOUND", message: "Condition not found in this organization" });
		}
		await ctx.db.delete(args.conditionId);
	}
});
