# Password reset — implementation plan

## Done

- **Env vars needed** (Convex-side, via `npx convex env set`): `RESEND_API_KEY` (required by
  `convex/lib/email.ts`'s `sendEmail()`), `EMAIL_FROM` (optional, defaults to Resend's sandbox
  sender), `SITE_URL` (base URL used in reset/invite links). Not yet set on the dev deployment —
  emails will fail loudly (`sendEmail` throws) until `RESEND_API_KEY` is set.
- **`sendResetPassword` wired in `convex/auth.ts`** — relays Better Auth's own token URL via
  `sendEmail()`.
- **`/forgot-password`** is a real form now (email → `authClient.requestPasswordReset({ email,
  redirectTo: '/reset-password' })`), generic "check your email" message regardless of whether
  the account exists.
- **`/reset-password`** (new page) reads the `?token=...` Better Auth's callback attaches, form
  for new password + confirm, calls `authClient.resetPassword({ newPassword, token })`, redirects
  to `/login` on success.
- **Staff invite emails reinstated** — `convex/staff.ts`'s `invite` action auto-generates a temp
  password again and emails it via `sendEmail()`, matching the original pre-`78c567b` behavior.
  The manual password field was removed from the Staff page's invite form.
- **README's "Known gaps" section** updated to match.

## Still open

- **In-app change-password.** No self-serve "change my password" UI exists for any signed-in
  role today. Better Auth has this built in server-side (`/change-password`, referenced only in
  a rate-limit comment in `convex/auth.ts:71`) — just needs a small form somewhere in the
  dashboard (e.g. Staff page or a new account-settings page) calling the client
  `changePassword()` API.
- **Org-owner backup codes / platform-admin reset**, discussed as a lower-friction alternative
  to email reset for the owner's own account — not started; email reset above covers everyone
  (owners included) for now.

# Email campaigns / newsletter — implementation plan

Not yet implemented. This has grown from "capture an email on the landing page" into a small
in-app email-marketing subsystem: a subscriber list, a reusable block-based template designer,
and a batch+scheduled campaign sender. Decided scope (confirmed in conversation):

- **Tenancy**: platform-level newsletter is the actual target (Norrone's own marketing list,
  composed/sent by platform admins), but `emailTemplates` and `campaigns` both carry an
  **optional `organizationId`** from day one so the same builder/sender can be reused for a
  future "org emails its own customers" feature without a schema migration later. `null`/absent
  `organizationId` = platform-level. Nothing in this plan *builds* the org-level path yet — it
  just doesn't block it.
- **Designer**: block-based (Heading, Paragraph, Image, Button, Divider, Spacer), not raw HTML or
  rich-text. Renders through one pure function, reusable outside this feature.
- **"Promotions"**: just a campaign `kind` label (`"newsletter"` vs `"promotion"`) for organizing
  sends — no functional difference, no coupon-embedding block.
- **Sending identity**: one single shared sender address/domain for every campaign (the existing
  `EMAIL_FROM` env var, same one password-reset/staff-invite emails already use) — not per-org.
  This is true even for a future org-level campaign (§1's `organizationId` is about who *owns and
  edits* a campaign, not who it's *sent as*). Simplifies §5's domain-verification item to a single
  one-time setup, and means no per-org "from" address/domain field is needed anywhere in the
  schema.

Reuses the email infra already built for password reset — same `sendEmail()` (`convex/lib/email.ts`,
Resend), same `RESEND_API_KEY`/`EMAIL_FROM`/`SITE_URL` env vars, same rate-limiter pattern
(`convex/lib/rateLimit.ts`), same token-link pattern as `/reset-password` for unsubscribe.

## 1. Data model

Five new tables in `convex/schema.ts`:

```ts
newsletterSubscribers: defineTable({
  email: v.string(),                // normalized: trim + lowercase
  status: v.union(v.literal("subscribed"), v.literal("unsubscribed"), v.literal("bounced")),
  source: v.optional(v.string()),   // e.g. "landing-footer"
  unsubscribeToken: v.string(),
  subscribedAt: v.number(),
  unsubscribedAt: v.optional(v.number()),
}).index("by_email", ["email"]).index("by_unsubscribe_token", ["unsubscribeToken"])
  .index("by_status", ["status"]),

emailTemplates: defineTable({
  organizationId: v.optional(v.id("organizations")),   // undefined = platform-level
  name: v.string(),
  blocks: v.array(v.any()),         // ordered content blocks — see §3
  isDefault: v.optional(v.boolean()),
  createdAt: v.number(),
  updatedAt: v.number(),
}).index("by_organization", ["organizationId"]),

campaigns: defineTable({
  organizationId: v.optional(v.id("organizations")),
  kind: v.union(v.literal("newsletter"), v.literal("promotion")),
  subject: v.string(),
  blocks: v.array(v.any()),         // snapshotted from a template at creation/edit time
  status: v.union(
    v.literal("draft"), v.literal("scheduled"), v.literal("sending"),
    v.literal("sent"), v.literal("canceled")
  ),
  scheduledAt: v.optional(v.number()),
  batchSize: v.number(),            // default 50 — see §4
  batchIntervalMs: v.number(),      // default ~3000ms between batches
  totalRecipients: v.optional(v.number()),
  sentCount: v.optional(v.number()),
  failedCount: v.optional(v.number()),
  createdBy: v.string(),            // authUserId
  createdAt: v.number(),
  sentAt: v.optional(v.number()),
}).index("by_status", ["status"]).index("by_organization", ["organizationId"]),

campaignRecipients: defineTable({
  campaignId: v.id("campaigns"),
  subscriberId: v.id("newsletterSubscribers"),
  status: v.union(v.literal("pending"), v.literal("sent"), v.literal("failed"), v.literal("skipped")),
  error: v.optional(v.string()),
  sentAt: v.optional(v.number()),
}).index("by_campaign_and_status", ["campaignId", "status"])
  .index("by_campaign_and_subscriber", ["campaignId", "subscriberId"]),
```

`campaignRecipients` is the actual send queue and the reason batch sending is resumable: if a
batch run is interrupted (deploy, error, whatever), the next invocation just re-queries
`by_campaign_and_status` for `"pending"` rows and keeps going — nothing is lost or double-sent.

## 2. Subscribe / unsubscribe (public, platform-level)

Same shape as the original plan, simplified to single opt-in:

- `convex/newsletter.ts`: public `subscribe({ email, source? })` mutation — validates email
  shape, rate-limited (new `rateLimiter` bucket keyed by the email itself, mirroring
  `accountSignInAttempt`'s shape), upserts by `email` via `by_email` (no-op if already
  `"subscribed"`, real re-subscribe if `"unsubscribed"`), generates a fresh `unsubscribeToken`,
  sends a short "you're subscribed" welcome email (best-effort — wrapped in the same
  try/catch-and-degrade pattern as `convex/staff.ts`'s invite email, so a Resend hiccup never
  fails the mutation itself).
- Public page `/newsletter/unsubscribe?token=...`, mirroring `/reset-password`'s shape: looks up
  `by_unsubscribe_token`, sets `status: "unsubscribed"`, shows a plain confirmation. Every sent
  campaign email's footer links here.
- Landing page: a simple inline form in the footer (`.l-footer` on `/`) calling `subscribe`
  directly via `useMutation` — no separate signup page needed.

## 3. The designer (block-based, reusable)

- **Block schema** (each entry in `blocks: v.array(v.any())`): a discriminated union by `type` —
  `{type: "heading", text}`, `{type: "paragraph", text}`, `{type: "image", url, alt}`,
  `{type: "button", label, url}`, `{type: "divider"}`, `{type: "spacer", height}`. Stored loosely
  (`v.any()`) at the schema level since the set of block types will grow; validated at the
  application layer instead.
- **Renderer**: `convex/lib/emailBlocks.ts` — a pure `renderBlocksToHtml(blocks, {unsubscribeUrl}): string`
  function producing table-based, email-client-safe HTML (not flexbox/grid — those don't render
  reliably in Outlook/Gmail). This is the reusable piece: no dependency on campaigns, Svelte, or
  even Convex — just data in, HTML string out. Used both for the designer's live preview and for
  the actual send.
- **Designer UI**: new platform-admin page (`/admin/(dashboard)/newsletter/templates/[id]` or
  similar) — a left rail of "add block" buttons, a center preview column rendering the current
  blocks (via the same renderer, in an iframe or scoped container to approximate email
  rendering), and a right panel to edit the selected block's fields. Reordering via simple
  up/down controls for v1 (true drag-and-drop is a nice-to-have, not required to ship).
- **Default template**: one system-seeded `emailTemplates` row (`isDefault: true`,
  `organizationId: undefined`) — logo header, heading block, paragraph placeholder, button
  placeholder, footer block with the unsubscribe link — used as the starting point for a new
  campaign.
- Composing a campaign = picking a template (defaults to the system default), which snapshots
  its `blocks` onto the new `campaigns` row for editing — matches the "snapshot at send time"
  reasoning above.

## 4. Batch + scheduled sending

- When a campaign moves to `"scheduled"` (`scheduledAt` set): at that time, an internal mutation
  snapshots the current audience — every `newsletterSubscribers` row with `status: "subscribed"`
  — into `campaignRecipients` rows (`status: "pending"`), sets the campaign to `"sending"`, and
  kicks off the batch loop with `ctx.scheduler.runAfter(0, internal.newsletter.processBatch, {campaignId})`.
- `processBatch` (internal action): queries the next `batchSize` (default 50) `"pending"` rows
  via `by_campaign_and_status`, sends them through Resend's **batch email endpoint** (max
  100/request — our default of 50 stays comfortably under that even if batch size is tuned up),
  marks each recipient `"sent"`/`"failed"`, updates the campaign's running counters, and — if any
  `"pending"` rows remain — reschedules itself via `ctx.scheduler.runAfter(batchIntervalMs, ...)`.
  When none remain, marks the campaign `"sent"` and stamps `sentAt`.
- This uses the exact `ctx.scheduler.runAfter` self-rescheduling pattern already established in
  this codebase (`convex/engine.ts`, `convex/customerGrants.ts` use it for deferred wallet
  pushes) — no new infra primitive, just a new use of an existing one. No cron file needed; the
  loop is entirely self-driven from the moment a campaign is scheduled.
- A campaign in `"scheduled"` (not yet `"sending"`) can be canceled — flips to `"canceled"`,
  nothing to unwind since no batches have run yet.

## 5. Fast-follows (explicitly deferred, not v1)

- **Bounce/complaint handling** via a Resend webhook — without it, hard-bounced addresses keep
  getting re-sent to on every future campaign. Worth adding once real sending volume exists;
  schema already has a `"bounced"` status ready for it.
- **Sender domain verification** — real bulk sending needs a verified domain (SPF/DKIM/DMARC) in
  Resend; the current sandbox sender only delivers to the Resend account owner's own inbox. This
  is infrastructure setup outside the codebase, but blocks real sending regardless of how much
  of this plan is implemented.
- **Analytics** (opens/clicks) — needs tracking pixels/link rewriting + webhook ingestion;
  meaningfully more work, deliberately out of scope for v1.
- **True drag-and-drop block reordering**, **org-level campaigns actually being buildable by org
  staff** (the schema anticipates it; the UI/permissions to let an org staff member use it don't
  exist yet), **CSV export of subscribers**.

## Open items before implementing

1. Confirm default `batchSize`/`batchIntervalMs` (50 / 3s ≈ 1,000 recipients/min) is a reasonable
   starting pace — easy to tune later, just want a sanity check before it's load-bearing.
2. Where exactly the designer page lives in the platform-admin nav (new top-level "Newsletter"
   section assumed).
3. Sender domain verification (see §5) needs to happen in Resend's dashboard before any real
   campaign can send to more than the account owner's own inbox — worth doing early since it's
   outside the code and has its own lead time (DNS propagation).
