import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Norrone Rewards data model, ported from the Supabase/Postgres schema
 * (see CLAUDE_CODE_BUILD_SPEC_V2_SUPABASE.md §3) to Convex documents.
 *
 * Tenant isolation and role storage move OUT of these tables entirely —
 * `organization_staff`/`platform_admins`/RLS's `is_org_staff()` are
 * replaced by @proxie-studio/authz-tenant-kit, which keeps its own
 * role-assignment storage in its own component (see convex/authzConfig.ts
 * once that lands). `organizationStaff`/`platformAdmins` below are thin
 * *display/listing* tables only (authz has no "list everyone with a role
 * in tenant X" query, only per-user lookups) — the source of truth for
 * "is this actually allowed" is always authz's `.require(...)`, never a
 * read from these two tables.
 *
 * Convex gives every document `_id` and `_creationTime` for free, so
 * Postgres's explicit `created_at timestamptz default now()` columns are
 * dropped throughout — `_creationTime` covers that.
 *
 * Convex has no foreign keys and no unique-column constraints. Every
 * "unique (x, y)" from the Postgres schema becomes a comment here plus a
 * check-before-insert in the mutation that writes that table — indexes
 * below exist to make that check (and every other lookup that used to be
 * a `WHERE` clause) cheap, not to enforce it by themselves.
 */
export default defineSchema({
	// --- PLATFORM ------------------------------------------------------

	// Admin-managed list of supported countries (name, phone code, default
	// currency). Read by any signed-in user (to populate a country
	// dropdown), written only by platform admins — enforced in the
	// mutations, not by anything in this file.
	regions: defineTable({
		countryName: v.string(),
		isoCode: v.string(), // ISO 3166-1 alpha-2, e.g. "IN" — unique, checked on insert/update
		phoneCode: v.string(), // e.g. "+91"
		currencyCode: v.string(), // ISO 4217, e.g. "INR"
		currencySymbol: v.string() // e.g. "₹"
	}).index("by_iso_code", ["isoCode"]),

	// Platform admins: a role in a sentinel tenant inside authz-tenant-kit
	// is the actual enforcement mechanism (see authzConfig.ts's
	// PLATFORM_TENANT_ID) — this table exists only so the admin panel can
	// list who currently has that role without a per-user authz lookup
	// per row, and to soft-disable one without revoking+re-granting.
	platformAdmins: defineTable({
		authUserId: v.string(), // Better Auth user id (string, not a Convex Id — lives in the betterAuth component)
		isActive: v.boolean()
	}).index("by_user", ["authUserId"]),

	// --- ORGANIZATIONS & SHOPS ------------------------------------------

	organizations: defineTable({
		name: v.string(),
		phoneNumber: v.optional(v.string()),
		website: v.optional(v.string()),
		address: v.optional(v.string()),
		regionId: v.optional(v.id("regions")),
		currencyCode: v.optional(v.string()),
		businessRegistrationNumber: v.optional(v.string()),
		taxId: v.optional(v.string())
	}),

	// Display/listing cache for "who is staff at this org and what's their
	// role" — see the file-level comment. `role` here is a snapshot kept
	// in sync by whatever mutation calls authz's assignRole/revokeRole; the
	// actual permission check always goes through authz, never this field.
	organizationStaff: defineTable({
		organizationId: v.id("organizations"),
		authUserId: v.string(),
		role: v.string(), // mirrors authzConfig.ts's role ladder (union there, kept loose here to avoid a schema/authzConfig coupling on every role change)
		isActive: v.boolean()
	})
		.index("by_organization", ["organizationId"])
		.index("by_organization_and_user", ["organizationId", "authUserId"]) // unique (organization_id, user_id) in the old schema
		.index("by_user", ["authUserId"]), // "which orgs is this person staff at" — the multi-org case Postgres's organization_staff already supported

	shops: defineTable({
		organizationId: v.id("organizations"),
		name: v.string(),
		externalShopId: v.optional(v.string()),
		phoneNumber: v.optional(v.string()),
		address: v.optional(v.string()),
		regionId: v.optional(v.id("regions")),
		currencyCode: v.optional(v.string())
	}).index("by_organization", ["organizationId"]),

	// Idempotency guard for updateCustomerStats/enrollMembership, called by
	// the future public API — only ever touched by that service-role layer,
	// never by the dashboard. Convex has no unique-column constraint, so
	// every write here is a check-via-index-then-insert; that's still race
	// safe under Convex's OCC (a concurrent mutation that read the same
	// index range gets retried, exactly like Postgres's unique_violation
	// catch did).
	idempotencyKeys: defineTable({
		key: v.string(),
		organizationId: v.id("organizations")
	}).index("by_key", ["key"]),

	// --- PUBLIC API AUTH (machine-to-machine, separate from Better Auth) --

	apiKeys: defineTable({
		organizationId: v.id("organizations"),
		shopId: v.optional(v.id("shops")), // null/absent = valid for all shops under the org
		hashedKey: v.string(), // unique — checked on insert; this is the hot-path lookup for requireApiKey()
		type: v.union(v.literal("secret"), v.literal("publishable")),
		revoked: v.boolean()
	})
		.index("by_organization", ["organizationId"])
		.index("by_hashed_key", ["hashedKey"]),

	// --- CUSTOMERS -------------------------------------------------------

	customers: defineTable({
		organizationId: v.id("organizations"),
		shopId: v.id("shops"),
		externalId: v.string(), // the org's own customer id for this shop — unique (shop_id, external_id)
		name: v.optional(v.string()),
		phone: v.optional(v.string()),
		email: v.optional(v.string()),
		totalSpend: v.number(),
		visitCount: v.number()
	})
		.index("by_organization", ["organizationId"])
		.index("by_shop", ["shopId"])
		.index("by_shop_and_external_id", ["shopId", "externalId"]),

	// --- MEMBERSHIP --------------------------------------------------------

	membershipPlans: defineTable({
		organizationId: v.id("organizations"),
		shopId: v.optional(v.id("shops")), // null = org-wide template
		name: v.string(),
		price: v.optional(v.number()), // absent = free
		durationDays: v.optional(v.number()), // absent = never expires (see loyaltyEngine.ts's NO_EXPIRY_MS)
		pointMultiplier: v.number()
	}).index("by_organization", ["organizationId"]),

	customerMemberships: defineTable({
		customerId: v.id("customers"),
		planId: v.id("membershipPlans"),
		status: v.union(v.literal("ACTIVE"), v.literal("EXPIRED"), v.literal("CANCELLED")),
		startDate: v.number(), // epoch ms
		expiryDate: v.number() // epoch ms
	})
		.index("by_customer", ["customerId"])
		.index("by_customer_and_status", ["customerId", "status"]),

	// --- TIERS ---------------------------------------------------------

	tiers: defineTable({
		organizationId: v.id("organizations"),
		shopId: v.optional(v.id("shops")), // null = org-wide template
		name: v.string(),
		level: v.number(),
		pointMultiplier: v.number()
	}).index("by_organization", ["organizationId"]),

	customerTier: defineTable({
		customerId: v.id("customers"),
		tierId: v.id("tiers"),
		source: v.union(v.literal("MANUAL"), v.literal("AUTO"))
		// achieved_at dropped — _creationTime already orders these; the
		// "current tier" query is still "most recent row for this customer".
	})
		.index("by_customer", ["customerId"])
		.index("by_tier", ["tierId"]),

	// --- POINTS -------------------------------------------------------------

	pointRules: defineTable({
		organizationId: v.id("organizations"),
		shopId: v.optional(v.id("shops")), // null = org-wide template
		action: v.string(), // PURCHASE | VISIT | REFERRAL | ...
		pointsPerUnit: v.number(),
		memberOnly: v.boolean()
	}).index("by_organization", ["organizationId"]),

	pointLedger: defineTable({
		customerId: v.id("customers"),
		amount: v.number(), // can be negative (reversal)
		reason: v.union(v.literal("ACTION"), v.literal("MANUAL"), v.literal("EXPIRY"), v.literal("REVERSAL")),
		referenceId: v.optional(v.string())
		// balance = sum(amount) for the customer — still no mutable counter column.
	}).index("by_customer", ["customerId"]),

	// --- REWARDS -------------------------------------------------------------

	rewardDefinitions: defineTable({
		organizationId: v.id("organizations"),
		shopId: v.optional(v.id("shops")),
		name: v.string(),
		description: v.optional(v.string()),
		memberOnly: v.boolean()
	}).index("by_organization", ["organizationId"]),

	customerRewards: defineTable({
		customerId: v.id("customers"),
		rewardId: v.id("rewardDefinitions")
	})
		.index("by_customer", ["customerId"])
		.index("by_customer_and_reward", ["customerId", "rewardId"]),

	// --- COUPONS -------------------------------------------------------------

	couponDefinitions: defineTable({
		organizationId: v.id("organizations"),
		shopId: v.optional(v.id("shops")),
		name: v.string(),
		discountValue: v.number(),
		discountType: v.union(v.literal("PERCENTAGE"), v.literal("FIXED")),
		validityDays: v.number(),
		memberOnly: v.boolean()
	}).index("by_organization", ["organizationId"]),

	couponInstances: defineTable({
		customerId: v.id("customers"),
		couponDefinitionId: v.id("couponDefinitions"),
		code: v.string(), // unique — the hot-path lookup for /redeem
		status: v.union(v.literal("ISSUED"), v.literal("REDEEMED"), v.literal("EXPIRED"), v.literal("CANCELLED")),
		expiresAt: v.number(), // epoch ms
		redeemedAt: v.optional(v.number())
	})
		.index("by_customer", ["customerId"])
		.index("by_code", ["code"]),

	// --- SHARED: ELIGIBILITY ---------------------------------------------

	// Attached to Tier, Reward, or Coupon definitions only — a real union
	// of Id types (Convex supports this natively), unlike Postgres's
	// untyped `target_id uuid` + a `target_type` discriminator.
	eligibilityConditions: defineTable({
		organizationId: v.id("organizations"),
		targetType: v.union(v.literal("TIER"), v.literal("REWARD"), v.literal("COUPON")),
		targetId: v.union(v.id("tiers"), v.id("rewardDefinitions"), v.id("couponDefinitions")),
		metric: v.union(
			v.literal("SPEND"),
			v.literal("VISITS"),
			v.literal("POINTS"),
			v.literal("TIER_LEVEL"),
			v.literal("MEMBERSHIP_ACTIVE")
		),
		operator: v.union(v.literal("GTE"), v.literal("LTE"), v.literal("EQ")),
		value: v.number(),
		period: v.union(v.literal("LIFETIME"), v.literal("MONTHLY"), v.literal("YEARLY"))
	})
		.index("by_target", ["targetType", "targetId"])
		.index("by_organization", ["organizationId"]),

	// --- SHARED: GRANTS -----------------------------------------------------

	grantedBenefits: defineTable({
		organizationId: v.id("organizations"),
		sourceType: v.union(v.literal("MEMBERSHIP_PLAN"), v.literal("TIER")),
		sourceId: v.union(v.id("membershipPlans"), v.id("tiers")),
		benefitType: v.union(v.literal("TIER"), v.literal("REWARD"), v.literal("COUPON"), v.literal("POINTS")),
		benefitId: v.optional(v.union(v.id("tiers"), v.id("rewardDefinitions"), v.id("couponDefinitions"))),
		pointsAmount: v.optional(v.number())
	})
		.index("by_source", ["sourceType", "sourceId"])
		.index("by_organization", ["organizationId"]),

	// --- WALLET PASSES --------------------------------------------------

	passTemplates: defineTable({
		organizationId: v.id("organizations"),
		shopId: v.optional(v.id("shops")), // null = org default, shop overrides branding
		logoStorageId: v.optional(v.id("_storage")), // uploaded via passTemplates.generateUploadUrl
		// The full-width box below the header (Apple's strip / Google's
		// heroImage) — the org's own real image, used as-is, never
		// generated art. Absent = the box is just a flat backgroundColor fill.
		bannerStorageId: v.optional(v.id("_storage")),
		backgroundColor: v.optional(v.string()), // Apple only, hex — converted to rgb() at pass-build time
		foregroundColor: v.optional(v.string()), // Apple only, hex
		// labelColor is deliberately NOT stored here — it's always derived
		// from background+foreground (lib/wallet/color.ts's
		// deriveLabelColor) rather than a separate org-set color.
		organizationDisplayName: v.optional(v.string()), // Apple only
		// Google's entire design is fully independent from Apple's above —
		// its own logo, banner, colors, and display name, with no fallback
		// between the two. They're edited on separate tabs in the dashboard
		// (src/routes/orgs/[orgId]/wallet/+page.svelte) precisely because
		// orgs wanted them decoupled, not sharing one config that happens to
		// serve both platforms.
		googleLogoStorageId: v.optional(v.id("_storage")),
		googleBannerStorageId: v.optional(v.id("_storage")),
		googleBackgroundColor: v.optional(v.string()),
		googleForegroundColor: v.optional(v.string()),
		googleDisplayName: v.optional(v.string()),
		// Google's branding (logo/name) lives on the LoyaltyClass, not the
		// per-customer object, so a custom template needs its own class —
		// this is that class's id once we've created/updated it via the
		// Wallet API (see lib/wallet/googlePass.ts's ensureLoyaltyClass).
		// Absent = this org still uses the shared default class.
		googleClassId: v.optional(v.string())
	}).index("by_organization", ["organizationId"]),

	// One row per (device, pass) a customer has added to Apple Wallet —
	// tells the future push-update action which devices to notify.
	passRegistrations: defineTable({
		deviceLibraryIdentifier: v.string(),
		passTypeIdentifier: v.string(),
		serialNumber: v.string(), // customer id (loyalty card) or coupon instance id (coupon pass), as a string
		pushToken: v.string()
	})
		.index("by_device_type_serial", ["deviceLibraryIdentifier", "passTypeIdentifier", "serialNumber"])
		.index("by_serial", ["serialNumber"])
});
