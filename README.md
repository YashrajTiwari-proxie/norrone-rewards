# Norrone Rewards

A multi-tenant customer loyalty platform. An **organization** (a restaurant chain) runs
one or more **shops**. Organization staff manage the program through a SvelteKit
dashboard; the organization's own website/POS integrates headlessly via a public API
(secret/publishable keys). There is no end-customer login of any kind — customers only
ever interact through Apple/Google Wallet passes (paused, see below) and the
organization's own site.

Full functional spec: `CLAUDE_CODE_BUILD_SPEC_V2_SUPABASE.md`, kept locally alongside
this repo but **not committed** (see `.gitignore`) — ask whoever has it if you don't.
It's the original Supabase-era spec and still the source of truth for *business*
behavior; the backend itself has since migrated to Convex, described below.
Public API reference: [`docs/API.md`](./docs/API.md).
Example API client: [`examples/api-client.ts`](./examples/api-client.ts).
Security/correctness audit: [`docs/AUDIT.md`](./docs/AUDIT.md).

## Tech stack

- **SvelteKit** (Svelte 5) + TypeScript, package manager: **bun**
- **Convex** — the entire backend: database, business logic (mutations/queries), and
  the public `/v1/...` API (as Convex HTTP Actions). No separate server, no queue, no
  cron — everything runs transactionally inside Convex functions.
- **Better Auth**, running as a Convex component (`@convex-dev/better-auth`) — the one
  human-facing auth system, proxied through this app's own `/api/auth/*` so the session
  cookie stays first-party (see `src/hooks.server.ts`). There's a single account type:
  every signed-in user is "staff" somewhere, either at one or more organizations or on
  the platform-admin sentinel tenant (or both) — which is decided entirely by role
  assignments, never a field on the account.
- **`@proxie-studio/authz-tenant-kit`** (vendored in `packages/`), a Zanzibar-style
  multi-tenant RBAC Convex component — tenant isolation and role storage live here, not
  in hand-rolled tables. Platform-admin permissions are modeled as a sentinel tenant
  (`__platform__`, see `convex/authzConfig.ts`) rather than a special-cased global role,
  since the component has no native cross-tenant concept.
- The public headless API is authenticated separately, by API key (`convex/apiKeys.ts`,
  hashed at rest) — not by a Better Auth session. See `docs/API.md`.

### Why Convex (and what changed from the original Supabase build)

This app was originally built on Supabase (Postgres + RLS + Supabase Auth) — that build
is preserved for reference under `supabase/migrations/`, but is no longer live. The
migration to Convex was driven by wanting transactional mutations as first-class
primitives (rather than hand-rolled Postgres functions called from SvelteKit
`+server.ts` routes) and a cleaner story for the multiple concurrent write paths a
loyalty program accumulates (dashboard actions, the public API, future integrations).
The core business logic (`convex/lib/loyaltyEngine.ts`) is a line-for-line port of the
original `supabase/migrations/*.sql` plpgsql functions — see that file's own comments
for the mapping. Tenant isolation moved from Postgres RLS to per-request checks in
Convex query/mutation wrappers (`convex/lib/authz.ts`) backed by authz-tenant-kit.

## Getting started

```sh
bun install                  # also builds the two vendored packages/ (postinstall)
npx convex dev                # links to (or creates) a Convex deployment, writes .env.local
cp .env.example .env          # fill in WALLET_SIGNING_SECRET (see below); Convex vars live in .env.local
bun run dev                   # http://localhost:5173 — requires `npx convex dev` running alongside
```

Useful scripts:

```sh
bun run dev         # start the SvelteKit dev server
bun run check        # svelte-check + type-check (frontend AND convex/**)
bun run test:unit    # vitest — Convex function tests against an in-memory backend (convex-test)
bun run test:e2e     # Playwright
bun run build        # production build
npx convex dev       # start Convex's own dev loop (push functions on save, tail logs)
npx convex deploy    # deploy to production (separate prod deployment — set up separately)
bun run stress-test          # concurrency/idempotency smoke test against a live dev deployment
bun run example:api-client   # runnable example of the public /v1 API (see docs/API.md)
```

Run `npx convex dev` in one terminal and `bun run dev` in another — they're independent
processes. `npx convex dev` is also what pushes any Convex function change live and
regenerates `convex/_generated/*`.

### Environment variables

Convex's own connection details (`PUBLIC_CONVEX_URL`, `PUBLIC_CONVEX_SITE_URL`,
`CONVEX_DEPLOYMENT`) are written to `.env.local` automatically by `npx convex dev` — do
not hand-edit them, and don't commit `.env.local` (already gitignored). Everything else
is a **Convex environment variable** (set with `npx convex env set NAME value`, not a
`.env` file the frontend reads), since these are only ever read inside Convex functions:

| Variable | Set with | Used by |
| --- | --- | --- |
| `WALLET_SIGNING_SECRET` | `npx convex env set WALLET_SIGNING_SECRET <openssl rand -hex 32>` | HMAC-signs coupon QR/barcode payloads (`convex/lib/couponSigning.ts`) |
| `BETTER_AUTH_SECRET` | `npx convex env set BETTER_AUTH_SECRET <openssl rand -base64 32>` | Better Auth session signing (`convex/auth.ts`) — falls back to an insecure dev default if unset, **must** be set before any real deployment |
| `SITE_URL` | `npx convex env set SITE_URL http://localhost:5173` (or your real origin) | Better Auth's own `baseURL` + cookie security flag |
| `TRUSTED_ORIGINS` | `npx convex env set TRUSTED_ORIGINS "https://your-dashboard.example"` | Comma-separated extra CORS/cookie origins beyond `localhost:5173` (`convex/lib/trustedOrigins.ts`) |

`.env` (the SvelteKit-side file) only needs `PUBLIC_CONVEX_URL`/`PUBLIC_CONVEX_SITE_URL`
if you're not letting `.env.local` provide them — in practice you usually don't touch
`.env` at all for local dev.

## Bootstrapping a platform admin

There is **no self-serve path** to becoming a platform admin (by design — it's the
highest privilege level on the platform, with cross-tenant read/write access to every
organization). The first one is seeded directly via the Convex CLI, once, by whoever
operates the deployment:

```sh
# 1. Sign up a normal account first at /signup (or /login if it already exists)
# 2. Then, from the CLI:
npx convex run platformAdmins:seedFirstAdmin '{"email":"you@example.com"}'
```

Every platform admin after that is added through the normal in-app flow (an existing
platform admin can't be created any other way either — `platformAdmins.addAdmin` still
requires the target email to already have an account; see the "no email provider" note
below).

## URLs & who logs in where

There is a single sign-in flow (`/login`, backed by Better Auth) shared by organization
staff and platform admins — which dashboard you land in is entirely a function of which
roles you hold, not a separate credential system:

| Area | Entry URL | Who | Notes |
| --- | --- | --- | --- |
| Organization dashboard | `/login` → `/orgs/:orgId` | Anyone with an active `organizationStaff` row | Self-serve org creation at `/signup`; a fresh org's creator is automatically its `owner` |
| Platform admin panel | `/admin/login` → `/admin` | Anyone with an active `platformAdmins` row | Manages **all** organizations, cross-tenant analytics, and the regions list. Same Better Auth account as org staff — `/admin/login` just re-checks platform-admin status and signs back out if it isn't there. |
| Public headless API | `/v1/...` (Convex `.site` domain) | API key holders (POS/website integrations) | See `docs/API.md` |

Once signed in to the org dashboard: `/orgs/:orgId` (Overview) — sidebar covers
Customers, Membership, Tiers, Points, Rewards, Coupons, Shops, API Keys, Wallet Pass
(paused), Staff.

Once signed in to the admin panel: `/admin` (organizations list) — `/admin/orgs/:orgId`
for a single org's detail/analytics/edit/delete, `/admin/regions` for the
supported-countries list.

### Regions (supported countries)

`/admin/regions` is a full CRUD screen for the countries the platform supports — country
name, ISO code, phone code, and default currency (code + symbol). It's platform-admin-only
to write (`convex/regions.ts`'s `create`/`update`/`remove` are `platformMutation`-gated);
`regions.list` is a plain `query` anyone (including the unauthenticated `/signup` page)
can read. This list feeds the country dropdown everywhere an org or shop is registered —
picking a country auto-fills its currency, which stays freely editable per organization
*and per shop* (an org can be an MNC with shops billing in different currencies than HQ).

### Organization & shop business details

Both the admin "Add an organization" flow and the self-serve `/signup` form capture:
phone number, website (optional), address, country (from Regions), currency code,
business registration number, and tax ID (GST/VAT/EIN) — the latter two are free-text and
optional, meant as a starting point for verifying a business exists, not validated against
any specific country's format. Shops carry the same four location/currency fields
independently (pre-filled from the org's values when you add a shop, but fully
editable afterward per shop) via the Shops page in the org dashboard.

### Known gaps

- **No transactional email provider is wired up.** This affects three flows, all of
  which degrade to an honest error message rather than silently failing:
  `/forgot-password` (placeholder page), staff "Add someone" (`convex/staff.ts` —
  only works if the invitee already has an account), and platform admin "add admin"
  (same constraint). Wiring up Resend/Postmark/etc. is a separate, not-yet-scheduled
  decision.
- **Wallet passes (Apple/Google) are paused** pending real Apple/Google developer
  credentials — the org dashboard's Wallet Pass page is an explicit placeholder, and no
  wallet-pass Convex functions exist yet. The Supabase-era stub
  (`src/lib/server/walletPass.ts`, no longer used) is preserved for reference only.
- **No rollback if self-serve signup's second step fails.** `/signup` creates the
  Better Auth account first, then calls `organizations.createSelfServe` — if that
  mutation fails after the account exists, the user is left with a login but no
  organization (surfaced as an explicit error message telling them to sign in and
  retry, not a silent failure).
- A handful of admin/dashboard read queries (`dashboard.getOverview`,
  `customers.list`/`getDetail`, `adminOrganizations.list`/`get`) loop per-customer doing
  several sub-queries each (N+1) rather than a single aggregate query — fine at
  dev/small-org scale, would need batching before a single organization has thousands
  of customers.
- Nothing listed in the original build spec's §8 (out of scope for v1 — referrals,
  leaderboards, tokens, analytics/reporting beyond what's in the dashboard,
  physical-reward inventory) has been built.

## Testing

- **`bun run test:unit`** — Convex function tests (`convex/**/*.test.ts`) using
  [convex-test](https://www.npmjs.com/package/convex-test): a real in-memory Convex
  backend (real schema, real indexes, real transaction semantics), no network, no
  components registered (the tests under test don't touch authz-tenant-kit or
  Better Auth directly). Covers the loyalty engine's business logic — auto-grant
  thresholds, the vacuous-grant guard, idempotency, multiplier stacking rules, coupon
  uniqueness/collision handling, redeem tenant isolation — and the public API's
  customer-creation/serialization path.
- **`bun run stress-test`** (`scripts/stress-test.ts`) — a concurrency smoke test against a *live* dev
  deployment (not the in-memory test backend — this specifically exercises Convex's
  real optimistic-concurrency-control under real network timing). Fires N concurrent
  identical requests at three race-prone paths (idempotent point updates, duplicate
  customer creation, coupon redemption) and asserts each resolves exactly once, plus
  reports latency percentiles for a burst of distinct creates. Safe to re-run — it
  seeds its own fresh fixtures every time via `devTools.ts`. Set `CONCURRENCY=`/
  `BURST_SIZE=` env vars to scale it up.
- **`bun run test:e2e`** — Playwright, browser-level.

`convex/devTools.ts` holds internal-only seeding/cleanup helpers used by the stress
test and by manual `npx convex run` testing during development — never reachable from
the client, and not meant to be called against a production deployment.

## Project layout

```
convex/
  schema.ts                Full data model — organizations, shops, customers, tiers,
                            points, rewards, coupons, membership, api keys, wallet
                            (schema only — passes not implemented), platform tables
  auth.ts, auth.config.ts, http.ts, betterAuth/   Better Auth component wiring
  authzConfig.ts            Permissions/roles + the __platform__ sentinel tenant
  lib/authz.ts               orgStaff*/shopStaff*/platform* query & mutation factories —
                              the one place tenant checks live for staff-facing functions
  lib/loyaltyEngine.ts        The ported business logic: evaluate_and_grant,
                              update_customer_stats, enroll_membership, redeem_coupon,
                              apply_granted_benefits — see its own header comment
  lib/apiKeys.ts, lib/couponSigning.ts   Web-Crypto ports of the old node:crypto helpers
  apiInternal.ts, engine.ts, httpApiV1.ts   Public /v1 API: internal query/mutation
                              layer + HTTP Action route handlers (see docs/API.md)
  organizations.ts, shops.ts, customers.ts, tiers.ts, pointRules.ts, rewards.ts,
  coupons.ts, membershipPlans.ts, customerGrants.ts, staff.ts, apiKeys.ts   Org
                              dashboard CRUD + staff-facing manual grant actions
  adminOrganizations.ts, platformAdmins.ts, regions.ts   Platform admin panel backend
  devTools.ts                Internal-only test/dev fixture seeding — never public
  *.test.ts                  Vitest + convex-test unit tests

src/routes/
  login/, forgot-password/, signup/       Public, unauthenticated (Better Auth client-side)
  admin/login/, admin/(dashboard)/        Platform admin auth + panel (guarded layout)
  orgs/[orgId]/                           Org dashboard (guarded layout, Convex-reactive)

src/lib/
  platformAuth.ts             Svelte context wiring for the Better Auth + Convex client
  components/                 Shared dashboard UI (Sidebar, Drawer, StatTicket, TierStamp,
                               ConditionBuilder, GrantBuilder, etc.)

packages/
  authz-tenant-kit/            Vendored Zanzibar-style RBAC Convex component
  better-auth-tenant-kit/      Vendored Better Auth + Convex + SvelteKit glue

scripts/stress-test.ts        Concurrency smoke test against a live deployment
examples/api-client.ts        Runnable example of the public /v1 API from Node/Bun
docs/API.md                   Public API reference
docs/AUDIT.md                  Security/correctness audit + fixes applied

supabase/migrations/           PRESERVED FOR REFERENCE ONLY — the original Postgres
                                schema/business-logic this app migrated from. Not live.
src/lib/server/                PRESERVED FOR REFERENCE ONLY — the old Supabase-era
                                server helpers (apiAuth, coupon signing, wallet pass
                                stubs). No longer imported by any route.
```

## Current status

Every dashboard page, the public `/v1/...` API, and the platform admin panel are live
on Convex and covered by the tests above. See "Known gaps" for what's explicitly not
done yet (email delivery, wallet passes).
