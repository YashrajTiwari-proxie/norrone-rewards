# Wallet pass redesign — plan

**Status: the strip/hero/accent-color portion below was implemented, tested
in the dashboard, and reverted.** The procedurally-generated banded strip
looked bad in practice — a flat geometric color block doesn't read as
"branded" the way real artwork or a photo does (see two reference passes
supplied afterward: `reference/WhatsApp Image *.jpeg`, both real Apple
Wallet passes using either the org's own designed strip artwork or actual
photography, never a generated shape). Per direct instruction ("go simple
instead of this approach"), `accentColor`, the strip image, and the Google
`heroImage` were all removed. What's still live from this plan: `labelColor`
(derived, no picker), the contrast validation guard, `barcode.altText`, and
the Apple auxiliary field's Customer/Member label switch. The sections
below are kept for history — don't re-implement the strip/hero/accent
pieces without a different approach to sourcing real artwork per org.

Not implemented yet (superseded by the above). This captures the design review + decisions from the
"Logo and Apple directions" design doc (`Norrone Wallet Pass.dc.html`) so
implementation can start from an agreed spec rather than mid-conversation
context.

## Design doc assessment

The provided doc (three Apple variants — 1a Bare, 1b Banded, 1c Expressive —
plus shared Apple back-of-card, strip artboards, Google Wallet mock, a
3-org palette-swap proof, and a spec sheet) covers every field currently
piped into a pass (org name, points, tier, membership, member name,
barcode, "Powered by Norrone") and correctly treats Apple/Google
asymmetrically (Apple front-loads tier+membership; Google keeps them behind
"Details", matching Google's real template rigidity). It also introduces
one real improvement we didn't have: a contrast validation rule (foreground
≥4.5:1, label ≥4.5:1 against background) — this becomes a dashboard
guardrail, not just a design note.

Gaps the doc's mockups don't resolve on their own (addressed in "Open items"
below): no-tier / no-membership state, missing-logo fallback, and the doc
doesn't touch any dashboard screen besides the wallet page itself.

## Decisions locked

- **Ship variant 1b (Banded)** — flat-color strip, not 1a (too plain) or 1c
  (doc's own warning: reads badly with low-contrast client palettes, needs
  a carefully-tuned 3rd hex per org).
- **Strip (Apple) / hero (Google) band is procedurally generated from org
  colors, not uploaded artwork.** No per-org design work required beyond
  picking colors — matches the doc's own note that 1b "needs no per-org art
  direction beyond two hex values."
- **`labelColor` is auto-derived** (a fixed blend between background and
  foreground), not a manual picker — keeps the dashboard's color inputs
  from growing to 4 pickers.
- **Accent color IS a new manual picker** (background/foreground/accent =
  3 total) — accent is a distinct hue (e.g. gold on a dark green base), not
  a lightness variant of bg/fg, so it can't be auto-derived the way
  labelColor can.

### Consequence for the design tool

Since the strip/hero band is now code, not exported art, **the design tool
output needed going forward is much smaller**: just the real Norrone
icon/logo mark (the `icon.png` set, currently placeholder-quality) and
sign-off on the default palette. No strip.png/heroImage exports needed.

## New during this planning pass: Customer vs Member label

Today `auxiliaryFields` always labels the name field "Member" regardless of
membership status (`convex/walletNode.ts`):
```ts
auxiliaryFields: [{ key: "member", label: "Member", value: passData.customerName }]
```
Change: the label should read **"Member"** only when the customer has an
active membership (`passData.membershipPlanName` is set), and **"Customer"**
otherwise — the value (their name) doesn't change, just the label above it.
Cheap, no new data needed (`membershipPlanName` already resolved in
`getPassData`), avoids a redundant membership-status indicator since the
membership plan name is already shown as its own field when present.

```ts
auxiliaryFields: [
	{
		key: "member",
		label: passData.membershipPlanName ? "Member" : "Customer",
		value: passData.customerName
	}
]
```

Apply the same label logic to Google's `accountName` field context — Google
doesn't have a separate "label" for `accountName` the way Apple does
(it's always just the account holder name under a fixed Google-drawn
"Loyalty ID" style heading), so this change is **Apple-only**; Google's
front card has no equivalent slot to conditionally relabel.

## Implementation plan

### Backend (Convex)

1. `convex/schema.ts` — add `accentColor: v.optional(v.string())` to
   `passTemplates`. No `labelColor` field — it's derived, not stored.
2. `convex/lib/wallet/color.ts` (new) — hex↔rgb helpers, a WCAG
   contrast-ratio function, and `deriveLabelColor(background, foreground)`
   (a fixed blend between the two).
3. `convex/passTemplates.ts`'s `save` — validate contrast (foreground vs
   background ≥4.5:1); reject with a clear error rather than silently
   saving an illegible pass.
4. `convex/lib/wallet/stripPng.ts` (new) — pure-JS rectangle-fill PNG
   writer (no canvas dependency available in Convex's Node runtime) —
   produces the 1b banded strip at 320×84 / 640×168 / 960×252 from
   `backgroundColor` + `accentColor`. Extends the same zlib-deflate
   approach `simplePng.ts` already uses for flat colors, generalized to
   multiple rects instead of one flat fill.
5. `convex/walletNode.ts`:
   - Add `strip.png` / `@2x` / `@3x` to the pkpass zip.
   - Set `labelColor` (rgb() string, derived via `deriveLabelColor`).
   - Add `barcode.altText` (a short caption under the barcode).
   - Apply the Customer/Member label change above.
6. `convex/lib/wallet/googlePass.ts` — Google's `heroImage` needs a
   **hosted URL**, not inline bytes (unlike Apple's zip-embedded PNG).
   Generate the same banner PNG, store it via `ctx.storage`, get its URL,
   set `heroImage.sourceUri` in `ensureLoyaltyClass`. `ensureLoyaltyClass`
   currently does plain `fetch` calls with no storage access — the
   storage-write needs to happen in `passTemplates.ts`'s action (which has
   `ctx`), passing the resulting URL down instead.
7. Update `DEFAULT_PASS_DESIGN` (`convex/wallet.ts`) to the new triad:
   background `#14211F` / foreground `#F2F0E9` / accent `#C9A227`.

### Frontend

8. `src/routes/orgs/[orgId]/wallet/+page.svelte`:
   - Add an "Accent color" picker alongside the existing background/
     foreground pickers.
   - No labelColor picker (computed) — optionally show it read-only near
     the preview so org admins understand why label text looks the way it
     does.
   - Live contrast warning under the color pickers before save (mirrors
     the server-side check in step 3, so the error isn't a surprise only
     on submit).
   - Extend the existing QR preview card to render the strip band + tier/
     membership row matching 1b's layout, and the Customer/Member label
     switch.

## Open items (not blocking, but unresolved)

- **No-tier / no-membership visual state**: the design doc's mockups
  always show both tier and membership populated. Our field-building code
  already conditionally omits missing ones (`walletNode.ts` only adds a
  secondaryFields entry when the value exists), so functionally it
  degrades gracefully — but no one has visually checked what a single-
  value or fully-empty row looks like against 1b's layout.
- **Missing-logo fallback**: today a flat color square (see
  `solidColorPng`) substitutes for an org's uploaded logo. An initials
  monogram would read better but needs text rasterization, which the
  current pure-JS PNG approach doesn't support — deferred, not part of
  this redesign pass.

## Asset checklist (for the design tool, updated)

- Norrone icon/logo mark → `icon.png` / `@2x` / `@3x` (29×29 / 58×58 /
  87×87), transparent PNG.
- Final sign-off on the default palette (`#14211F` / `#F2F0E9` / accent
  `#C9A227`) — everything else (strip, hero, per-org recoloring) is
  generated by code, not exported files.
