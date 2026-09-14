import { v, ConvexError } from "convex/values";
import { query, type QueryCtx, type MutationCtx } from "./_generated/server";
import { platformMutation } from "./lib/authz";

/** Public reference data — read by the (unauthenticated) signup page and every org/shop region dropdown. */
export const list = query({
	args: {},
	handler: async (ctx) => {
		const regions = await ctx.db.query("regions").collect();
		return regions.sort((a, b) => a.countryName.localeCompare(b.countryName));
	}
});

async function assertUniqueIsoCode(ctx: QueryCtx | MutationCtx, isoCode: string, excludeId?: string) {
	const existing = await ctx.db
		.query("regions")
		.withIndex("by_iso_code", (q) => q.eq("isoCode", isoCode))
		.unique();
	if (existing && existing._id !== excludeId) {
		throw new ConvexError({ code: "CONFLICT", message: `A region with ISO code ${isoCode} already exists.` });
	}
}

const regionFields = {
	countryName: v.string(),
	isoCode: v.string(),
	phoneCode: v.string(),
	currencyCode: v.string(),
	currencySymbol: v.string()
};

export const create = platformMutation("regions:write")({
	args: regionFields,
	handler: async (ctx, args) => {
		const isoCode = args.isoCode.toUpperCase();
		await assertUniqueIsoCode(ctx, isoCode);
		await ctx.db.insert("regions", { ...args, isoCode, currencyCode: args.currencyCode.toUpperCase() });
	}
});

export const update = platformMutation("regions:write")({
	args: { regionId: v.id("regions"), ...regionFields },
	handler: async (ctx, args) => {
		const { regionId, ...fields } = args;
		const isoCode = fields.isoCode.toUpperCase();
		await assertUniqueIsoCode(ctx, isoCode, regionId);
		await ctx.db.patch(regionId, { ...fields, isoCode, currencyCode: fields.currencyCode.toUpperCase() });
	}
});

export const remove = platformMutation("regions:write")({
	args: { regionId: v.id("regions") },
	handler: async (ctx, args) => {
		await ctx.db.delete(args.regionId);
	}
});
