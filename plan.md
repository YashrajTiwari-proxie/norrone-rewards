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
