import { v, ConvexError } from "convex/values";
import { components } from "./_generated/api";
import { platformQuery, platformMutation } from "./lib/authz";
import { trustedAuthz } from "./authzConfig";
import { authComponent } from "./auth";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/** Cross-organization views + management for the platform admin panel. */

export const list = platformQuery("organizations:read")({
	args: {},
	handler: async (ctx) => {
		const organizations = await ctx.db.query("organizations").collect();
		organizations.sort((a, b) => b._creationTime - a._creationTime);

		let totalShops = 0;
		let totalCustomers = 0;

		const withCounts = await Promise.all(
			organizations.map(async (org) => {
				const [shops, customers, staff] = await Promise.all([
					ctx.db
						.query("shops")
						.withIndex("by_organization", (q) => q.eq("organizationId", org._id))
						.collect(),
					ctx.db
						.query("customers")
						.withIndex("by_organization", (q) => q.eq("organizationId", org._id))
						.collect(),
					ctx.db
						.query("organizationStaff")
						.withIndex("by_organization", (q) => q.eq("organizationId", org._id))
						.collect()
				]);
				totalShops += shops.length;
				totalCustomers += customers.length;
				return { ...org, counts: { shops: shops.length, customers: customers.length, staff: staff.length } };
			})
		);

		return {
			organizations: withCounts,
			platformStats: { totalOrgs: organizations.length, totalShops, totalCustomers }
		};
	}
});

export const get = platformQuery("organizations:read")({
	args: { targetOrganizationId: v.id("organizations") },
	handler: async (ctx, args) => {
		const organization = await ctx.db.get(args.targetOrganizationId);
		if (!organization) throw new ConvexError({ code: "NOT_FOUND", message: "Organization not found" });

		const region = organization.regionId ? await ctx.db.get(organization.regionId) : null;

		const shops = await ctx.db
			.query("shops")
			.withIndex("by_organization", (q) => q.eq("organizationId", args.targetOrganizationId))
			.collect();

		const staffRows = await ctx.db
			.query("organizationStaff")
			.withIndex("by_organization", (q) => q.eq("organizationId", args.targetOrganizationId))
			.collect();
		const staff = await Promise.all(
			staffRows.map(async (row) => {
				const user = await authComponent.getAnyUserById(ctx, row.authUserId);
				return { id: row._id, role: row.role, email: user?.email ?? "Unknown" };
			})
		);

		const customers = await ctx.db
			.query("customers")
			.withIndex("by_organization", (q) => q.eq("organizationId", args.targetOrganizationId))
			.collect();

		let activeMemberCount = 0;
		let pointsIssuedTotal = 0;
		let couponsIssued = 0;
		let couponsRedeemed = 0;
		let rewardsGranted = 0;
		const now = Date.now();

		for (const customer of customers) {
			const memberships = await ctx.db
				.query("customerMemberships")
				.withIndex("by_customer", (q) => q.eq("customerId", customer._id))
				.collect();
			if (memberships.some((m) => m.status === "ACTIVE" && m.expiryDate > now)) activeMemberCount++;

			const ledger = await ctx.db
				.query("pointLedger")
				.withIndex("by_customer", (q) => q.eq("customerId", customer._id))
				.collect();
			pointsIssuedTotal += ledger.reduce((sum, r) => sum + Math.max(0, r.amount), 0);

			const coupons = await ctx.db
				.query("couponInstances")
				.withIndex("by_customer", (q) => q.eq("customerId", customer._id))
				.collect();
			couponsIssued += coupons.length;
			couponsRedeemed += coupons.filter((c) => c.status === "REDEEMED").length;

			const rewards = await ctx.db
				.query("customerRewards")
				.withIndex("by_customer", (q) => q.eq("customerId", customer._id))
				.collect();
			rewardsGranted += rewards.length;
		}

		const [tiers, pointRules, rewardDefs, couponDefs, plans] = await Promise.all([
			ctx.db.query("tiers").withIndex("by_organization", (q) => q.eq("organizationId", args.targetOrganizationId)).collect(),
			ctx.db.query("pointRules").withIndex("by_organization", (q) => q.eq("organizationId", args.targetOrganizationId)).collect(),
			ctx.db
				.query("rewardDefinitions")
				.withIndex("by_organization", (q) => q.eq("organizationId", args.targetOrganizationId))
				.collect(),
			ctx.db
				.query("couponDefinitions")
				.withIndex("by_organization", (q) => q.eq("organizationId", args.targetOrganizationId))
				.collect(),
			ctx.db
				.query("membershipPlans")
				.withIndex("by_organization", (q) => q.eq("organizationId", args.targetOrganizationId))
				.collect()
		]);

		return {
			organization: { ...organization, regionName: region?.countryName ?? null },
			shops,
			staff,
			analytics: {
				customerCount: customers.length,
				activeMemberCount,
				pointsIssuedTotal,
				couponsIssued,
				couponsRedeemed,
				rewardsGranted,
				tierCount: tiers.length,
				pointRuleCount: pointRules.length,
				rewardDefCount: rewardDefs.length,
				couponDefCount: couponDefs.length,
				planCount: plans.length
			}
		};
	}
});

const orgFields = {
	name: v.string(),
	phoneNumber: v.optional(v.string()),
	website: v.optional(v.string()),
	address: v.optional(v.string()),
	regionId: v.optional(v.id("regions")),
	currencyCode: v.optional(v.string()),
	businessRegistrationNumber: v.optional(v.string()),
	taxId: v.optional(v.string())
};

export const create = platformMutation("organizations:create")({
	args: { ...orgFields, ownerEmail: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const { ownerEmail, ...fields } = args;
		const organizationId = await ctx.db.insert("organizations", fields);

		if (ownerEmail?.trim()) {
			const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
				model: "user",
				where: [{ field: "email", operator: "eq", value: ownerEmail.trim().toLowerCase() }]
			});
			if (user) {
				const authUserId = user._id as string;
				await ctx.db.insert("organizationStaff", { organizationId, authUserId, role: "owner", isActive: true });
				// Trusted bootstrap path: a fresh org's tenant has no
				// existing role holders yet, so the guarded `authz`
				// instance's assignableRoles check (evaluated against the
				// ORG's tenant, not the platform tenant the calling admin
				// actually holds a role in) would always reject this —
				// same rationale as organizations.createSelfServe.
				await trustedAuthz.withTenant(organizationId).assignRole(ctx, authUserId, "owner", {
					type: "organization",
					id: organizationId
				});
			}
			// No account yet: the org is still created — same as the old
			// Supabase-era invite fallback, minus the actual invite email
			// (no provider wired up yet). An admin can add the owner as
			// staff later once they've signed up.
		}

		return { organizationId };
	}
});

export const update = platformMutation("organizations:write")({
	args: { targetOrganizationId: v.id("organizations"), ...orgFields },
	handler: async (ctx, args) => {
		const { targetOrganizationId, ...fields } = args;
		await ctx.db.patch(targetOrganizationId, fields);
	}
});

async function deleteAllByCustomer(ctx: MutationCtx, customerId: Id<"customers">) {
	for (const table of ["pointLedger", "customerTier", "customerRewards", "couponInstances", "customerMemberships"] as const) {
		const rows = await ctx.db
			.query(table)
			.withIndex("by_customer", (q) => q.eq("customerId", customerId))
			.collect();
		for (const row of rows) await ctx.db.delete(row._id);
	}
	await ctx.db.delete(customerId);
}

export const remove = platformMutation("organizations:write")({
	args: { targetOrganizationId: v.id("organizations"), confirmName: v.string() },
	handler: async (ctx, args) => {
		const organization = await ctx.db.get(args.targetOrganizationId);
		if (!organization) throw new ConvexError({ code: "NOT_FOUND", message: "Organization not found" });
		if (args.confirmName !== organization.name) {
			throw new ConvexError({ code: "MISMATCH", message: "Type the exact organization name to confirm deletion." });
		}
		const orgId = args.targetOrganizationId;

		const customers = await ctx.db
			.query("customers")
			.withIndex("by_organization", (q) => q.eq("organizationId", orgId))
			.collect();
		for (const customer of customers) await deleteAllByCustomer(ctx, customer._id);

		// idempotencyKeys isn't cleaned up here — it has no by_organization
		// index (only by_key, its actual lookup path) and a leftover key
		// referencing a deleted org is inert, never matched again.
		for (const table of [
			"shops",
			"apiKeys",
			"tiers",
			"pointRules",
			"rewardDefinitions",
			"couponDefinitions",
			"membershipPlans",
			"eligibilityConditions",
			"grantedBenefits",
			"passTemplates"
		] as const) {
			const rows = await ctx.db
				.query(table)
				.withIndex("by_organization", (q) => q.eq("organizationId", orgId))
				.collect();
			for (const row of rows) await ctx.db.delete(row._id);
		}

		const staffRows = await ctx.db
			.query("organizationStaff")
			.withIndex("by_organization", (q) => q.eq("organizationId", orgId))
			.collect();
		for (const staffRow of staffRows) {
			await trustedAuthz.withTenant(orgId).offboardUser(ctx, staffRow.authUserId);
			await ctx.db.delete(staffRow._id);
		}

		await ctx.db.delete(orgId);
	}
});
