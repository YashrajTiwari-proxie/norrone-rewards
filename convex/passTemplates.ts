import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { orgStaffQuery, orgStaffMutation, orgStaffAction } from "./lib/authz";
import { ensureLoyaltyClass } from "./lib/wallet/googlePass";
import { DEFAULT_PASS_DESIGN } from "./wallet";

/**
 * Current org-wide pass design, for the Wallet dashboard page's edit form
 * — Apple and Google are fully independent from each other (own logo,
 * banner, colors, display name; no fallback between them), matching the
 * two separate tabs in the dashboard UI.
 */
export const get = orgStaffQuery("passTemplates:read")({
	args: {},
	handler: async (ctx) => {
		const template = await ctx.db
			.query("passTemplates")
			.withIndex("by_organization", (q) => q.eq("organizationId", ctx.organizationId))
			.filter((q) => q.eq(q.field("shopId"), undefined))
			.first();
		if (!template) return null;

		const urlOf = (id: typeof template.logoStorageId) => (id ? ctx.storage.getUrl(id) : Promise.resolve(null));
		const [logoUrl, bannerUrl, googleLogoUrl, googleBannerUrl] = await Promise.all([
			urlOf(template.logoStorageId),
			urlOf(template.bannerStorageId),
			urlOf(template.googleLogoStorageId),
			urlOf(template.googleBannerStorageId)
		]);

		return {
			apple: {
				logoUrl,
				bannerUrl,
				backgroundColor: template.backgroundColor ?? null,
				foregroundColor: template.foregroundColor ?? null,
				organizationDisplayName: template.organizationDisplayName ?? null
			},
			google: {
				logoUrl: googleLogoUrl,
				bannerUrl: googleBannerUrl,
				backgroundColor: template.googleBackgroundColor ?? null,
				foregroundColor: template.googleForegroundColor ?? null,
				organizationDisplayName: template.googleDisplayName ?? null
			}
		};
	}
});

/** Step 1 of either platform's logo/banner upload flow — the browser POSTs the file directly to this URL. */
export const generateUploadUrl = orgStaffMutation("passTemplates:write")({
	args: {},
	handler: async (ctx) => await ctx.storage.generateUploadUrl()
});

export const upsertRow = internalMutation({
	args: {
		organizationId: v.id("organizations"),
		logoStorageId: v.optional(v.id("_storage")),
		bannerStorageId: v.optional(v.id("_storage")),
		backgroundColor: v.optional(v.string()),
		foregroundColor: v.optional(v.string()),
		organizationDisplayName: v.optional(v.string()),
		googleLogoStorageId: v.optional(v.id("_storage")),
		googleBannerStorageId: v.optional(v.id("_storage")),
		googleBackgroundColor: v.optional(v.string()),
		googleForegroundColor: v.optional(v.string()),
		googleDisplayName: v.optional(v.string()),
		googleClassId: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const { organizationId, ...rest } = args;
		// db.patch treats an explicit `undefined` value as "clear this
		// field" — so saving one platform's tab must not also send the
		// other platform's fields as `undefined` and wipe them out. Only
		// include keys the caller actually provided.
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

/** The org's currently-saved Apple logo/banner, for `saveApple` to fall back to when this particular call isn't uploading new ones. */
export const getExistingAppleAssetIds = internalQuery({
	args: { organizationId: v.id("organizations") },
	handler: async (ctx, args) => {
		const template = await ctx.db
			.query("passTemplates")
			.withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
			.filter((q) => q.eq(q.field("shopId"), undefined))
			.first();
		return {
			logoStorageId: template?.logoStorageId ?? null,
			bannerStorageId: template?.bannerStorageId ?? null
		};
	}
});

/** The org's currently-saved Google logo/banner, for `saveGoogle` to fall back to when this particular call isn't uploading new ones. */
export const getExistingGoogleAssetIds = internalQuery({
	args: { organizationId: v.id("organizations") },
	handler: async (ctx, args) => {
		const template = await ctx.db
			.query("passTemplates")
			.withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
			.filter((q) => q.eq(q.field("shopId"), undefined))
			.first();
		return {
			logoStorageId: template?.googleLogoStorageId ?? null,
			bannerStorageId: template?.googleBannerStorageId ?? null
		};
	}
});

/**
 * Saves Apple's design only — a plain mutation, since Apple's pass
 * regenerates fresh on every request (convex/walletNode.ts) and needs no
 * network call at save time, unlike Google's class sync below.
 */
export const saveApple = orgStaffMutation("passTemplates:write")({
	args: {
		logoStorageId: v.optional(v.id("_storage")),
		bannerStorageId: v.optional(v.id("_storage")),
		backgroundColor: v.optional(v.string()),
		foregroundColor: v.optional(v.string()),
		organizationDisplayName: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		await ctx.runMutation(internal.passTemplates.upsertRow, {
			organizationId: ctx.organizationId,
			logoStorageId: args.logoStorageId,
			bannerStorageId: args.bannerStorageId,
			backgroundColor: args.backgroundColor,
			foregroundColor: args.foregroundColor,
			organizationDisplayName: args.organizationDisplayName
		});
	}
});

/**
 * Saves Google's design only, and re-syncs its LoyaltyClass — fully
 * independent of Apple's saved design (own logo/banner/colors/name, own
 * defaults). An action because the class sync needs network access.
 */
export const saveGoogle = orgStaffAction("passTemplates:write")({
	args: {
		logoStorageId: v.optional(v.id("_storage")),
		bannerStorageId: v.optional(v.id("_storage")),
		backgroundColor: v.optional(v.string()),
		foregroundColor: v.optional(v.string()),
		organizationDisplayName: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const backgroundColor = args.backgroundColor ?? DEFAULT_PASS_DESIGN.backgroundColor;

		// A save that isn't uploading a new logo/banner (the common case —
		// editing just colors/name after they're already set) must still use
		// the EXISTING Google assets, not silently fall back to nothing —
		// that was reverting real uploaded artwork to the generic default on
		// every subsequent save.
		const existingAssets = await ctx.runQuery(internal.passTemplates.getExistingGoogleAssetIds, {
			organizationId: ctx.organizationId
		});
		const logoStorageId = args.logoStorageId ?? existingAssets.logoStorageId ?? undefined;
		const bannerStorageId = args.bannerStorageId ?? existingAssets.bannerStorageId ?? undefined;
		const logoUrl = logoStorageId ? await ctx.storage.getUrl(logoStorageId) : null;
		const bannerUrl = bannerStorageId ? await ctx.storage.getUrl(bannerStorageId) : null;
		const orgName = await ctx.runQuery(internal.passTemplates.getOrgName, {
			organizationId: ctx.organizationId
		});

		let googleClassId: string | undefined;
		try {
			googleClassId = await ensureLoyaltyClass({
				organizationId: ctx.organizationId,
				organizationName: args.organizationDisplayName ?? orgName,
				logoUrl,
				backgroundColor,
				heroImageUrl: bannerUrl
			});
		} catch (err) {
			console.error("Google Wallet class sync failed", err);
			throw err;
		}

		await ctx.runMutation(internal.passTemplates.upsertRow, {
			organizationId: ctx.organizationId,
			googleLogoStorageId: args.logoStorageId,
			googleBannerStorageId: args.bannerStorageId,
			googleBackgroundColor: args.backgroundColor,
			googleForegroundColor: args.foregroundColor,
			googleDisplayName: args.organizationDisplayName,
			googleClassId
		});

		return { googleSynced: googleClassId !== undefined };
	}
});
