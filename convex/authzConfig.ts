import { Authz, definePermissions, defineRoles } from "@proxie-studio/authz-tenant-kit";
import { components } from "./_generated/api";
import { v } from "convex/values";

// Template-only base namespace — see `authz`/`trustedAuthz` below. Never
// call a method directly against BASE_TENANT_ID; every real call site
// derives a per-organization instance via `.withTenant(organizationId)`
// first, exactly as admin-panel-v2's authzConfig.ts does.
const BASE_TENANT_ID = "norrone-rewards";

// Sentinel tenant for platform-admin permission checks. authz-tenant-kit
// has no notion of a global/cross-tenant role — `validateTenantId` throws
// on an empty tenantId — so platform admin is modeled as its own
// "organization" that no real org can ever collide with (organizationId
// values are Convex document ids, which never take this literal string
// form). `platformAuthz.withTenant(PLATFORM_TENANT_ID)` is the only tenant
// that literal ever gets scoped to.
export const PLATFORM_TENANT_ID = "__platform__";

// Permission set for the loyalty domain. `platform` covers the
// platform-admin surface (regions, cross-org visibility) and only ever
// gets checked against PLATFORM_TENANT_ID, never a real org's tenant.
export const permissions = definePermissions({
	organizations: { read: true, write: true, create: true },
	shops: { read: true, write: true },
	apiKeys: { read: true, write: true, revoke: true },
	staff: { read: true, invite: true, assignRole: true, revoke: true },
	customers: { read: true, write: true, grant: true }, // grant = manual point/tier/reward/coupon grants
	tiers: { read: true, write: true },
	pointRules: { read: true, write: true },
	rewards: { read: true, write: true },
	coupons: { read: true, write: true },
	membershipPlans: { read: true, write: true },
	passTemplates: { read: true, write: true },
	// Platform-admin-only surface — checked exclusively under PLATFORM_TENANT_ID.
	platform: { read: true, write: true },
	regions: { read: true, write: true }
});

// Role ladder: staff < manager < owner. Norrone's existing free-text
// role convention (see schema.ts's organizationStaff.role comment) maps
// onto this directly. There is no org_admin tier here — unlike
// admin-panel-v2, there's no "elevate one org's owner into a
// cross-tenant admin" concept; that's what the platformAdmin role (below)
// is for, and it lives in a separate tenant entirely.
export const roles = defineRoles(permissions, {
	staff: {
		shops: ["read"],
		customers: ["read"],
		tiers: ["read"],
		pointRules: ["read"],
		rewards: ["read"],
		coupons: ["read"],
		membershipPlans: ["read"],
		passTemplates: ["read"]
	},
	manager: {
		inherits: "staff",
		customers: ["write", "grant"],
		tiers: ["write"],
		pointRules: ["write"],
		rewards: ["write"],
		coupons: ["write"],
		membershipPlans: ["write"],
		passTemplates: ["write"],
		staff: ["read"]
	},
	owner: {
		inherits: "manager",
		organizations: ["read", "write"],
		shops: ["write"],
		apiKeys: ["read", "write", "revoke"],
		staff: ["invite", "assignRole", "revoke"]
	},
	// Only ever assigned/checked under PLATFORM_TENANT_ID — see
	// PLATFORM_TENANT_ID's comment above. Not part of the org role ladder;
	// a platformAdmin holds no implicit role in any real organization's
	// tenant (there's no `inherits` here for that reason).
	platformAdmin: {
		platform: ["read", "write"],
		regions: ["read", "write"],
		organizations: ["read", "write", "create"]
	}
});

export type OrgRole = "staff" | "manager" | "owner";
export type PlatformRole = "platformAdmin";

export const orgRoleValidator = v.union(v.literal("staff"), v.literal("manager"), v.literal("owner"));

// TEMPLATE ONLY — never call a method directly on this export; always
// `.withTenant(organizationId)` (real orgs) or
// `.withTenant(PLATFORM_TENANT_ID)` (platform admin) first. Same rule and
// rationale as admin-panel-v2's authzConfig.ts.
export const authz = new Authz(components.authz, {
	permissions,
	roles,
	tenantId: BASE_TENANT_ID,
	// Privilege-escalation guard: an owner can promote/demote staff up to
	// manager, but never mint another owner — that still requires the
	// trustedAuthz bootstrap path (org creation, or a future
	// owner-transfer flow built deliberately). A platformAdmin can assign
	// any org role when acting on an org's behalf (support/escalation).
	assignableRoles: {
		owner: ["staff", "manager"],
		platformAdmin: ["staff", "manager", "owner"]
	}
});

// TEMPLATE ONLY, same rule as `authz` above. Unguarded (no
// assignableRoles) — for trusted, server-only bootstrap paths only:
// org self-serve signup (granting the creator `owner` in their new org's
// tenant) and seeding the first platform admin. Never import this from a
// query/mutation/action reachable by a client-supplied role argument.
export const trustedAuthz = new Authz(components.authz, {
	permissions,
	roles,
	tenantId: BASE_TENANT_ID
});
