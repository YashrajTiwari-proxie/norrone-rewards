import { v, ConvexError } from "convex/values";
import { components } from "./_generated/api";
import { orgStaffQuery, orgStaffMutation } from "./lib/authz";
import { authComponent } from "./auth";
import { authz, orgRoleValidator } from "./authzConfig";

/**
 * Staff listing + invite for the org dashboard. There's no transactional
 * email provider wired up yet (same gap noted on /forgot-password), so
 * "invite" only works for an email that already has a Better Auth
 * account — it looks the user up directly via the betterAuth component's
 * own adapter.findOne (the same query the SDK itself uses internally;
 * components.betterAuth.adapter.* is a supported call surface, not a
 * private implementation detail) rather than sending a real invite email.
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

export const invite = orgStaffMutation("staff:invite")({
	args: { email: v.string(), role: orgRoleValidator },
	handler: async (ctx, args) => {
		const email = args.email.trim().toLowerCase();
		const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
			model: "user",
			where: [{ field: "email", operator: "eq", value: email }]
		});

		if (!user) {
			throw new ConvexError({
				code: "NO_ACCOUNT",
				message:
					"No account exists for that email yet — self-serve invite emails aren't set up. Ask them to create an account, then invite them again."
			});
		}

		const authUserId = user._id as string;

		const existing = await ctx.db
			.query("organizationStaff")
			.withIndex("by_organization_and_user", (q) => q.eq("organizationId", ctx.organizationId).eq("authUserId", authUserId))
			.unique();

		if (existing) {
			await ctx.db.patch(existing._id, { role: args.role, isActive: true });
		} else {
			await ctx.db.insert("organizationStaff", {
				organizationId: ctx.organizationId,
				authUserId,
				role: args.role,
				isActive: true
			});
		}

		// Guarded instance — actorId is the inviting staff member, so an
		// owner can't use this path to mint another owner (see
		// authzConfig.ts's assignableRoles comment).
		await authz.withTenant(ctx.organizationId).assignRole(ctx, authUserId, args.role, { type: "organization", id: ctx.organizationId }, undefined, ctx.authUserId);
	}
});
