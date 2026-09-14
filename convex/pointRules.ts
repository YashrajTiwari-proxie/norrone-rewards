import { v, ConvexError } from "convex/values";
import { orgStaffQuery, orgStaffMutation, assertShopInOrg, assertPositive } from "./lib/authz";

export const list = orgStaffQuery("pointRules:read")({
	args: {},
	handler: async (ctx) => {
		const shops = await ctx.db
			.query("shops")
			.withIndex("by_organization", (q) => q.eq("organizationId", ctx.organizationId))
			.collect();
		const shopNameById = new Map(shops.map((s) => [s._id, s.name]));

		const rules = await ctx.db
			.query("pointRules")
			.withIndex("by_organization", (q) => q.eq("organizationId", ctx.organizationId))
			.collect();
		rules.sort((a, b) => a.action.localeCompare(b.action));

		return rules.map((r) => ({ ...r, scopeName: r.shopId ? (shopNameById.get(r.shopId) ?? "This shop") : "All shops" }));
	}
});

const ruleFields = {
	action: v.string(),
	pointsPerUnit: v.number(),
	memberOnly: v.boolean(),
	shopId: v.optional(v.id("shops"))
};

export const create = orgStaffMutation("pointRules:write")({
	args: ruleFields,
	handler: async (ctx, args) => {
		assertPositive(args.pointsPerUnit, "pointsPerUnit");
		await assertShopInOrg(ctx, args.shopId, ctx.organizationId);
		await ctx.db.insert("pointRules", {
			organizationId: ctx.organizationId,
			...args,
			action: args.action.trim().toUpperCase()
		});
	}
});

export const update = orgStaffMutation("pointRules:write")({
	args: { pointRuleId: v.id("pointRules"), ...ruleFields },
	handler: async (ctx, args) => {
		const { pointRuleId, ...fields } = args;
		assertPositive(fields.pointsPerUnit, "pointsPerUnit");
		const rule = await ctx.db.get(pointRuleId);
		if (!rule || rule.organizationId !== ctx.organizationId) {
			throw new ConvexError({ code: "NOT_FOUND", message: "Point rule not found in this organization" });
		}
		await assertShopInOrg(ctx, fields.shopId, ctx.organizationId);
		await ctx.db.patch(pointRuleId, { ...fields, action: fields.action.trim().toUpperCase() });
	}
});

export const remove = orgStaffMutation("pointRules:write")({
	args: { pointRuleId: v.id("pointRules") },
	handler: async (ctx, args) => {
		const rule = await ctx.db.get(args.pointRuleId);
		if (!rule || rule.organizationId !== ctx.organizationId) {
			throw new ConvexError({ code: "NOT_FOUND", message: "Point rule not found in this organization" });
		}
		await ctx.db.delete(args.pointRuleId);
	}
});
