import { v, ConvexError } from "convex/values";
import { query, internalMutation } from "./_generated/server";
import { components } from "./_generated/api";
import { platformQuery, platformMutation, requireAuthUserId } from "./lib/authz";
import { trustedAuthz, PLATFORM_TENANT_ID } from "./authzConfig";
import { authComponent } from "./auth";

/**
 * Whether the signed-in user currently holds an active platformAdmins
 * row — used client-side to gate the /admin route tree. Not itself a
 * security boundary (every platform mutation/query below re-checks via
 * platformQuery/platformMutation independently); this is only for the UI
 * to decide what to render.
 */
export const isCurrentUserAdmin = query({
	args: {},
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return false;
		const row = await ctx.db
			.query("platformAdmins")
			.withIndex("by_user", (q) => q.eq("authUserId", identity.subject))
			.unique();
		return row?.isActive ?? false;
	}
});

/**
 * Bootstraps the very first platform admin. There is no public path to
 * become a platform admin (correctly — it's the highest privilege level
 * on the platform), so this is only ever run once via
 * `npx convex run platformAdmins:seedFirstAdmin '{"email":"..."}'` by
 * whoever operates this deployment. Every platform admin added after
 * that goes through the normal `add` mutation below, itself gated on
 * already being a platform admin.
 */
export const seedFirstAdmin = internalMutation({
	args: { email: v.string() },
	handler: async (ctx, args) => {
		const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
			model: "user",
			where: [{ field: "email", operator: "eq", value: args.email.trim().toLowerCase() }]
		});
		if (!user) {
			throw new Error(`No account exists for ${args.email} yet — sign up first, then re-run this.`);
		}
		const authUserId = user._id as string;

		const existing = await ctx.db
			.query("platformAdmins")
			.withIndex("by_user", (q) => q.eq("authUserId", authUserId))
			.unique();
		if (!existing) {
			await ctx.db.insert("platformAdmins", { authUserId, isActive: true });
		}
		await trustedAuthz.withTenant(PLATFORM_TENANT_ID).assignRole(ctx, authUserId, "platformAdmin");
	}
});

export const listAdmins = platformQuery("platform:read")({
	args: {},
	handler: async (ctx) => {
		const rows = await ctx.db.query("platformAdmins").collect();
		return await Promise.all(
			rows.map(async (row) => {
				const user = await authComponent.getAnyUserById(ctx, row.authUserId);
				return { id: row._id, email: user?.email ?? "Unknown", isActive: row.isActive };
			})
		);
	}
});

export const addAdmin = platformMutation("platform:write")({
	args: { email: v.string() },
	handler: async (ctx, args) => {
		const email = args.email.trim().toLowerCase();
		const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
			model: "user",
			where: [{ field: "email", operator: "eq", value: email }]
		});
		if (!user) {
			throw new ConvexError({
				code: "NO_ACCOUNT",
				message: "No account exists for that email yet — ask them to create an account, then add them again."
			});
		}
		const authUserId = user._id as string;

		const existing = await ctx.db
			.query("platformAdmins")
			.withIndex("by_user", (q) => q.eq("authUserId", authUserId))
			.unique();
		if (existing) {
			await ctx.db.patch(existing._id, { isActive: true });
		} else {
			await ctx.db.insert("platformAdmins", { authUserId, isActive: true });
		}
		await trustedAuthz.withTenant(PLATFORM_TENANT_ID).assignRole(ctx, authUserId, "platformAdmin", undefined, undefined, ctx.authUserId);
	}
});
