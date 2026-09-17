# Security & Correctness Audit — 2026-09-11 (updated 2026-09-14: rate limiting; updated 2026-09-17: wallet subsystem + recent mutations)

Performed after the full Supabase → Convex migration, covering every `convex/*.ts`
file: tenant isolation, the public API's auth boundary, permission coverage, input
validation, CORS, and idempotency/data-integrity edges. This is a point-in-time
record — re-run the same checklist after any future change that adds a new
org-scoped query/mutation or touches `convex/lib/authz.ts`.

## Update — 2026-09-17: wallet subsystem + all mutations added since the last pass

Covers everything built since 2026-09-14 that the pass above never saw: the full
Apple/Google Wallet pipeline (`convex/wallet.ts`, `walletNode.ts`, `httpWallet.ts`,
`httpPassService.ts`, `passRegistrations.ts`, `lib/wallet/*`, `passTemplates.ts`, the
`src/routes/v1/[...path]` reverse proxy), plus `membershipPlans.remove`'s cascade fix,
`devTools.ts`'s two newest repair functions, and the `passTemplates` schema additions.

### 🔴 Critical — found and requires your action (not something I can safely fix myself)

**`Norrone-Testing-Guide.pdf`, committed to git and pushed to the remote GitHub repo,
contains the real platform-admin and org-owner passwords in plaintext** (confirmed by
extracting and decompressing the PDF's own content streams — the strings
`Admin@123`/`admin@mail.com` are present in the file at `HEAD`, not just in an old
commit). `README.md`'s "Test accounts" table documents the same two demo credentials
too, but at least frames them explicitly as non-production seed data; the PDF was
built specifically for external tester distribution and ended up in version control
instead of a private share channel. Either way, these credentials grant real
dashboard access to a live, internet-reachable Convex dev deployment — not a
local-only sandbox — so anyone with read access to the GitHub repo (and, since it's
already pushed, potentially anyone who ever clones it, even after a future fix)
already has them.
**This needs a decision only you can make, not a code fix**: (1) rotate both
passwords now (`Admin@123` for `admin@mail.com` and `org@mail.com`) via the app or a
direct Convex mutation, (2) remove the PDF from the repo going forward (`git rm`) and
share future versions through a private channel instead, and (3) decide whether the
exposure warrants rewriting git history to purge it from old commits too (disruptive
for a shared repo — force-pushes rewrite everyone's history — so this is a call for
you, not something to do unilaterally). I have not modified or removed anything here.

### 🟠 Medium — fixed

**Every `orgStaffAction`-based endpoint silently skipped the active-staff check.**
`lib/authz.ts`'s `orgStaffAction` checked the authz permission grant but — unlike
`orgStaffQuery`/`orgStaffMutation` — never verified the caller is still an *active*
`organizationStaff` row (its own comment said so explicitly: actions have no direct
`ctx.db`, and no internalQuery hop had been added yet). `staff.invite` had already
worked around this ad hoc with its own `assertActorActiveStaff` internalQuery, but the
two newer action-based endpoints — `passTemplates.saveGoogle` and
`wallet.getPassLinkToken` — had not. Not exploitable today (nothing in the codebase
ever sets `organizationStaff.isActive: false` yet — there's no "remove staff" feature
built), but the instant one ships and does the natural, minimal thing (flip
`isActive`), a removed staff member would retain the ability to rewrite an org's
Google Wallet branding and mint wallet-pass links for any of that org's customers
indefinitely.
**Fix**: moved the check into `orgStaffAction` itself (`assertActiveOrgStaffQuery`, a
new internalQuery reached via `ctx.runQuery` since actions have no `ctx.db`) so every
current and future action-based endpoint is covered automatically, rather than
requiring each one to remember to add it. Removed `staff.ts`'s now-redundant duplicate
check. Verified: `bun run check` clean, Convex push succeeded (confirming
`internal.lib.authz.assertActiveOrgStaffQuery` resolves correctly through codegen —
the first internal Convex function ever defined directly inside `lib/authz.ts`), full
test suite still green.

### 🟢 Verified safe — wallet subsystem (no fix needed)

- **Token crypto** (`lib/walletSigning.ts`): real HMAC-SHA256 with `WALLET_SIGNING_SECRET`,
  timing-safe comparison, `signWalletToken` (dashboard "Add to Wallet" links) expires
  in 15 minutes; `verifyPassAuthToken` (Apple's own device-to-server protocol) is
  deterministic by design but correctly scoped — it's recomputed per-`serialNumber`,
  so a token valid for one customer's pass fails verification against any other
  customer's serial number.
- **IDOR**: `getPassLinkToken`/`saveApple`/`saveGoogle` all derive the organization
  from the verified session (`ctx.organizationId`), never a client-supplied value;
  `getPassLinkToken` additionally checks `customer.organizationId !== ctx.organizationId`
  before issuing a token.
- **Apple's PassKit Web Service protocol** (`httpPassService.ts`): `registerDevice`/
  `unregisterDevice`/`getLatestPass` all correctly gate on `verifyPassAuthToken`.
  `listUpdatablePasses` is intentionally unauthenticated — that's Apple's own spec,
  not a gap introduced here (every real-world PassKit server implementation works
  this way).
- **SSRF**: `walletNode.ts`'s `fetch(passData.logoUrl)`/`fetch(passData.bannerUrl)`
  only ever receive Convex-storage-generated URLs — `logoStorageId`/`bannerStorageId`
  are strictly `v.id("_storage")` end-to-end from upload to fetch, no path for an
  attacker-supplied arbitrary URL to reach either call.
- **Secret handling**: Apple/Google credentials are read only from `process.env`
  inside Convex functions, never returned to a client response; no log call in
  `apns.ts`/`googlePass.ts` prints private key material, only response status/body.
- **The reverse proxy** (`src/routes/v1/[...path]/+server.ts`): target is a fixed
  `${PUBLIC_CONVEX_SITE_URL}/v1/...` base with the client-supplied segment only ever
  appended as a path component, never as a scheme/host — not usable as an open proxy
  to arbitrary hosts.
- **Route ordering** (`http.ts`): all wallet routes are more-specific prefixes than
  the general `/v1/` handlers; confirmed no shadowing.
- **`membershipPlans.remove`'s cascade fix**: the `plan.organizationId !== ctx.organizationId`
  ownership check runs before the cascade logic, so a foreign `planId` can never reach
  the `customerMemberships` cancellation loop — the subsequent query, filtered by that
  exact (now ownership-confirmed) `planId`, can only ever match this org's own rows.
- **`passTemplates.ts`'s full restructure**: every export correctly wrapped
  (`orgStaffQuery`/`orgStaffMutation`/`orgStaffAction` for client-facing, `internal*`
  for the rest); `organizationId` sourced from `ctx.organizationId` everywhere, never
  a client argument.
- **`devTools.ts`'s two newest repair functions** (`repairMissingAuthzGrants`,
  `repairOrphanedMemberships`): both `internalMutation`, unreachable from any client.
- **`schema.ts`'s new `passTemplates` fields**: all correctly `v.optional(...)` with
  matching types, nothing loosely typed.
- **`customerGrants.ts`'s `manualGrantTier` fix**: the pre-existing cross-tenant
  `tier.organizationId !== customer.organizationId` guard is untouched by the
  no-op-comparison fix.

### 🟡 Low — accepted, not changed (new this pass)

- **No rate limiting on the wallet token endpoints** (`/v1/wallet/apple/:token`,
  `/v1/wallet/google/:token`) or Apple's PassKit protocol surface, unlike
  `httpApiV1.ts`'s keyed `apiRequest` limiter. Low risk — forging a valid token needs
  `WALLET_SIGNING_SECRET`, and Apple's polling endpoint is unauthenticated by spec
  regardless — but an attacker could still cheaply hammer token verification as a
  minor DoS vector. Worth a lightweight IP-based limiter if this becomes a target.
- **`passTemplates.saveApple`/`saveGoogle`'s `logoStorageId`/`bannerStorageId` args
  accept any `v.id("_storage")` with no check that the calling org actually owns that
  storage object** — Convex storage IDs are global, not org-scoped, so a staff member
  who somehow obtained another org's storage ID could reference it here. Low severity:
  storage IDs aren't guessable or enumerable through any exposed endpoint.

## Findings & resolutions

### 🔴 Critical — fixed

**Cross-tenant analytics leak in `dashboard.getOverview`.** It was a plain `query`
gated only by `requireAuthUserId` (proves you're *signed in*, not that you're staff of
the requested org) — any authenticated user could pass an arbitrary `organizationId`
and read that organization's full customer count, active-member count, all-time
points issued, tier distribution, coupon status breakdown, recent issued-coupon
codes/discount values, and program-setup flags. Every other org-scoped query in the
codebase (`customers.ts`, `tiers.ts`, `coupons.ts`, etc.) correctly used the
`orgStaffQuery` wrapper, which additionally checks active `organizationStaff`
membership and the `authz` permission for that specific org — this was the one query
that fell through the pattern.

**Fix**: switched to `orgStaffQuery("customers:read")`, matching the codebase-wide
convention. Verified live: the legitimate dashboard overview still renders correctly
for a real staff member post-fix (screenshot-verified), and the fix is structurally
identical to a dozen other functions already verified (via UI clicking and the
[loyaltyEngine tests](../convex/lib/loyaltyEngine.test.ts)) to correctly reject
cross-org access.

### 🟠 Medium — fixed

**Unvalidated cross-org `shopId` foreign keys.** `tiers.create`/`update`,
`pointRules.create`/`update`, `rewards.create`/`update`, `coupons.create`/`update`,
`membershipPlans.create`/`update`, and `apiKeys.create` all accepted an optional
`shopId` (to scope a record to one shop instead of "all shops") without checking that
shop belongs to the caller's own organization. A staff member could pass another
org's `shopId` and permanently attach their own org's tier/coupon/etc. to a foreign
shop. Not itself a cross-tenant *read* (every consumer of these records still derives
its actual tenant from `organizationId`, never from the shop — `evaluateAndGrant`'s
shop filter would just never match a foreign shop, making the record an inert
orphan), but a real data-integrity gap, and it would display a wrong `scopeName` in
the org's own UI.

**Fix**: added `assertShopInOrg(ctx, shopId, organizationId)` to `convex/lib/authz.ts`
and call it from every affected `create`/`update` mutation.

**No CORS handling on the public `/v1/...` API.** The API Keys dashboard page
explicitly markets a "Publishable — read-only, safe client-side" key type, implying a
storefront's browser JS should be able to call `GET /v1/shops/:shopId/offers` etc.
directly — but with zero `Access-Control-Allow-Origin` headers and no `OPTIONS`
route, any cross-origin browser fetch would have its response silently blocked by the
browser regardless of a valid key (missing CORS is the fail-*closed* default, so this
was never an exploitable hole — just a feature that silently didn't work as
documented).

**Fix**: added `Access-Control-Allow-Origin: *` (safe here — this is bearer-key
authenticated public/per-org data, never cookie-authenticated, so there's no
confused-deputy risk `*` would introduce for a session-cookie API) to every `/v1/...`
JSON response, plus a dedicated `OPTIONS` preflight route in `convex/http.ts`.

**No positive/non-negative validation on business-critical numeric fields.**
`couponDefinitions.validityDays`/`discountValue`, `membershipPlans.durationDays`/
`price`, `pointRules.pointsPerUnit`, and `tiers.level`/`pointMultiplier` all accepted
any number, including zero or negative, with only client-side `<input type="number">`
as a backstop. A `validityDays: 0` or negative coupon type would issue
already-expired coupons (`expiresAt = Date.now() + validityDays * DAY_MS`); same for a
non-positive `durationDays` membership plan.

**Fix**: added `assertPositive`/`assertNonNegative` helpers to `convex/lib/authz.ts`,
applied to `coupons.ts`, `membershipPlans.ts`, `pointRules.ts`, and `tiers.ts`'s
`create`/`update` mutations.

### 🟠 Medium — fixed (2026-09-14 follow-up)

**No rate limiting anywhere.** Neither the public `/v1/...` API nor Better Auth
sign-in had any throttling at all — `docs/API.md` said so explicitly, and
`convex/auth.ts` never set a `rateLimit` block, so Better Auth's own built-in
brute-force limiter (a hardcoded 3-attempts/10s rule on `/sign-in/*` etc.) was never
actually turned on — it defaults to in-memory storage, which is a no-op across
Convex's serverless invocations.

**Fix**: added `@convex-dev/rate-limiter` (`convex/lib/rateLimit.ts`) with two token
buckets — `apiRequest` (120/min, burst 200, keyed per API key hash) enforced in
`httpApiV1.ts`'s `requireApiKey`, and `accountSignInAttempt` (5 per 5 min, keyed per
email) enforced in `auth.ts`'s `hooks.before` for `/sign-in/email`, complementing
Better Auth's own now-enabled IP-based limiter (`rateLimit: { enabled: true, storage:
"database", window: 10, max: 100 }` — `storage: "database"` is what makes it actually
work in Convex, vs. the silently-broken in-memory default).

**Bug found while implementing this, fixed same session**: under genuine concurrency
on one key (verified live — 40 truly parallel requests against the same API key), the
rate limiter's own counter document hit a write conflict that crashed the request
with an uncaught `500` instead of a clean `429`. Root cause: a `ctx.runMutation` call
made from *inside* an `httpAction` is not automatically retried by Convex the way a
top-level mutation invocation is — so a conflict there propagates as an error instead
of transparently retrying. Fixed two ways: (1) `shards: 10` on the `apiRequest` bucket
(and `shards: 3` on `accountSignInAttempt`) spreads one key's counter across multiple
documents, making a same-millisecond conflict rare for real traffic; (2) both call
sites now fail *open* (log and let the request through) if the limiter itself throws
an unexpected error, rather than the limiter becoming a way to take the API/login
down. Re-verified live: 40-way true concurrency on one key → all `200`, zero crashes;
a 250-request burst against the 200-capacity bucket → 210 succeeded (some tokens
refilled mid-burst at the 120/min sustained rate) and 40 correctly got `429`, still
zero crashes.

**Second bug found while shipping this, fixed same session**: enabling Better Auth's
own built-in rate limiter with `storage: "database"` requires a `rateLimit` table to
exist in the Better Auth component's own schema (`convex/betterAuth/generatedSchema.ts`)
— that schema had been generated once, before this option was ever added, and was never
regenerated afterward. The mismatch didn't surface at deploy time or in
`bun run check` (the schema file itself was still perfectly valid, just missing one
table) — it only broke at request time, with every sign-in attempt failing with
`ArgumentValidationError: ... Path: .model, Value: "rateLimit"`, i.e. **login itself
was broken** for the entire time between enabling the option and this fix. Caught
immediately by testing the actual login flow live rather than trusting the type-check
and unit-test suite alone — neither one could have caught this, since the mismatch is
between a runtime config value and a component's generated schema, not something
either kind of check inspects. **Fix**: re-ran
`npx @better-auth/cli generate --config convex/betterAuth/auth.ts --output convex/betterAuth/generatedSchema.ts -y`,
which added the missing `rateLimit` table; re-verified by actually logging in through
the browser afterward, not just re-running the test suite. **Takeaway for next time**:
any change to Better Auth options that affects its own storage requirements (this
rate limiter, but the same class of issue would apply to e.g. adding a plugin that
needs its own table) needs a schema regeneration in the same change, and a live
login attempt is the only check that actually proves it.

### 🟡 Low — accepted, not changed

- **`deltaSpend`/`deltaVisits` can drive a customer's totals negative** via repeated
  or large negative adjustments (`convex/lib/loyaltyEngine.ts`). This exactly matches
  the original Postgres function's behavior (no floor there either) — a faithful port
  of a pre-existing product decision, not a migration regression. Left as-is; flagging
  here in case a floor is ever wanted going forward.
- **Email-enumeration via staff/admin "add" flows.** `staff.invite` and
  `platformAdmins.addAdmin` return a distinguishable `NO_ACCOUNT` error, letting an org
  owner learn whether an arbitrary email has an account on this deployment. This is
  inherent to the documented "no invite-email provider yet, look up by email instead"
  design (see README's "Known gaps") — accepted as a known, low-severity tradeoff of
  that design, not something to silently patch by making the error vaguer (that would
  make the legitimate "why didn't this work" case harder to debug for staff).
- **`rewards.ts`'s per-reward grant count does an unindexed full-table scan**
  (`customerRewards` has no index usable for "all grants of reward X" without a
  customerId). Same shape of accepted tradeoff as the already-documented N+1 queries
  in `dashboard.ts`/`customers.ts` — fine at current scale.

### ℹ️ Informational

- `orgStaffAction`/`platformAction` in `lib/authz.ts` are defined but never called
  anywhere; their own comment already documents they intentionally skip the
  active-staff check (no `internalQuery` hop built yet). Dead code, not a bug — left
  in place since a future action-based endpoint will need exactly this.
- `tiers.level` has no uniqueness constraint (two tiers can share a level) — only
  affects display sort order; `evaluateAndGrant` never depends on level uniqueness.
- Schema indexing is otherwise clean. Two missing `by_organization` indexes
  (`eligibilityConditions`, `grantedBenefits` — needed for the admin panel's
  cascade-delete) were found and fixed during the original admin-panel build, not
  this audit pass; no further missing indexes found.
- `customerGrants.ts`'s six manual-grant mutations are plain `mutation`, not wrapped
  by `orgStaffMutation` — but each independently re-derives and checks the customer's
  `organizationId` before any authz check, which is functionally equivalent to the
  guarded factories. Not a gap, just a different (slightly more verbose) way of
  arriving at the same tenant check.

## Bug found while writing the stress test (test tooling, not product code)

`scripts/stress-test.ts`'s coupon-redeem race check initially generated its test code
as `` `RACE${Date.now()}`.slice(0, 10) `` — since every `Date.now()` call today shares
the same leading digits (all timestamps start `1789...`), this silently produced the
*same* 10-character code on every run within the session instead of a fresh one,
causing `couponInstances` to accumulate multiple rows with an identical `code` and
reproducing the exact `unique() query returned more than one result` crash that the
`generateCouponCode()` collision-retry fix (see the loyalty-engine port) was written
to prevent in real usage — this was the test script re-triggering the same bug class
in its own fixture generation, not a product regression. Fixed by generating the test
code with real randomness (`Math.random().toString(36)...`) instead of truncating a
timestamp. Serves as a good demonstration of exactly the failure mode
`generateCouponCode()` guards against in production: a "unique-looking" but actually
collision-prone code generator crashes `redeemCoupon`'s `.unique()` lookup outright
rather than degrading gracefully.

## Test coverage added this pass

- `convex/lib/loyaltyEngine.test.ts` — 22 tests: idempotency (points, membership),
  the vacuous-grant guard, tier/reward/coupon auto-grant thresholds and shop/
  member-only scoping, the documented multiplier-vs-membership-expiry asymmetry,
  coupon uniqueness/collision retry, and `redeemCoupon`'s full status-transition and
  cross-tenant-isolation matrix.
- `convex/apiInternal.test.ts` — 5 tests: customer creation + duplicate-`externalId`
  conflict (including that the same `externalId` is fine across two different shops),
  and full customer-view serialization (points/tier/membership/rewards/coupons
  aggregation).
- `scripts/stress-test.ts` — live concurrency smoke test against a real deployment
  (not the in-memory test backend): fired 20 concurrent identical requests at each of
  three race-prone paths and confirmed Convex's OCC resolves each to exactly one
  winner — idempotent point updates, duplicate customer creation, and coupon
  redemption — plus a 50-request throughput burst. All three race checks passed with
  zero double-application on every run performed.

Run `bun run test:unit` and `bun run stress-test` to re-verify.
