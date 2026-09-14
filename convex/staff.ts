import { v, ConvexError } from "convex/values";
import { internal, components } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import { orgStaffQuery, orgStaffMutation, orgStaffAction } from "./lib/authz";
import { authComponent, createAuth } from "./auth";
import { authz, orgRoleValidator } from "./authzConfig";
import { sendEmail } from "./lib/email";

/**
 * Staff listing + invite for the org dashboard. `invite` is an action
 * (not a mutation) because creating a brand-new Better Auth account
 * (createAuth(ctx).api.signUpEmail — reuses Better Auth's own password
 * hashing rather than writing account.password by hand) and sending the
 * invite email both need action context. The actual DB writes (staff row
 * + authz role grant) live in the internal `attachRole` mutation below so
 * both the "existing account" and "brand-new account" paths share one
 * code path.
 */

export const list = orgStaffQuery("staff:read")({
	args: {},
	handler: async (ctx) => {
		const rows = await ctx.db
			.query("organizationStaff")
			.withIndex("by_organization", (q) => q.eq("organizationId", ctx.organizationId))
			.collect();

		return await Promise.all(
			rows.map(async (row) => {
				const user = await authComponent.getAnyUserById(ctx, row.authUserId);
				return {
					id: row._id,
					role: row.role,
					isActive: row.isActive,
					email: user?.email ?? "Unknown",
					status: user?.emailVerified ? "Active" : "Invited"
				};
			})
		);
	}
});

/**
 * Shared DB-write tail for both invite paths: upsert the display-cache
 * organizationStaff row and grant the authz role. Internal — only ever
 * called from the `invite` action below, never exposed directly (it does
 * no permission check of its own; the caller already did one).
 */
export const attachRole = internalMutation({
	args: { organizationId: v.id("organizations"), authUserId: v.string(), role: orgRoleValidator, actorId: v.string() },
	handler: async (ctx, args) => {
		const existing = await ctx.db
			.query("organizationStaff")
			.withIndex("by_organization_and_user", (q) => q.eq("organizationId", args.organizationId).eq("authUserId", args.authUserId))
			.unique();

		if (existing) {
			await ctx.db.patch(existing._id, { role: args.role, isActive: true });
		} else {
			await ctx.db.insert("organizationStaff", {
				organizationId: args.organizationId,
				authUserId: args.authUserId,
				role: args.role,
				isActive: true
			});
		}

		// Guarded instance — actorId is the inviting staff member, so an
		// owner can't use this path to mint another owner (see
		// authzConfig.ts's assignableRoles comment).
		await authz
			.withTenant(args.organizationId)
			.assignRole(ctx, args.authUserId, args.role, { type: "organization", id: args.organizationId }, undefined, args.actorId);
	}
});

/** orgStaffAction skips the isActive check orgStaffMutation does (actions have no ctx.db) — do it explicitly here. */
export const assertActorActiveStaff = internalQuery({
	args: { organizationId: v.id("organizations"), authUserId: v.string() },
	handler: async (ctx, args) => {
		const membership = await ctx.db
			.query("organizationStaff")
			.withIndex("by_organization_and_user", (q) => q.eq("organizationId", args.organizationId).eq("authUserId", args.authUserId))
			.unique();
		if (!membership || !membership.isActive) {
			throw new ConvexError({ code: "ACCOUNT_INACTIVE", message: "Not an active staff member of this organization" });
		}
	}
});

function generateTempPassword(): string {
	// Not meant to be memorable — emailed straight to the invitee, who is
	// expected to sign in once and (eventually) change it. 24 chars from
	// crypto.randomUUID() comfortably clears Better Auth's default
	// minPasswordLength.
	return crypto.randomUUID().replace(/-/g, "").slice(0, 24);
}

export const invite = orgStaffAction("staff:invite")({
	args: { email: v.string(), role: orgRoleValidator },
	handler: async (ctx, args) => {
		await ctx.runQuery(internal.staff.assertActorActiveStaff, {
			organizationId: ctx.organizationId,
			authUserId: ctx.authUserId
		});

		const email = args.email.trim().toLowerCase();
		const existingUser = await ctx.runQuery(components.betterAuth.adapter.findOne, {
			model: "user",
			where: [{ field: "email", operator: "eq", value: email }]
		});

		if (existingUser) {
			const authUserId = existingUser._id as string;
			await ctx.runMutation(internal.staff.attachRole, {
				organizationId: ctx.organizationId,
				authUserId,
				role: args.role,
				actorId: ctx.authUserId
			});
			return { created: false as const };
		}

		const password = generateTempPassword();
		const signUpResult = await createAuth(ctx).api.signUpEmail({
			body: { email, password, name: email.split("@")[0] }
		});
		const authUserId = signUpResult.user.id;

		await ctx.runMutation(internal.staff.attachRole, {
			organizationId: ctx.organizationId,
			authUserId,
			role: args.role,
			actorId: ctx.authUserId
		});

		await sendEmail({
			to: email,
			subject: "You've been added to Norrone Loyalty",
			html: `
				<p>You've been added as staff on Norrone Loyalty.</p>
				<p><strong>Email:</strong> ${email}<br/>
				<strong>Temporary password:</strong> ${password}</p>
				<p>Sign in at <a href="${process.env.SITE_URL ?? "http://127.0.0.1:5173"}/login">${process.env.SITE_URL ?? "http://127.0.0.1:5173"}/login</a>.
				We'd recommend changing your password after your first sign-in.</p>
			`
		});

		return { created: true as const };
	}
});
