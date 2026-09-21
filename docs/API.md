# Norrone Rewards — Public API

Base URL: **your own app's domain** — e.g. `https://your-domain.example.com`. Every
request is `<your domain>/v1/...`; your deployment transparently proxies that through
to the backend (`src/routes/v1/[...path]/+server.ts`), so integrators never need to
know or depend on what's running behind it.

This is a machine-to-machine API for your website/POS to integrate the loyalty
program headlessly — it is **not** the same authentication system as the staff
dashboard (that's a Better Auth session; this is an API key). There is no end-customer
login of any kind.

A runnable example client is at [`examples/api-client.ts`](../examples/api-client.ts). An
interactive browser version covering every endpoint below is live at `/api-demo` on the
dashboard's own domain (accepts `?key=&shop=&customer=` query params to pre-fill).

## Authentication

Every request needs an `Authorization: Bearer <key>` header. Generate a key from the
org dashboard's **API Keys** page (`/orgs/:orgId/api-keys`) — the plaintext key is
shown **exactly once**, at generation time; only a salted hash is ever stored, so if
you lose it, revoke it and generate a new one.

Two key types:

| Type | Prefix | Can call |
| --- | --- | --- |
| **Secret** | `sk_` | Every endpoint below, including all writes. Server-side only — never ship it to a browser. |
| **Publishable** | `pk_` | Read-only endpoints only (marked "read" below). Safe for client-side/browser code. |

A key can optionally be scoped to one shop when you generate it (vs. "all shops"). A
shop-scoped key gets `403` on any request for a different shop.

Missing/invalid/revoked key → `401`. Wrong key type for the endpoint → `403`. A
shop-scoped key used against a different shop → `403`.

## Tenant isolation

Every response is scoped to your API key's own organization — there is no way to
address another organization's data through this API, and error responses are
deliberately indistinguishable between "doesn't exist" and "exists but belongs to
someone else" (both come back as `404`), so probing for other tenants' data gets you
nowhere.

## Idempotency

`PUT /shops/:shopId/customers/:externalId` and
`POST /shops/:shopId/customers/:externalId/membership` both accept an optional
`idempotencyKey` string in the body. Retry the identical request with the same key
(e.g. after a network timeout) and it's guaranteed to apply its effects **exactly
once** — the second (and any subsequent) call returns the current state with
`"idempotent": true` instead of re-applying. Use your own order/transaction ID as the
key. Omitting it means every call applies independently (fine for idempotent
operations like a plain balance read, not fine for "charge 100 points" retried blindly).

## Errors

Every error is `{ "error": "<message or code>" }` with a matching HTTP status. Known
codes:

| Status | Meaning |
| --- | --- |
| `400` | Malformed body / missing required field |
| `401` | Missing, malformed, or invalid/revoked API key |
| `403` | Wrong key type for this endpoint, or key is scoped to a different shop |
| `404` | Not found — a shop, customer, membership plan, or coupon that doesn't exist *for your organization* (see Tenant isolation above) |
| `409` | Conflict — duplicate `externalId` on customer create, or a coupon that's already been redeemed |
| `410` | Coupon has expired |
| `429` | Rate limited — see [Rate limits](#rate-limits). Check the `Retry-After` header. |
| `500` | Unexpected server error |

---

## `POST /v1/shops/:shopId/customers`

Creates a customer. **Requires a secret key.**

**Body**

```json
{ "externalId": "your-own-customer-id", "name": "Ada Lovelace", "phone": "+1...", "email": "ada@example.com" }
```

`externalId` is required and must be unique per shop (not globally) — `name`, `phone`,
`email` are all optional. Returns `409` if `externalId` already exists for this shop.

**Response** `201` — the [customer view](#customer-view-shape).

## `GET /v1/shops/:shopId/customers/:externalId`

Fetches a customer. Works with either key type.

**Response** `200` — the [customer view](#customer-view-shape).

## `PUT /v1/shops/:shopId/customers/:externalId`

The main "record an event" endpoint — adjusts spend/visits, awards ACTION points for a
named action if a matching point rule exists, then re-checks tier/reward/coupon
eligibility (a threshold crossed by this update can trigger an automatic grant in the
same call). **Requires a secret key.**

**Body** (all fields optional — send only what changed)

```json
{ "deltaSpend": 25.50, "deltaVisits": 1, "action": "PURCHASE", "idempotencyKey": "order-482913" }
```

- `deltaSpend` / `deltaVisits` — added to the customer's running totals (can be
  negative, e.g. a refund).
- `action` — matched against the org's [point rules](#point-rules) (a shop-specific
  rule wins over an org-wide one for the same action name); if a rule matches, points
  are credited scaled by the customer's current tier/membership multiplier (the
  higher of the two, never both stacked).
- `idempotencyKey` — see [Idempotency](#idempotency).

**Response** `200` — the customer view, plus (unless this call was an idempotent
replay) a `newlyGranted` object:

```json
{
  "...": "...customer view fields...",
  "newlyGranted": {
    "tier": { "name": "Gold" } | null,
    "rewards": [{ "id": "...", "name": "Free Dessert" }],
    "coupons": [{ "code": "AB12CD34EF", "status": "ISSUED" }]
  }
}
```

`tier` is only ever the *first* newly-granted tier this call (a customer can only
realistically cross one tier boundary per event); `rewards`/`coupons` are full arrays.

## `PUT /v1/shops/:shopId/customers/:externalId/profile`

Updates the customer's own profile fields (not stats — see the plain `PUT
.../customers/:externalId` above for recording an event). **Requires a secret key.**

**Body** (all fields optional — send only what changed)

```json
{ "name": "Ada Lovelace", "phone": "+1...", "email": "ada@example.com" }
```

**Response** `200` — the [customer view](#customer-view-shape).

## `DELETE /v1/shops/:shopId/customers/:externalId`

Permanently deletes the customer and every row referencing them (point ledger, tier
history, memberships, granted rewards, and issued coupons). **Requires a secret key.**
This cannot be undone.

**Response** `204`, empty body.

## `GET /v1/shops/:shopId/customers/:externalId/points`

The customer's full point ledger (newest first) and running balance. Works with
either key type.

**Response** `200`

```json
{
  "balance": 1250,
  "ledger": [{ "amount": 50, "reason": "MANUAL", "note": "welcome bonus", "at": 1798761600000 }]
}
```

`reason` is one of `ACTION | MANUAL | EXPIRY | REVERSAL`. `note` is whatever string you
sent as `note` on the `POST` below (or `undefined` for ledger rows from other sources).

## `POST /v1/shops/:shopId/customers/:externalId/points`

Manually grants or adjusts points (use a negative `amount` to deduct) — re-checks
tier/reward/coupon eligibility the same way `PUT .../customers/:externalId` does,
since a manual grant can cross a POINTS-based threshold. **Requires a secret key.**

**Body**

```json
{ "amount": 50, "note": "welcome bonus" }
```

**Response** `201` — the same shape as `GET .../points` above, reflecting the new balance.

## `POST /v1/shops/:shopId/customers/:externalId/membership`

Enrolls a customer in a paid membership plan — starts it immediately, applies the
plan's granted benefits, and re-checks tier/reward/coupon eligibility (same effect a
"pay for membership" flow through your own checkout should trigger). **Requires a
secret key.**

**Body**

```json
{ "planId": "<membership plan id, from the dashboard>", "idempotencyKey": "sub-58213" }
```

**Response** `201` — the customer view (now reflecting the new membership).

## `GET /v1/shops/:shopId/customers/:externalId/offers`

Personalized offers for this specific customer: distance to their next tier, coupon
types they qualify for but haven't been issued yet, and membership plans they aren't
currently enrolled in. Works with either key type.

**Response** `200`

```json
{
  "nextTier": { "name": "Platinum", "amountRemaining": 340, "metric": "SPEND" } | null,
  "availableCoupons": [{ "name": "Birthday 20% Off", "condition": "Total spend ≥ 500" }],
  "membershipPlansAvailable": [{ "name": "Gold Membership", "price": 29.99 }]
}
```

## `GET /v1/shops/:shopId/offers`

Public, non-personalized, cacheable offers for a shop — safe to render on a public
marketing page. Works with either key type.

**Response** `200`

```json
{
  "membershipPlans": [{ "name": "Gold Membership", "price": 29.99 }],
  "publicTiers": [{ "name": "Gold", "threshold": 500 }],
  "publicCoupons": [{ "name": "First Visit 10% Off" }]
}
```

`publicTiers`' `threshold` is the tier's `SPEND ≥` condition value if it has one, else
`null` — this endpoint never reveals visit-count or points-based conditions, only the
spend framing appropriate for public marketing copy.

## `GET /v1/shops/:shopId/customers/:externalId/wallet/apple`

Returns a signed `.pkpass` file for this customer — download it and forward/host it
however you want (email attachment, re-serve from your own domain, embed a link on your
own site, etc.). Works with either key type. `503` with `{ "error": "WALLET_NOT_CONFIGURED",
"message": "..." }` if the platform's Apple Wallet credentials aren't set up yet.

**Response** `200`, `Content-Type: application/vnd.apple.pkpass` — the raw pass binary.

## `GET /v1/shops/:shopId/customers/:externalId/wallet/google`

Returns a "Save to Google Wallet" URL for this customer — safe to render as a link or
button, or redirect to directly. Works with either key type. Same `503` shape as the
Apple endpoint above if Google Wallet isn't configured.

**Response** `200`

```json
{ "saveUrl": "https://pay.google.com/gp/v/save/<jwt>" }
```

An interactive example using both endpoints (paste your API key, shop ID, and a
customer's external ID) is live at `/wallet-demo` on the dashboard's own domain.

## `POST /v1/coupons/:code/redeem`

Redeems a coupon code at the point of sale. **Requires a secret key.** No `:shopId` in
the URL — the coupon's owning organization (via its customer) is checked against your
API key's organization directly, so this is itself the tenant-isolation boundary for
this one endpoint.

**Response** `200`

```json
{ "redeemed": true }
```

**Errors**: `404` not found (including cross-tenant), `409` already redeemed, `410`
expired (the coupon's status is also flipped to `EXPIRED` server-side at this point),
`400` if the code fails signature verification (see below).

`:code` accepts either a plain code (what you'd type in at a POS) or a signed
`code.signature` payload (what a scanned wallet-pass barcode would eventually emit,
once wallet passes are implemented — see the main README's "Known gaps"). Signed
payloads are HMAC-verified server-side against `WALLET_SIGNING_SECRET` before the code
inside is used.

---

## Org-scoped resources: membership plans, tiers, rewards, coupon types

Unlike customers (genuinely shop-scoped, under `/v1/shops/:shopId/...`), these four
are org-level resources — a plan/tier/reward/coupon type can optionally be restricted
to one shop via its own `shopId` field, but the endpoint itself isn't nested under a
shop. All four follow the identical shape, `<resource>` being one of:

| `<resource>` | Definition managed |
| --- | --- |
| `membership-plans` | [Membership plans](#membership-plans-fields) |
| `tiers` | [Tiers](#tiers-fields) |
| `rewards` | [Rewards](#rewards-fields) |
| `coupons` | Coupon *types* — see [Coupons fields](#coupons-fields). Distinct from `POST /v1/coupons/:code/redeem` above, which acts on a coupon *instance* by its code. |

### `GET /v1/<resource>`

Lists every item of this type for your organization. Works with either key type.
Optionally filter with `?shopId=<id>` — returns items scoped to that shop plus every
org-wide (no `shopId`) item.

**Response** `200` — an array of items, each shaped per the resource's fields table below.

### `GET /v1/<resource>/:id`

Fetches one item. Works with either key type. `404` if it doesn't exist or belongs to
another organization.

### `POST /v1/<resource>`

Creates an item. **Requires a secret key.**

**Response** `201` — the created item.

### `PUT /v1/<resource>/:id`

Replaces an item's fields (send the full set of fields, not a partial patch —
matches how the dashboard's own edit forms work). **Requires a secret key.**

**Response** `200` — the updated item.

### `DELETE /v1/<resource>/:id`

Deletes an item. **Requires a secret key.** For membership plans specifically: any
customer with an active membership on the deleted plan has that membership cancelled
(not silently left dangling) as part of the same call.

**Response** `204`, empty body.

#### Membership plans fields

```json
{ "name": "Gold Membership", "price": 29.99, "durationDays": 30, "pointMultiplier": 2, "shopId": "..." }
```

`price` absent = free. `durationDays` absent = never expires. `shopId` is optional
(absent = applies org-wide, to all shops).

#### Tiers fields

```json
{ "name": "Gold", "level": 2, "pointMultiplier": 1.5, "shopId": "..." }
```

Higher `level` = higher tier. `shopId` optional, same meaning as above.

#### Rewards fields

```json
{ "name": "Free Dessert", "description": "On the house", "memberOnly": false, "shopId": "..." }
```

#### Coupons fields

```json
{ "name": "First Visit 10% Off", "discountValue": 10, "discountType": "PERCENTAGE", "validityDays": 30, "memberOnly": false, "shopId": "..." }
```

`discountType` is `PERCENTAGE` or `FIXED`. This creates the coupon *type* — actual
redeemable codes are issued to a customer separately (from the dashboard's manual
grant, or automatically via eligibility conditions), then redeemed with
`POST /v1/coupons/:code/redeem` above.

---

## Customer view shape

Returned by every endpoint above that returns a customer:

```json
{
  "externalId": "your-own-customer-id",
  "isMember": true,
  "membership": { "planName": "Gold Membership", "expiresAt": 1798761600000 } | null,
  "tier": { "name": "Gold", "level": 2 } | null,
  "pointBalance": 1250,
  "rewards": [{ "name": "Free Dessert", "grantedAt": 1798000000000 }],
  "coupons": [{ "code": "AB12CD34EF", "status": "ISSUED", "expiresAt": 1798761600000 }]
}
```

`pointBalance` is a running sum of the point ledger (can include negative manual
adjustments/reversals) — there's no separate mutable counter to drift out of sync.
`expiresAt`/`grantedAt` are epoch milliseconds.

## Point rules

Configured per-organization on the dashboard's Points page — each rule maps an
`action` name (any string you choose — `PURCHASE`, `VISIT`, `REFERRAL`, whatever your
integration calls it) to a `pointsPerUnit` value, optionally restricted to members
only and/or to one shop. When `PUT .../customers/:externalId` is called with an
`action`, the most specific matching rule (shop-specific beats org-wide) is used.

## Rate limits

Each API key gets its own budget: **120 requests/minute sustained, burst capacity
200** (a token bucket, not a fixed window — a legitimate burst of activity is fine as
long as the sustained rate settles back down). Exceeding it returns `429` with a
`Retry-After` header (seconds until you can safely retry). One organization's key
being rate-limited never affects another organization's key or another key on the
same organization.

Build clients that back off on `429` (honor `Retry-After`) rather than retrying
immediately in a loop, and use `idempotencyKey` on retries instead of re-sending
blindly — see [Idempotency](#idempotency) above.
