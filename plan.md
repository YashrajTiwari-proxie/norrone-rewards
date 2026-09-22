# Password reset — implementation plan

Not yet implemented. Current state (see investigation in-session): `/forgot-password` is a
static "contact an owner" page, `convex/auth.ts` has no `sendResetPassword` handler, and
`convex/lib/email.ts` (Resend sender) exists but is unused dead code. Staff invites require the
inviting owner to type and relay the new hire's password manually — no auto-generation, no email.

## 1. Env vars (Convex-side, via `npx convex env set`)

- `RESEND_API_KEY` — required by `convex/lib/email.ts`'s `sendEmail()`, currently unset.
- `EMAIL_FROM` — optional, defaults to Resend's sandbox sender.
- `SITE_URL` — base URL used to build the reset link sent in the email.

## 2. Wire `sendResetPassword` in `convex/auth.ts`

Add to the `emailAndPassword` block (currently just `{ enabled: true }`):

```ts
emailAndPassword: {
	enabled: true,
	sendResetPassword: async ({ user, url }) => {
		await sendEmail({
			to: user.email,
			subject: 'Reset your Norrone Rewards password',
			html: `... link to ${url} ...`
		});
	}
}
```

Import `sendEmail` from `convex/lib/email.ts` (already implemented, just unused).

## 3. Build the actual forgot-password flow

- `/forgot-password`: replace the static card with a real form — email input, calls Better
  Auth's client `forgetPassword({ email, redirectTo: '/reset-password' })`. Show a generic
  "if that email exists, we sent a link" message (don't leak account existence).
- New `/reset-password` page: reads the token from the URL, form for new password + confirm,
  calls Better Auth's client `resetPassword({ newPassword, token })`, redirects to `/login` on
  success.

## 4. Staff invite emails (separate, optional)

Reintroduce `sendEmail()` in `convex/staff.ts`'s `invite` action for the new-account branch —
auto-generate a temp password again (this was removed in commit `78c567b`) and email it via
Resend, instead of the owner typing/relaying it out-of-band. Decide whether to also force a
password change on first login (no such mechanism exists today).

## 5. In-app change-password (optional)

No self-serve "change my password" UI exists for any signed-in role today. Better Auth has this
built in server-side (`/change-password`, referenced only in a rate-limit comment in
`convex/auth.ts:71`) — just needs a small form somewhere in the dashboard (e.g. Staff page or a
new account-settings page) calling the client `changePassword()` API.

## 6. Housekeeping

`README.md` (~lines 341-348) currently describes the pre-`78c567b` staff-invite behavior
(auto-generated + emailed password) — this is stale and should be corrected once the actual
behavior is decided (either fix the doc to match current manual-password behavior, or reinstate
auto-generation per #4 and the doc becomes accurate again).
