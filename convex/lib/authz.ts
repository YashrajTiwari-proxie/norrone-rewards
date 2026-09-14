import { customQuery, customMutation, customAction } from "convex-helpers/server/customFunctions";
import { query, mutation, action } from "../_generated/server";
import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { PermissionArg } from "@proxie-studio/authz-tenant-kit";
import { authz, permissions, PLATFORM_TENANT_ID } from "../authzConfig";

type Permission = PermissionArg<typeof permissions>;

/**
 * Identity from the verified session — never from a client-supplied
 * argument. Unlike admin-panel-v2, no organizationId is embedded as a JWT
 * claim: a Norrone user can be staff at more than one organization, so
 * which org a request concerns is always an explicit function argument,
 * checked against this authUserId via authz — never inferred from the
 * session itself.
 */
export async function requireAuthUserId(ctx: {
	auth: { getUserIdentity: () => Promise<Record<string, unknown> | null> };
}): Promise<string> {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) {
		throw new ConvexError({ code: "UNAUTHENTICATED", message: "Sign in required" });
	}
	return identity.subject as string;
}

async function assertActiveOrgStaff(
	ctx: QueryCtx | MutationCtx,
	organizationId: Id<"organizations">,
	authUserId: string
): Promise<void> {
	const membership = await ctx.db
		.query("organizationStaff")
		.withIndex("by_organization_and_user", (q) => q.eq("organizationId", organizationId).eq("authUserId", authUserId))
		.unique();
	if (!membership || !membership.isActive) {
		throw new ConvexError({ code: "ACCOUNT_INACTIVE", message: "Not an active staff member of this organization" });
	}
}

async function assertActivePlatformAdmin(ctx: QueryCtx | MutationCtx, authUserId: string): Promise<void> {
	const row = await ctx.db
		.query("platformAdmins")
		.withIndex("by_user", (q) => q.eq("authUserId", authUserId))
		.unique();
	if (!row || !row.isActive) {
		throw new ConvexError({ code: "FORBIDDEN", message: "Platform admin access required" });
	}
}

/**
 * Require `permission` at a given organization. `organizationId` is an
 * explicit function argument (not a JWT claim, unlike admin-panel-v2) —
 * every function built from this wrapper takes it and reads it back off
 * `ctx.organizationId`, not `args.organizationId`.
 */
export const orgStaffQuery = (permission: Permission) =>
	customQuery(query, {
		args: { organizationId: v.id("organizations") },
		input: async (ctx, args) => {
			const authUserId = await requireAuthUserId(ctx);
			await assertActiveOrgStaff(ctx, args.organizationId, authUserId);
			await authz
				.withTenant(args.organizationId)
				.require(ctx, authUserId, permission, { type: "organization", id: args.organizationId });
			return { ctx: { authUserId, organizationId: args.organizationId }, args: {} };
		}
	});

export const orgStaffMutation = (permission: Permission) =>
	customMutation(mutation, {
		args: { organizationId: v.id("organizations") },
		input: async (ctx, args) => {
			const authUserId = await requireAuthUserId(ctx);
			await assertActiveOrgStaff(ctx, args.organizationId, authUserId);
			await authz
				.withTenant(args.organizationId)
				.require(ctx, authUserId, permission, { type: "organization", id: args.organizationId });
			return { ctx: { authUserId, organizationId: args.organizationId }, args: {} };
		}
	});

/**
 * Require `permission` at whichever organization owns `shopId` — the
 * shop's OWN organizationId is used as the tenant, never a
 * client-claimed one, mirroring admin-panel-v2's staffRestaurantQuery.
 * This is what stops a staff member of org A from acting on org B's shop
 * just by passing org B's shopId.
 */
export const shopStaffQuery = (permission: Permission) =>
	customQuery(query, {
		args: { shopId: v.id("shops") },
		input: async (ctx, args) => {
			const authUserId = await requireAuthUserId(ctx);
			const shop = await ctx.db.get(args.shopId);
			if (!shop) {
				throw new ConvexError({ code: "NOT_FOUND", message: "Shop not found" });
			}
			await assertActiveOrgStaff(ctx, shop.organizationId, authUserId);
			await authz
				.withTenant(shop.organizationId)
				.require(ctx, authUserId, permission, [
					{ type: "shop", id: args.shopId },
					{ type: "organization", id: shop.organizationId }
				]);
			return { ctx: { authUserId, organizationId: shop.organizationId, shopId: args.shopId }, args: {} };
		}
	});

export const shopStaffMutation = (permission: Permission) =>
	customMutation(mutation, {
		args: { shopId: v.id("shops") },
		input: async (ctx, args) => {
			const authUserId = await requireAuthUserId(ctx);
			const shop = await ctx.db.get(args.shopId);
			if (!shop) {
				throw new ConvexError({ code: "NOT_FOUND", message: "Shop not found" });
			}
			await assertActiveOrgStaff(ctx, shop.organizationId, authUserId);
			await authz
				.withTenant(shop.organizationId)
				.require(ctx, authUserId, permission, [
					{ type: "shop", id: args.shopId },
					{ type: "organization", id: shop.organizationId }
				]);
			return { ctx: { authUserId, organizationId: shop.organizationId, shopId: args.shopId }, args: {} };
		}
	});

/** Platform-admin variants — always scoped to PLATFORM_TENANT_ID, never a real org's tenant. */
export const platformQuery = (permission: Permission) =>
	customQuery(query, {
		args: {},
		input: async (ctx) => {
			const authUserId = await requireAuthUserId(ctx);
			await assertActivePlatformAdmin(ctx, authUserId);
			await authz.withTenant(PLATFORM_TENANT_ID).require(ctx, authUserId, permission, undefined);
			return { ctx: { authUserId }, args: {} };
		}
	});

export const platformMutation = (permission: Permission) =>
	customMutation(mutation, {
		args: {},
		input: async (ctx) => {
			const authUserId = await requireAuthUserId(ctx);
			await assertActivePlatformAdmin(ctx, authUserId);
			await authz.withTenant(PLATFORM_TENANT_ID).require(ctx, authUserId, permission, undefined);
			return { ctx: { authUserId }, args: {} };
		}
	});

// Action variants — needed for endpoints that must create a Better Auth
// user (staff invite) or otherwise need a full action context. Actions
// have no direct ctx.db, so these skip the isActive check that
// assertActiveOrgStaff/assertActivePlatformAdmin do above; add an
// internalQuery hop here (mirroring admin-panel-v2's
// lib/staffActiveQuery.ts) if/when an action-based endpoint needs it.
export const orgStaffAction = (permission: Permission) =>
	customAction(action, {
		args: { organizationId: v.id("organizations") },
		input: async (ctx, args) => {
			const authUserId = await requireAuthUserId(ctx);
			await authz
				.withTenant(args.organizationId)
				.require(ctx, authUserId, permission, { type: "organization", id: args.organizationId });
			return { ctx: { authUserId, organizationId: args.organizationId }, args: {} };
		}
	});

export const platformAction = (permission: Permission) =>
	customAction(action, {
		args: {},
		input: async (ctx) => {
			const authUserId = await requireAuthUserId(ctx);
			await authz.withTenant(PLATFORM_TENANT_ID).require(ctx, authUserId, permission, undefined);
			return { ctx: { authUserId }, args: {} };
		}
	});

/**
 * Validates an optional `shopId` field belongs to `organizationId` before
 * it's stored on an org-scoped record (tiers/point rules/rewards/
 * coupons/membership plans/API keys all take an optional shopId to scope
 * themselves to one shop instead of "all shops"). Without this, a staff
 * member could pass another organization's shopId and permanently
 * associate that record with a foreign shop — not itself a cross-tenant
 * *read* (every consumer still re-derives its tenant from
 * organizationId, never from the shop), but a real data-integrity gap
 * caught in a security audit. `undefined` (org-wide) always passes.
 */
export async function assertShopInOrg(
	ctx: { db: { get: (id: Id<"shops">) => Promise<{ organizationId: Id<"organizations"> } | null> } },
	shopId: Id<"shops"> | undefined,
	organizationId: Id<"organizations">
): Promise<void> {
	if (shopId == null) return;
	const shop = await ctx.db.get(shopId);
	if (!shop || shop.organizationId !== organizationId) {
		throw new ConvexError({ code: "NOT_FOUND", message: "Shop not found in this organization" });
	}
}

/** Rejects a non-positive number for a field that's nonsensical at zero or below (validityDays, durationDays, pointsPerUnit, price, etc.). */
export function assertPositive(value: number, fieldName: string): void {
	if (!(value > 0)) {
		throw new ConvexError({ code: "INVALID_INPUT", message: `${fieldName} must be greater than zero` });
	}
}

/** Rejects a negative number for a field that must be zero or more (tier level, point multipliers). */
export function assertNonNegative(value: number, fieldName: string): void {
	if (value < 0) {
		throw new ConvexError({ code: "INVALID_INPUT", message: `${fieldName} must not be negative` });
	}
}
