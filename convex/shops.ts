import { v } from "convex/values";
import { orgStaffQuery, orgStaffMutation } from "./lib/authz";

export const list = orgStaffQuery("shops:read")({
	args: {},
	handler: async (ctx) => {
		const shops = await ctx.db
			.query("shops")
			.withIndex("by_organization", (q) => q.eq("organizationId", ctx.organizationId))
			.collect();

		return await Promise.all(
			shops.map(async (shop) => {
				const customers = await ctx.db
					.query("customers")
					.withIndex("by_shop", (q) => q.eq("shopId", shop._id))
					.collect();
				const region = shop.regionId ? await ctx.db.get(shop.regionId) : null;
				return { ...shop, customerCount: customers.length, regionName: region?.countryName ?? null };
			})
		);
	}
});

const shopFields = {
	name: v.string(),
	externalShopId: v.optional(v.string()),
	phoneNumber: v.optional(v.string()),
	address: v.optional(v.string()),
	regionId: v.optional(v.id("regions")),
	currencyCode: v.optional(v.string())
};

export const create = orgStaffMutation("shops:write")({
	args: shopFields,
	handler: async (ctx, args) => {
		await ctx.db.insert("shops", { organizationId: ctx.organizationId, ...args });
	}
});

export const update = orgStaffMutation("shops:write")({
	args: { shopId: v.id("shops"), ...shopFields },
	handler: async (ctx, args) => {
		const { shopId, ...fields } = args;
		const shop = await ctx.db.get(shopId);
		if (!shop || shop.organizationId !== ctx.organizationId) {
			throw new Error("Shop not found in this organization");
		}
		await ctx.db.patch(shopId, fields);
	}
});
