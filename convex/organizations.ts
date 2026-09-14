import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireAuthUserId, orgStaffMutation } from "./lib/authz";
import { trustedAuthz } from "./authzConfig";

/** Every organization the signed-in user is an active staff member of. */
export const myOrganizations = query({
	args: {},
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return [];
		const authUserId = identity.subject;

		const memberships = await ctx.db
			.query("organizationStaff")
			.withIndex("by_user", (q) => q.eq("authUserId", authUserId))
			.collect();

		const orgs = await Promise.all(
			memberships
				.filter((m) => m.isActive)
				.map(async (m) => {
					const org = await ctx.db.get(m.organizationId);
					return org ? { _id: org._id, name: org.name, role: m.role } : null;
				})
		);
		return orgs.filter((o) => o !== null);
	}
});

/** Org details + the caller's own membership row — the org shell's one combined load. */
export const getForStaff = query({
	args: { organizationId: v.id("organizations") },
	handler: async (ctx, args) => {
		const authUserId = await requireAuthUserId(ctx);
		const membership = await ctx.db
			.query("organizationStaff")
			.withIndex("by_organization_and_user", (q) =>
				q.eq("organizationId", args.organizationId).eq("authUserId", authUserId)
			)
			.unique();
		if (!membership || !membership.isActive) return null;

		const organization = await ctx.db.get(args.organizationId);
		if (!organization) return null;

		const shops = await ctx.db
			.query("shops")
			.withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
			.collect();

		return { organization, shops, myRole: membership.role };
	}
});

export const update = orgStaffMutation("organizations:write")({
	args: {
		name: v.optional(v.string()),
		phoneNumber: v.optional(v.string()),
		website: v.optional(v.string()),
		address: v.optional(v.string()),
		regionId: v.optional(v.id("regions")),
		currencyCode: v.optional(v.string()),
		businessRegistrationNumber: v.optional(v.string()),
		taxId: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		await ctx.db.patch(ctx.organizationId, args);
	}
});

/**
 * Self-serve org signup's trusted bootstrap path — creates the org, its
 * first staff row, and grants that user `owner` in the new org's own
 * tenant, all inside one mutation. Only ever called right after the
 * client's own authClient.signUp.email() call has produced a real
 * session (see src/routes/signup) — never reachable without one, since
 * this reads authUserId from the verified identity, not a client arg.
 */
export const createSelfServe = mutation({
	args: {
		name: v.string(),
		phoneNumber: v.optional(v.string()),
		website: v.optional(v.string()),
		address: v.optional(v.string()),
		regionId: v.optional(v.id("regions")),
		currencyCode: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const authUserId = await requireAuthUserId(ctx);

		const organizationId = await ctx.db.insert("organizations", args);
		await ctx.db.insert("organizationStaff", {
			organizationId,
			authUserId,
			role: "owner",
			isActive: true
		});
		await trustedAuthz.withTenant(organizationId).assignRole(ctx, authUserId, "owner", {
			type: "organization",
			id: organizationId
		});

		return { organizationId };
	}
});
