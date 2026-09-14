import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { createAuthMiddleware, APIError } from "better-auth/api";
import type { GenericActionCtx } from "convex/server";
import { isRateLimitError } from "@convex-dev/rate-limiter";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import authConfig from "./auth.config";
import authSchema from "./betterAuth/schema";
import { trustedAuthz, PLATFORM_TENANT_ID } from "./authzConfig";
import { trustedOrigins } from "./lib/trustedOrigins";
import { rateLimiter } from "./lib/rateLimit";

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
	// Better Auth ships its own IP+path-keyed rate limiter (a hardcoded
	// 3-attempts/10s rule on /sign-in/*, /sign-up/*, /change-password,
	// /change-email even before this config exists), but it defaults to
	// in-memory storage — which is a no-op across Convex's serverless
	// function invocations, since there's no shared process to hold state
	// in. `storage: "database"` is what actually makes it work here; this
	// was simply never turned on before a security-safety follow-up caught
	// it (see docs/AUDIT.md). window/max below are the *general* bucket
	// every other Better Auth route falls back to (get-session, sign-out,
	// ...) — generous on purpose, since none of those are credential-
	// guessing surfaces.
	rateLimit: {
		enabled: true,
		storage: "database",
		window: 10,
		max: 100
	},
	// Complements the IP-based limiter above with an account-keyed check
	// (convex/lib/rateLimit.ts's accountSignInAttempt bucket): the IP rule
	// alone can't catch a distributed attacker rotating source IPs against
	// one known email. Only runs on the actual sign-in path — every other
	// request returns immediately.
	hooks: {
		before: createAuthMiddleware(async (hookCtx) => {
			if (hookCtx.path !== "/sign-in/email") return;
			const email = (hookCtx.body as { email?: string } | undefined)?.email?.toLowerCase();
			if (!email) return;
			try {
				await rateLimiter.limit(ctx as GenericActionCtx<DataModel>, "accountSignInAttempt", {
					key: email,
					throws: true
				});
			} catch (err) {
				if (isRateLimitError(err)) {
					throw new APIError("TOO_MANY_REQUESTS", {
						code: "ACCOUNT_LOCKED",
						message: "Too many sign-in attempts for this account — please wait and try again."
					});
				}
				// Any other error here is the limiter's own (e.g. an OCC
				// conflict on its counter document under concurrent
				// sign-ins — see rateLimit.ts's `shards` comment); fail
				// open rather than blocking a legitimate sign-in because
				// of a rate-limiter-internal hiccup.
				console.error("Sign-in rate limiter error — failing open", err);
			}
		})
	},
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
