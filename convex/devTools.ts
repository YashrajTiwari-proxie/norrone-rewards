import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { generateApiKey, hashApiKey } from "./lib/apiKeys";
import { generateCouponCode } from "./lib/loyaltyEngine";
import { trustedAuthz } from "./authzConfig";

// Every org-tenant-scoped table — cleared by resetAndSeedDemo below.
// Deliberately excludes `regions` (platform-wide reference data, not
// tenant data) and `platformAdmins` (dev-only login preservation is the
// whole point of that mutation). Better Auth's own user/account/session
// rows live in a separate component, untouched by any of this — clearing
// our app tables never affects who can log in, only what they can see.
const TENANT_TABLES = [
	"organizationStaff",
	"shops",
	"idempotencyKeys",
	"apiKeys",
	"customers",
	"membershipPlans",
	"customerMemberships",
	"tiers",
	"customerTier",
	"pointRules",
	"pointLedger",
	"rewardDefinitions",
	"customerRewards",
	"couponDefinitions",
	"couponInstances",
	"eligibilityConditions",
	"grantedBenefits",
	"passTemplates",
	"passRegistrations",
	"organizations"
] as const;

/**
 * Dev-only: wipes every organization/shop/customer/etc. row and reseeds
 * one clean demo org with a couple of shops and a few customers each —
 * run via `npx convex run devTools:resetAndSeedDemo`, never reachable
 * from any client. Existing platformAdmins rows (and their Better Auth
 * accounts, in a separate component untouched by this) are left alone,
 * so admin panel logins keep working exactly as before, and both are
 * added as `owner` staff on the new demo org so they can log into its
 * dashboard immediately too.
 */
export const resetAndSeedDemo = internalMutation({
	args: {},
	handler: async (ctx) => {
		for (const table of TENANT_TABLES) {
			const rows = await ctx.db.query(table).collect();
			for (const row of rows) await ctx.db.delete(row._id);
		}

		const organizationId = await ctx.db.insert("organizations", {
			name: "Norrone Demo Co",
			address: "1 Demo Street",
			phoneNumber: "+1 555 0199"
		});

		// Both preserved platform admins get owner access to the new demo
		// org too, so whichever one you're testing with can open its
		// dashboard immediately without a separate signup. organizationStaff
		// alone is just a display cache (see schema.ts's file comment) — the
		// actual permission grant has to go through authz too, exactly like
		// organizations.ts's createSelfServe does for a normal signup, or
		// every "customers:read"-etc. check fails with FORBIDDEN despite the
		// staff row existing.
		const admins = await ctx.db.query("platformAdmins").collect();
		for (const admin of admins) {
			await ctx.db.insert("organizationStaff", {
				organizationId,
				authUserId: admin.authUserId,
				role: "owner",
				isActive: true
			});
			await trustedAuthz.withTenant(organizationId).assignRole(ctx, admin.authUserId, "owner", {
				type: "organization",
				id: organizationId
			});
		}

		const tierId = await ctx.db.insert("tiers", {
			organizationId,
			name: "Gold",
			level: 1,
			pointMultiplier: 2
		});
		await ctx.db.insert("eligibilityConditions", {
			organizationId,
			targetType: "TIER",
			targetId: tierId,
			metric: "SPEND",
			operator: "GTE",
			value: 200,
			period: "LIFETIME"
		});
		await ctx.db.insert("pointRules", {
			organizationId,
			action: "PURCHASE",
			pointsPerUnit: 1,
			memberOnly: false
		});

		const shopSeeds = [
			{ name: "Downtown", slug: "downtown" },
			{ name: "Uptown", slug: "uptown" }
		];

		const shops: { shopId: string; name: string; customers: { customerId: string; externalId: string; name: string }[] }[] = [];

		for (const shopSeed of shopSeeds) {
			const shopId = await ctx.db.insert("shops", { organizationId, name: shopSeed.name });

			const customerNames = ["Ada Lovelace", "Grace Hopper", "Alan Turing"];
			const customers: { customerId: string; externalId: string; name: string }[] = [];

			for (let i = 0; i < customerNames.length; i++) {
				const externalId = `cust-${shopSeed.slug}-${i + 1}`;
				const totalSpend = 50 + i * 120; // last customer per shop clears the Gold threshold
				const customerId = await ctx.db.insert("customers", {
					organizationId,
					shopId,
					externalId,
					name: customerNames[i],
					phone: `555-${shopSeed.slug === "downtown" ? "1" : "2"}0${i}0`,
					totalSpend,
					visitCount: i + 1
				});
				await ctx.db.insert("pointLedger", {
					customerId,
					amount: totalSpend,
					reason: "ACTION",
					referenceId: "demo-seed"
				});
				if (totalSpend >= 200) {
					await ctx.db.insert("customerTier", { customerId, tierId, source: "AUTO" });
				}
				customers.push({ customerId, externalId, name: customerNames[i] });
			}

			shops.push({ shopId, name: shopSeed.name, customers });
		}

		const plaintextApiKey = generateApiKey("secret");
		await ctx.db.insert("apiKeys", {
			organizationId,
			shopId: undefined,
			hashedKey: await hashApiKey(plaintextApiKey),
			type: "secret",
			revoked: false
		});

		return { organizationId, shops, plaintextApiKey };
	}
});

/**
 * One-off fixture seeding for exercising the /v1/... HTTP API end-to-end
 * before the dashboard is wired up to create orgs/shops/API keys itself
 * (that's the self-serve-signup + API-key-management UI, still pending —
 * see the migration's own pending-tasks list). Run via
 * `npx convex run devTools:seedApiTestFixtures`. Not reachable from any
 * client — internalMutation only.
 */
export const seedApiTestFixtures = internalMutation({
	args: {},
	handler: async (ctx) => {
		const organizationId = await ctx.db.insert("organizations", { name: "Convex Test Org" });
		const shopId = await ctx.db.insert("shops", { organizationId, name: "Convex Test Shop" });

		const plaintextKey = generateApiKey("secret");
		await ctx.db.insert("apiKeys", {
			organizationId,
			shopId: undefined,
			hashedKey: await hashApiKey(plaintextKey),
			type: "secret",
			revoked: false
		});

		const tierId = await ctx.db.insert("tiers", {
			organizationId,
			name: "Gold",
			level: 1,
			pointMultiplier: 2
		});
		await ctx.db.insert("eligibilityConditions", {
			organizationId,
			targetType: "TIER",
			targetId: tierId,
			metric: "SPEND",
			operator: "GTE",
			value: 100,
			period: "LIFETIME"
		});

		await ctx.db.insert("pointRules", {
			organizationId,
			action: "PURCHASE",
			pointsPerUnit: 1,
			memberOnly: false
		});

		const planId = await ctx.db.insert("membershipPlans", {
			organizationId,
			name: "VIP Monthly",
			price: 9.99,
			durationDays: 30,
			pointMultiplier: 1.5
		});

		return { organizationId, shopId, tierId, planId, plaintextKey };
	}
});

/** Deletes every couponInstances row with a given code — cleanup for a bad manual seed, not a real feature. */
export const deleteCouponInstancesByCode = internalMutation({
	args: { code: v.string() },
	handler: async (ctx, args) => {
		const rows = await ctx.db
			.query("couponInstances")
			.withIndex("by_code", (q) => q.eq("code", args.code))
			.collect();
		for (const row of rows) await ctx.db.delete(row._id);
		return { deleted: rows.length };
	}
});

/** Seeds one ISSUED coupon instance directly, for exercising POST /v1/coupons/:code/redeem without needing evaluate_and_grant to fire first. */
export const seedCouponForRedeem = internalMutation({
	args: { organizationId: v.id("organizations"), customerId: v.id("customers"), code: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const couponDefinitionId = await ctx.db.insert("couponDefinitions", {
			organizationId: args.organizationId,
			name: "Test Coupon",
			discountValue: 10,
			discountType: "PERCENTAGE",
			validityDays: 30,
			memberOnly: false
		});
		// Caller-supplied code, or a fresh unique one per call — this is a
		// test-only fixture (unlike real coupon issuance, which always goes
		// through generateCouponCode()'s collision-checked path), so it's
		// on the caller not to hardcode a literal across repeated runs.
		const code = args.code ?? await generateCouponCode(ctx);
		await ctx.db.insert("couponInstances", {
			customerId: args.customerId,
			couponDefinitionId,
			code,
			status: "ISSUED",
			expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000
		});
		return { code };
	}
});

/** Generates a secret API key for an existing organization — used to seed test customers via the /v1 API. */
export const createApiKeyForOrg = internalMutation({
	args: { organizationId: v.id("organizations") },
	handler: async (ctx, args) => {
		const plaintextKey = generateApiKey("secret");
		await ctx.db.insert("apiKeys", {
			organizationId: args.organizationId,
			shopId: undefined,
			hashedKey: await hashApiKey(plaintextKey),
			type: "secret",
			revoked: false
		});
		return { plaintextKey };
	}
});

/** Deletes a grantedBenefits row by id — cleanup for a bad manual test, not a real feature. */
export const deleteGrantedBenefit = internalMutation({
	args: { benefitId: v.id("grantedBenefits") },
	handler: async (ctx, args) => {
		await ctx.db.delete(args.benefitId);
	}
});

/**
 * One-off repair for the resetAndSeedDemo bug above: it inserted
 * organizationStaff rows (the display cache) without also granting the
 * real authz role, so every permission check failed with FORBIDDEN
 * despite staff.list showing the admins as "owner". Grants the missing
 * role for every organizationStaff row that has one — safe to re-run.
 */
export const repairMissingAuthzGrants = internalMutation({
	args: {},
	handler: async (ctx) => {
		const rows = await ctx.db.query("organizationStaff").collect();
		let granted = 0;
		for (const row of rows) {
			await trustedAuthz.withTenant(row.organizationId).assignRole(ctx, row.authUserId, row.role as "staff" | "manager" | "owner", {
				type: "organization",
				id: row.organizationId
			});
			granted++;
		}
		return { granted };
	}
});

/**
 * One-off repair for customerMemberships rows left dangling by
 * membershipPlans.remove before it cascaded (fixed in that mutation now)
 * — cancels any row whose planId no longer resolves to a real plan, same
 * treatment the fixed `remove` mutation itself applies going forward.
 */
export const repairOrphanedMemberships = internalMutation({
	args: {},
	handler: async (ctx) => {
		const memberships = await ctx.db
			.query("customerMemberships")
			.filter((q) => q.eq(q.field("status"), "ACTIVE"))
			.collect();
		let cancelled = 0;
		for (const membership of memberships) {
			const plan = await ctx.db.get(membership.planId);
			if (!plan) {
				await ctx.db.patch(membership._id, { status: "CANCELLED" });
				// A DB-only fix isn't enough — an already-installed pass never
				// re-fetches on its own; without this an org could "fix" data
				// here and still see the stale "Member" status on-device
				// indefinitely, exactly what happened the first time this
				// script ran without it.
				await ctx.scheduler.runAfter(0, internal.walletNode.pushWalletUpdates, {
					customerId: membership.customerId
				});
				cancelled++;
			}
		}
		return { cancelled };
	}
});

/** Dev convenience: lists the email each platformAdmins row belongs to — never a password, Better Auth only stores those hashed. */
export const listAdminEmails = internalQuery({
	args: {},
	handler: async (ctx) => {
		const admins = await ctx.db.query("platformAdmins").collect();
		const result = [];
		for (const admin of admins) {
			const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
				model: "user",
				where: [{ field: "_id", operator: "eq", value: admin.authUserId }]
			});
			result.push({ email: (user as { email?: string } | null)?.email ?? "unknown", isActive: admin.isActive });
		}
		return result;
	}
});
