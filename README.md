# Norrone Rewards

A multi-tenant customer loyalty platform. An **organization** (a restaurant chain) runs
one or more **shops**. Organization staff manage the program through a SvelteKit
dashboard; the organization's own website/POS integrates headlessly via a public API
(secret/publishable keys). There is no end-customer login of any kind — customers only
ever interact through Apple/Google Wallet passes (built, pending real credentials — see below) and the
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
- Rate limiting via `@convex-dev/rate-limiter` (`convex/lib/rateLimit.ts`): a per-API-key
  token bucket on the public API, a per-account bucket on sign-in complementing Better
  Auth's own IP-based limiter. See `docs/API.md`'s "Rate limits" and `docs/AUDIT.md`.

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
| `WALLET_SIGNING_SECRET` | `npx convex env set WALLET_SIGNING_SECRET <openssl rand -hex 32>` | HMAC-signs coupon QR/barcode payloads (`convex/lib/couponSigning.ts`) and wallet-pass links (`convex/lib/walletSigning.ts`) |
| `BETTER_AUTH_SECRET` | `npx convex env set BETTER_AUTH_SECRET <openssl rand -base64 32>` | Better Auth session signing (`convex/auth.ts`) — falls back to an insecure dev default if unset, **must** be set before any real deployment |
| `SITE_URL` | `npx convex env set SITE_URL http://localhost:5173` (or your real origin) | Better Auth's own `baseURL` + cookie security flag, the login link in staff invite emails, **and** the Apple Wallet `webServiceURL` (see "Apple Wallet auto-update requires the Vercel proxy" below) — must be the frontend's own origin, not Convex's `.site` domain |
| `TRUSTED_ORIGINS` | `npx convex env set TRUSTED_ORIGINS "https://your-dashboard.example"` | Comma-separated extra CORS/cookie origins beyond `localhost:5173` (`convex/lib/trustedOrigins.ts`) |
| `RESEND_API_KEY` | `npx convex env set RESEND_API_KEY <key>` | Sends staff-invite emails (`convex/lib/email.ts`) — invites fail loudly until this is set |
| `EMAIL_FROM` | `npx convex env set EMAIL_FROM "Norrone Loyalty <you@yourdomain.com>"` | Optional — defaults to Resend's unverified sandbox sender (`onboarding@resend.dev`), which only delivers to the Resend account owner's own inbox. Set a verified domain sender before relying on delivery to real invitees. |
| `APPLE_PASS_TYPE_ID`, `APPLE_TEAM_ID`, `APPLE_PASS_CERT_PEM`, `APPLE_PASS_KEY_PEM`, `APPLE_PASS_KEY_PASSPHRASE` (optional), `APPLE_WWDR_CERT_PEM` | `npx convex env set <NAME> <value>` | Apple Wallet pass signing (`convex/walletNode.ts`) — unset by default, so Apple Wallet passes 503 until real Pass Type ID / WWDR credentials are added |
| `GOOGLE_WALLET_ISSUER_ID`, `GOOGLE_WALLET_CLASS_ID`, `GOOGLE_WALLET_SERVICE_ACCOUNT_JSON` | `npx convex env set <NAME> <value>` | Google Wallet "Save to Google Wallet" link (`convex/lib/wallet/googlePass.ts`) — unset by default, so Google Wallet passes 503 until a real service account is added |

`.env` (the SvelteKit-side file) only needs `PUBLIC_CONVEX_URL`/`PUBLIC_CONVEX_SITE_URL`
if you're not letting `.env.local` provide them — in practice you usually don't touch
`.env` at all for local dev.

## Deploying

The frontend (SvelteKit) and backend (Convex) deploy separately and independently.

### Backend — Convex production deployment

```sh
npx convex deploy    # creates/pushes to a *separate* production deployment from your dev one
```

Convex dev and prod deployments have **independent environment variable stores** —
every var in the table above must be set again against prod (`npx convex env set NAME
value --prod`, or switch your CLI's active deployment first). In particular, set
`SITE_URL` and `TRUSTED_ORIGINS` to your real production frontend URL (the Vercel domain
below), not `localhost`, or Better Auth's cookies/CORS will reject production sign-ins.

`npx convex deploy` prints the production `PUBLIC_CONVEX_URL`/`PUBLIC_CONVEX_SITE_URL` —
you'll need both for the Vercel step.

### Frontend — Vercel

This app uses `@sveltejs/adapter-vercel` (`vite.config.ts`) — no `vercel.json` needed for
a standard deploy. Vercel auto-detects Bun from `bun.lock`.

1. Import the repo into a new Vercel project (framework preset: SvelteKit).
2. Under Project Settings → Environment Variables, add (Production, and Preview if you
   want preview deploys working against the same backend):
   - `PUBLIC_CONVEX_URL` — from `npx convex deploy`'s output
   - `PUBLIC_CONVEX_SITE_URL` — same
   These are required at **build** time, not just runtime — `src/hooks.server.ts` reads
   `PUBLIC_CONVEX_SITE_URL` via `$env/static/public`, which is inlined at build, so the
   build fails without it set in Vercel first.
3. Deploy. Nothing else needs to live in Vercel's env vars — every secret in the table
   above (`RESEND_API_KEY`, `WALLET_SIGNING_SECRET`, the Apple/Google wallet vars, etc.)
   is read only inside Convex functions, never by the SvelteKit app, so it only ever goes
   through `npx convex env set --prod`.
4. Once you have your Vercel domain (or custom domain), go back to Convex and update
   `SITE_URL`/`TRUSTED_ORIGINS` (prod) to match it exactly, including `https://`.

## Setting up real Wallet credentials

The pass-building pipeline is fully implemented (see "Known gaps" above for which files)
and only needs credentials — no code changes. Both platforms are entirely independent;
set up one, both, or neither.

### Apple Wallet

Needs a paid Apple Developer Program membership ($99/year).

1. **Pass Type ID**: [developer.apple.com](https://developer.apple.com) → Certificates,
   Identifiers & Profiles → Identifiers → **+** → Pass Type IDs. Register an identifier
   like `pass.com.yourcompany.loyalty`. This is `APPLE_PASS_TYPE_ID`.
2. **Team ID**: shown on your Apple Developer account's Membership page. This is
   `APPLE_TEAM_ID`.
3. **Signing certificate**: open the Pass Type ID you just created → Create Certificate.
   It'll walk you through generating a CSR with Keychain Access (macOS) — upload it,
   download the resulting `.cer` file.
4. **Export cert + private key as PEM**: double-click the downloaded `.cer` to import it
   into Keychain (it pairs with the private key from your CSR), then in Keychain Access
   find the certificate, expand it to select both the certificate and its private key,
   right-click → Export 2 items → save as a `.p12`. Then convert to PEM:
   ```sh
   openssl pkcs12 -in Certificates.p12 -clcerts -nokeys -out cert.pem   # -legacy flag if openssl complains
   openssl pkcs12 -in Certificates.p12 -nocerts -out key.pem            # will ask for a key passphrase
   ```
   `cert.pem` → `APPLE_PASS_CERT_PEM`, `key.pem` → `APPLE_PASS_KEY_PEM`, and whatever
   passphrase you set → `APPLE_PASS_KEY_PASSPHRASE` (omit that var entirely if you export
   with an empty passphrase).
5. **WWDR certificate**: download Apple's current intermediate certificate from
   [Apple PKI](https://www.apple.com/certificateauthority/) ("Worldwide Developer
   Relations — G4" or whichever is current), convert similarly if it's not already PEM:
   ```sh
   openssl x509 -inform der -in AppleWWDRCAG4.cer -out wwdr.pem
   ```
   → `APPLE_WWDR_CERT_PEM`.
6. Set them all (each PEM file's *contents*, not the file path):
   ```sh
   npx convex env set APPLE_PASS_TYPE_ID "pass.com.yourcompany.loyalty" --prod
   npx convex env set APPLE_TEAM_ID "YOUR_TEAM_ID" --prod
   npx convex env set APPLE_PASS_CERT_PEM --from-file cert.pem --prod
   npx convex env set APPLE_PASS_KEY_PEM --from-file key.pem --prod
   npx convex env set APPLE_PASS_KEY_PASSPHRASE "your-passphrase" --prod   # skip if empty
   npx convex env set APPLE_WWDR_CERT_PEM --from-file wwdr.pem --prod
   ```
7. Verify: `/orgs/:orgId/wallet` in the dashboard should show Apple as "Configured", and
   a customer's "Add to Apple Wallet" button should download a real `.pkpass`.

#### Apple Wallet auto-update requires the Vercel proxy — and `SITE_URL` pointed at it

A saved Apple Wallet pass calls back to `webServiceURL` (set from `SITE_URL`, see the
env var table) both to register itself for push updates on install, and later to fetch
the refreshed pass whenever we push. This app sets `webServiceURL` to the **frontend's**
own origin (`src/routes/v1/[...path]/+server.ts`, a byte-for-byte reverse proxy onto
Convex's `/v1/...` HTTP Actions) rather than Convex's `*.convex.site` domain directly.

This is not cosmetic — real-device testing (iPhone syslog via `idevicesyslog`) showed
Apple Wallet's background daemon (`passd`) silently trying and failing to negotiate
HTTP/3 (QUIC) straight to Convex's site domain (fronted by Cloudflare), with **zero**
requests ever reaching Convex and no error surfaced anywhere — `curl` never caught this
because it doesn't attempt HTTP/3 by default. Routing through Vercel's edge (which
Wallet negotiates against successfully) sidesteps the problem entirely.

**What this means for any deployment, including self-hosting elsewhere:**
- `SITE_URL` **must** be set to whatever public origin serves the SvelteKit app itself
  (the one with `src/routes/v1/[...path]/+server.ts` deployed), never Convex's own URL
  directly — even though every other `/v1/...` consumer (the public API, demo pages)
  is free to hit Convex directly.
- That frontend origin must be reachable over HTTPS with working HTTP/3/QUIC support
  end-to-end (true of Vercel; verify this on any other host — e.g. behind a plain nginx
  reverse proxy without QUIC support, expect the same silent failure Convex hit).
- If the frontend is ever moved to a different domain, update `SITE_URL` there too —
  every *already-installed* pass has its old `webServiceURL` baked in at generation
  time, so existing customers' passes keep calling the old domain until they delete and
  re-add the pass (there's no way to migrate an already-installed pass's callback URL).
- `webServiceURL` must be the **bare origin with a trailing slash** (e.g.
  `https://your-frontend.example/`) — Apple Wallet appends its own `v1/devices/...`
  path segments on top at request time, so including `/v1/` in `SITE_URL` itself (or in
  code) produces a doubled `/v1/v1/devices/...` path that 404s. `SITE_URL` should just
  be the origin, with no path suffix.
- Apple pass field keys (`primaryFields`/`secondaryFields`/`headerFields`/`backFields`
  etc., in `convex/walletNode.ts`) must be **globally unique across the whole pass**,
  not just unique within one field group — Apple's client-side validator logs a warning
  (visible as an "Apple Wallet client log" line in Convex's function logs, reported via
  `POST /v1/log`, handled in `convex/httpPassService.ts`'s `logErrors`) for a duplicate
  key today, and has stated this becomes a hard error in a future release.

If you skip the Vercel proxy and point `webServiceURL` at Convex directly, static pass
issuance (download-and-add) still works fine — only the auto-update/push path silently
never registers.

### Google Wallet

Needs a Google Cloud project and Google Wallet API access (apply via the
[Google Wallet Business Console](https://pay.google.com/business/console/) — approval
can take a day or two the first time).

1. In the Wallet Business Console, create/note your **Issuer ID** — that's
   `GOOGLE_WALLET_ISSUER_ID`.
2. In Google Cloud Console, enable the **Google Wallet API** for your project, then
   create a **Service Account** (IAM & Admin → Service Accounts), and grant it access in
   the Wallet Business Console (Users → add the service account's email with at least
   "Developer" access).
3. Create a JSON key for that service account (Service Accounts → your account → Keys →
   Add Key → JSON) and download it.
4. Set the whole JSON file as one env var:
   ```sh
   npx convex env set GOOGLE_WALLET_ISSUER_ID "3388000000012345678" --prod
   npx convex env set GOOGLE_WALLET_SERVICE_ACCOUNT_JSON --from-file service-account.json --prod
   ```
5. **Create a Loyalty Class** — unlike Apple, Google requires the class to exist via the
   Wallet API *before* any object can reference it (this app only builds/signs the
   `loyaltyObject`/save-JWT per customer — see `convex/lib/wallet/googlePass.ts` — it does
   not create the class for you yet). Either use Google's
   [Wallet API](https://developers.google.com/wallet/retail/loyalty-cards/resources/rest/v1/loyaltyclass)
   directly (a one-time `POST` with your service account's OAuth token) or the Business
   Console's UI if it offers class creation, then set the resulting class id:
   ```sh
   npx convex env set GOOGLE_WALLET_CLASS_ID "3388000000012345678.norrone_loyalty_default" --prod
   ```
   If you skip this, `GOOGLE_WALLET_CLASS_ID` defaults to `${GOOGLE_WALLET_ISSUER_ID}.norrone_loyalty_default` —
   you still need to have created a class with that exact id for Google to accept the save request.
6. Verify: `/orgs/:orgId/wallet` should show Google as "Configured", and "Add to Google
   Wallet" should redirect to a real `pay.google.com/gp/v/save/...` link.

Drop `--prod` from any command above while testing against your dev deployment instead.

## Test accounts (this dev deployment only)

Seeded for local development/demo purposes — not real credentials, don't reuse this
pattern anywhere near production:

| Login | URL | Email | Password |
| --- | --- | --- | --- |
| Platform admin | `/admin/login` | `admin@mail.com` | `Admin@123` |
| Org owner | `/login` | `org@mail.com` | `Admin@123` |

Create more of either kind yourself via `/signup` (org) + `platformAdmins:seedFirstAdmin`
or the in-app "add admin" flow (platform admin) — see below.

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
Customers, Membership, Tiers, Points, Rewards, Coupons, Shops, API Keys, Wallet Pass,
Staff.

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

- **Transactional email is wired up for staff invites only.** `convex/lib/email.ts`
  sends via Resend (needs `RESEND_API_KEY`, see env var table) — staff "Add someone"
  (`convex/staff.ts`) auto-creates a Better Auth account with a generated password and
  emails it when the invitee doesn't already have one. `/forgot-password` and platform
  admin "add admin" are not wired to this yet and still degrade to an honest error
  message rather than silently failing.
- **Wallet passes (Apple/Google) are built but need real credentials.** The full
  pipeline exists — `convex/wallet.ts` (pass data + config status + signed-link
  action), `convex/walletNode.ts` (Apple `.pkpass` build + PKCS#7 signing, `"use node"`),
  `convex/lib/wallet/googlePass.ts` (Google save-link JWT), `convex/httpWallet.ts` (the
  `/v1/wallet/apple/:token` and `/v1/wallet/google/:token` endpoints) — but every request
  503s with `WALLET_NOT_CONFIGURED` until the Apple/Google env vars below are set. See
  "Setting up real Wallet credentials" below for the actual steps.
  Per-org branding (logo, banner image, colors, display name) is editable on the org
  dashboard's Wallet page, with separate live previews for each platform (their real
  structures differ enough that one shared mockup couldn't represent both accurately)
  — `convex/passTemplates.ts`. No "Powered by Norrone" branding text on either
  platform's pass — removed per product decision; the Norrone mark still ships as
  Apple's small icon (`convex/lib/wallet/norroneIcon.ts`, embedded as base64 so it
  never depends on Vercel being live), which is a notification/list-view graphic, not
  card-face text.
  **Passes auto-update**: any points/tier/membership change (manual dashboard grants in
  `customerGrants.ts`, or the public-API-triggered paths in `engine.ts`) schedules
  `walletNode.pushWalletUpdates`, which patches the customer's Google Wallet object
  in place and sends an Apple Push Notification (via `node:http2` mutual TLS using the
  same Pass Type ID cert — no separate push cert needed) to every device registered
  through Apple's PassKit Web Service protocol (`convex/httpPassService.ts`, backed by
  the `passRegistrations` table). A customer who hasn't saved either pass yet is the
  common case, not an error — both paths are best-effort and silently no-op.
  Apple's push path depends on `SITE_URL` pointing at the frontend's own domain (which
  proxies `/v1/...` onto Convex via `src/routes/v1/[...path]/+server.ts`), not Convex
  directly — see "Apple Wallet auto-update requires the Vercel proxy" above for why.
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
  lib/rateLimit.ts           Rate-limit buckets: public API (per key) + sign-in (per account)
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
  v1/[...path]/+server.ts                 Reverse proxy onto Convex's /v1/... HTTP Actions —
                                           required for Apple Wallet auto-update, see
                                           "Apple Wallet auto-update requires the Vercel proxy"
  wallet-demo/, api-demo/                 Public, unauthenticated demo pages for the wallet
                                           links and the rest of the /v1 API (query-param
                                           pre-fillable: ?key=&shop=&customer=)

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
