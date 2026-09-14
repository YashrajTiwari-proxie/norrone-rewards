import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { orgStaffQuery, orgStaffMutation, orgStaffAction } from "./lib/authz";
import { ensureLoyaltyClass } from "./lib/wallet/googlePass";

/** Current org-wide pass design, for the Wallet dashboard page's edit form. */
export const get = orgStaffQuery("passTemplates:read")({
	args: {},
	handler: async (ctx) => {
		const template = await ctx.db
			.query("passTemplates")
			.withIndex("by_organization", (q) => q.eq("organizationId", ctx.organizationId))
			.filter((q) => q.eq(q.field("shopId"), undefined))
			.first();
		if (!template) return null;

		const logoUrl = template.logoStorageId ? await ctx.storage.getUrl(template.logoStorageId) : null;
		return {
			logoUrl,
			backgroundColor: template.backgroundColor ?? null,
			foregroundColor: template.foregroundColor ?? null,
			organizationDisplayName: template.organizationDisplayName ?? null
		};
	}
});

/** Step 1 of the logo upload flow — the browser POSTs the file directly to this URL. */
export const generateUploadUrl = orgStaffMutation("passTemplates:write")({
	args: {},
	handler: async (ctx) => await ctx.storage.generateUploadUrl()
});

export const upsertRow = internalMutation({
	args: {
		organizationId: v.id("organizations"),
		logoStorageId: v.optional(v.id("_storage")),
		backgroundColor: v.optional(v.string()),
		foregroundColor: v.optional(v.string()),
		organizationDisplayName: v.optional(v.string()),
		googleClassId: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const { organizationId, ...rest } = args;
		// db.patch treats an explicit `undefined` value as "clear this
		// field" — so a colors-only save must not also send
		// logoStorageId: undefined and wipe out a previously uploaded
		// logo. Only include keys the caller actually provided.
		const fields: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(rest)) {
			if (value !== undefined) fields[key] = value;
		}

		const existing = await ctx.db
			.query("passTemplates")
			.withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
			.filter((q) => q.eq(q.field("shopId"), undefined))
			.first();

		if (existing) {
			await ctx.db.patch(existing._id, fields);
		} else {
			await ctx.db.insert("passTemplates", { organizationId, ...fields });
		}
	}
});

export const getOrgName = internalQuery({
	args: { organizationId: v.id("organizations") },
	handler: async (ctx, args) => {
		const org = await ctx.db.get(args.organizationId);
		return org?.name ?? "Norrone Loyalty";
	}
});

/** The org's currently-saved logo, for `save` to fall back to when this particular call isn't uploading a new one. */
export const getExistingLogoStorageId = internalQuery({
	args: { organizationId: v.id("organizations") },
	handler: async (ctx, args) => {
		const template = await ctx.db
			.query("passTemplates")
			.withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
			.filter((q) => q.eq(q.field("shopId"), undefined))
			.first();
		return template?.logoStorageId ?? null;
	}
});

/**
 * Step 2 of the logo upload flow (and the plain "save colors/name" path
 * too) — an action because syncing Google's LoyaltyClass needs network
 * access. Always re-syncs the Google class on save so a color/logo change
 * shows up immediately, not just on next full regeneration.
 */
export const save = orgStaffAction("passTemplates:write")({
	args: {
		logoStorageId: v.optional(v.id("_storage")),
		backgroundColor: v.optional(v.string()),
		foregroundColor: v.optional(v.string()),
		organizationDisplayName: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		// A save that isn't uploading a new logo (the common case — editing
		// just colors/name after the logo is already set) must still use the
		// EXISTING logo for the Google class sync below, not silently fall
		// back to the platform default — that was reverting a real uploaded
		// logo to the generic one on every subsequent save.
		const logoStorageId = args.logoStorageId ?? (await ctx.runQuery(internal.passTemplates.getExistingLogoStorageId, {
			organizationId: ctx.organizationId
		}));
		const logoUrl = logoStorageId ? await ctx.storage.getUrl(logoStorageId) : null;
		const orgName = await ctx.runQuery(internal.passTemplates.getOrgName, {
			organizationId: ctx.organizationId
		});

		let googleClassId: string | undefined;
		try {
			googleClassId = await ensureLoyaltyClass({
				organizationId: ctx.organizationId,
				organizationName: args.organizationDisplayName ?? orgName,
				logoUrl,
				backgroundColor: args.backgroundColor ?? "#1b2430"
			});
		} catch (err) {
			// Google Wallet not configured (or a transient API error) shouldn't
			// block saving the Apple-side branding — Apple's pass regenerates
			// fresh per request and doesn't need this class at all.
			console.error("Google Wallet class sync failed — saving template without it", err);
		}

		await ctx.runMutation(internal.passTemplates.upsertRow, {
			organizationId: ctx.organizationId,
			logoStorageId: args.logoStorageId,
			backgroundColor: args.backgroundColor,
			foregroundColor: args.foregroundColor,
			organizationDisplayName: args.organizationDisplayName,
			googleClassId
		});

		return { googleSynced: googleClassId !== undefined };
	}
});
