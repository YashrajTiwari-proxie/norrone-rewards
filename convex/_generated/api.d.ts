/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as adminOrganizations from "../adminOrganizations.js";
import type * as apiInternal from "../apiInternal.js";
import type * as apiKeys from "../apiKeys.js";
import type * as auth from "../auth.js";
import type * as authTriggers from "../authTriggers.js";
import type * as authzConfig from "../authzConfig.js";
import type * as coupons from "../coupons.js";
import type * as customerGrants from "../customerGrants.js";
import type * as customers from "../customers.js";
import type * as dashboard from "../dashboard.js";
import type * as devTools from "../devTools.js";
import type * as engine from "../engine.js";
import type * as http from "../http.js";
import type * as httpApiV1 from "../httpApiV1.js";
import type * as lib_apiKeys from "../lib/apiKeys.js";
import type * as lib_authz from "../lib/authz.js";
import type * as lib_couponSigning from "../lib/couponSigning.js";
import type * as lib_loyaltyEngine from "../lib/loyaltyEngine.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as lib_trustedOrigins from "../lib/trustedOrigins.js";
import type * as membershipPlans from "../membershipPlans.js";
import type * as organizations from "../organizations.js";
import type * as platformAdmins from "../platformAdmins.js";
import type * as pointRules from "../pointRules.js";
import type * as regions from "../regions.js";
import type * as rewards from "../rewards.js";
import type * as shops from "../shops.js";
import type * as staff from "../staff.js";
import type * as tiers from "../tiers.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  adminOrganizations: typeof adminOrganizations;
  apiInternal: typeof apiInternal;
  apiKeys: typeof apiKeys;
  auth: typeof auth;
  authTriggers: typeof authTriggers;
  authzConfig: typeof authzConfig;
  coupons: typeof coupons;
  customerGrants: typeof customerGrants;
  customers: typeof customers;
  dashboard: typeof dashboard;
  devTools: typeof devTools;
  engine: typeof engine;
  http: typeof http;
  httpApiV1: typeof httpApiV1;
  "lib/apiKeys": typeof lib_apiKeys;
  "lib/authz": typeof lib_authz;
  "lib/couponSigning": typeof lib_couponSigning;
  "lib/loyaltyEngine": typeof lib_loyaltyEngine;
  "lib/rateLimit": typeof lib_rateLimit;
  "lib/trustedOrigins": typeof lib_trustedOrigins;
  membershipPlans: typeof membershipPlans;
  organizations: typeof organizations;
  platformAdmins: typeof platformAdmins;
  pointRules: typeof pointRules;
  regions: typeof regions;
  rewards: typeof rewards;
  shops: typeof shops;
  staff: typeof staff;
  tiers: typeof tiers;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("../betterAuth/_generated/component.js").ComponentApi<"betterAuth">;
  authz: import("@proxie-studio/authz-tenant-kit/_generated/component.js").ComponentApi<"authz">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
