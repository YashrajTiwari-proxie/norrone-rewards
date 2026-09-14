import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import authConfig from "./auth.config";
import authSchema from "./betterAuth/schema";
import { trustedAuthz, PLATFORM_TENANT_ID } from "./authzConfig";
import { trustedOrigins } from "./lib/trustedOrigins";

const siteUrl = process.env.SITE_URL ?? "http://127.0.0.1:5173";

type AuthComponent = ReturnType<typeof createClient<DataModel, typeof authSchema>>;

// There is only one account type in this app — every Better Auth user is
// staff, either at one or more organizations or on the platform-admin
// sentinel tenant (or both). Which is decided entirely by authz role
// assignments (see authzConfig.ts), never by a field stamped on the user
// record — unlike admin-panel-v2's staffAccountPlugin, which had to
// distinguish staff from a *second* end-customer account type that
// Norrone has no equivalent of.
export const authComponent: AuthComponent = createClient<DataModel, typeof authSchema>(components.betterAuth, {
	local: {
		schema: authSchema
	},
	// Best-effort cleanup only: if a Better Auth user is ever deleted,
	// drop every organizationStaff/platformAdmins listing row for them and
	// revoke their authz role in each of those tenants, so a stale row
	// never outlives the account it displays. organizationStaff's by_user
	// index is what makes "every org this person is staff at" answerable
	// at all — authz itself has no such cross-tenant listing query (see
	// schema.ts's file-level comment).
	triggers: {
		user: {
			onDelete: async (ctx, doc) => {
				const memberships = await ctx.db
					.query("organizationStaff")
					.withIndex("by_user", (q) => q.eq("authUserId", doc._id))
					.collect();
				for (const membership of memberships) {
					await trustedAuthz.withTenant(membership.organizationId).offboardUser(ctx, doc._id);
					await ctx.db.delete(membership._id);
				}
				const platformRow = await ctx.db
					.query("platformAdmins")
					.withIndex("by_user", (q) => q.eq("authUserId", doc._id))
					.unique();
				if (platformRow) {
					await trustedAuthz.withTenant(PLATFORM_TENANT_ID).offboardUser(ctx, doc._id);
					await ctx.db.delete(platformRow._id);
				}
			}
		}
	},
	authFunctions: {
		onCreate: internal.authTriggers.onCreate,
		onUpdate: internal.authTriggers.onUpdate,
		onDelete: internal.authTriggers.onDelete
	}
});

export const createAuthOptions = (ctx: GenericCtx<DataModel>): BetterAuthOptions => ({
	baseURL: siteUrl,
	secret: process.env.BETTER_AUTH_SECRET ?? "dev-secret-not-for-production",
	trustedOrigins,
	advanced: {
		useSecureCookies: siteUrl.startsWith("https://"),
		ipAddress: {
			ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"]
		}
	},
	emailAndPassword: {
		enabled: true
	},
	plugins: [convex({ authConfig })]
});

export const createAuth = (ctx: GenericCtx<DataModel>) =>
	betterAuth({
		database: authComponent.adapter(ctx),
		...createAuthOptions(ctx)
	});
