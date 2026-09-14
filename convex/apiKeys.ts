import { v, ConvexError } from "convex/values";
import { orgStaffQuery, orgStaffMutation, assertShopInOrg } from "./lib/authz";
import { generateApiKey, hashApiKey } from "./lib/apiKeys";

export const list = orgStaffQuery("apiKeys:read")({
	args: {},
	handler: async (ctx) => {
		const shops = await ctx.db
			.query("shops")
			.withIndex("by_organization", (q) => q.eq("organizationId", ctx.organizationId))
			.collect();
		const shopNameById = new Map(shops.map((s) => [s._id, s.name]));

		const keys = await ctx.db
			.query("apiKeys")
			.withIndex("by_organization", (q) => q.eq("organizationId", ctx.organizationId))
			.collect();
		keys.sort((a, b) => b._creationTime - a._creationTime);

		return keys.map((k) => ({
			id: k._id,
			type: k.type,
			revoked: k.revoked,
			createdAt: k._creationTime,
			scopeName: k.shopId ? (shopNameById.get(k.shopId) ?? "This shop") : "All shops"
		}));
	}
});

/** Returned only once — only the hash is ever stored, matching the old Supabase-era api_keys design. */
export const create = orgStaffMutation("apiKeys:write")({
	args: { type: v.union(v.literal("secret"), v.literal("publishable")), shopId: v.optional(v.id("shops")) },
	handler: async (ctx, args) => {
		await assertShopInOrg(ctx, args.shopId, ctx.organizationId);
		const plaintextKey = generateApiKey(args.type);
		await ctx.db.insert("apiKeys", {
			organizationId: ctx.organizationId,
			shopId: args.shopId,
			hashedKey: await hashApiKey(plaintextKey),
			type: args.type,
			revoked: false
		});
		return { plaintextKey };
	}
});

export const revoke = orgStaffMutation("apiKeys:revoke")({
	args: { apiKeyId: v.id("apiKeys") },
	handler: async (ctx, args) => {
		const key = await ctx.db.get(args.apiKeyId);
		if (!key || key.organizationId !== ctx.organizationId) {
			throw new ConvexError({ code: "NOT_FOUND", message: "API key not found in this organization" });
		}
		await ctx.db.patch(args.apiKeyId, { revoked: true });
	}
});
