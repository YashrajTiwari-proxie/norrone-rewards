import { v, ConvexError } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { orgStaffQuery, orgStaffMutation, orgStaffAction } from "./lib/authz";
import { ensureLoyaltyClass } from "./lib/wallet/googlePass";
import { contrastRatio, MIN_CONTRAST_RATIO } from "./lib/wallet/color";
import { DEFAULT_PASS_DESIGN } from "./wallet";

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
		const bannerUrl = template.bannerStorageId ? await ctx.storage.getUrl(template.bannerStorageId) : null;
		return {
			logoUrl,
			bannerUrl,
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
		bannerStorageId: v.optional(v.id("_storage")),
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

/** The org's currently-saved logo/banner, for `save` to fall back to when this particular call isn't uploading new ones. */
export const getExistingAssetIds = internalQuery({
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

/**
 * Step 2 of the logo upload flow (and the plain "save colors/name" path
 * too) — an action because syncing Google's LoyaltyClass needs network
 * access. Always re-syncs the Google class on save so a color/logo change
 * shows up immediately, not just on next full regeneration.
 */
export const save = orgStaffAction("passTemplates:write")({
	args: {
		logoStorageId: v.optional(v.id("_storage")),
		bannerStorageId: v.optional(v.id("_storage")),
		backgroundColor: v.optional(v.string()),
		foregroundColor: v.optional(v.string()),
		organizationDisplayName: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const backgroundColor = args.backgroundColor ?? DEFAULT_PASS_DESIGN.backgroundColor;
		const foregroundColor = args.foregroundColor ?? DEFAULT_PASS_DESIGN.foregroundColor;

		// Reject illegible palettes outright rather than silently saving a
		// pass nobody can read. Same bar the dashboard's own live warning
		// uses, so a save never surprises with an error the UI didn't
		// already flag.
		const ratio = contrastRatio(foregroundColor, backgroundColor);
		if (ratio < MIN_CONTRAST_RATIO) {
			throw new ConvexError({
				code: "LOW_CONTRAST",
				message: `Text color doesn't contrast enough against the background (${ratio.toFixed(1)}:1, needs at least ${MIN_CONTRAST_RATIO}:1) — pick a lighter or darker text color.`
			});
		}

		// A save that isn't uploading a new logo/banner (the common case —
		// editing just colors/name after they're already set) must still use
		// the EXISTING assets for the Google class sync below, not silently
		// fall back to nothing — that was reverting real uploaded artwork to
		// the generic default on every subsequent save.
		const existingAssets = await ctx.runQuery(internal.passTemplates.getExistingAssetIds, {
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
			// Google Wallet not configured (or a transient API error) shouldn't
			// block saving the Apple-side branding — Apple's pass regenerates
			// fresh per request and doesn't need this class at all.
			console.error("Google Wallet class sync failed — saving template without it", err);
		}

		await ctx.runMutation(internal.passTemplates.upsertRow, {
			organizationId: ctx.organizationId,
			logoStorageId: args.logoStorageId,
			bannerStorageId: args.bannerStorageId,
			backgroundColor: args.backgroundColor,
			foregroundColor: args.foregroundColor,
			organizationDisplayName: args.organizationDisplayName,
			googleClassId
		});

		return { googleSynced: googleClassId !== undefined };
	}
});
