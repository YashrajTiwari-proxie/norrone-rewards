# @proxie-studio/better-auth-tenant-kit

Multi-tenant [Better Auth](https://better-auth.com) + [Convex](https://convex.dev)
wrapper for SvelteKit apps. Extracted from a working multi-tenant SaaS
reference implementation — one call, `createPlatformAuth()`, instead of
configuring the Better Auth client and the Convex client by hand in
every app that shares a single Better Auth instance / Convex
deployment.

Pairs with a backend that:
- runs `betterAuth()` on Convex via `@convex-dev/better-auth`
- exposes the standard `/api/auth/*` HTTP routes (`registerRoutes`)
- uses the `convex()` server plugin so sessions can also authenticate
  Convex queries/mutations via JWT

This package does **not** implement tenant scoping itself — that's a
backend/Better-Auth-plugin concern. It only wires the client-side and
SSR plumbing so every app that talks to that backend does it the same,
correct way.

## Install

```bash
bun add @proxie-studio/better-auth-tenant-kit better-auth @convex-dev/better-auth convex convex-svelte
```

`svelte`, `@sveltejs/kit`, `better-auth`, `@convex-dev/better-auth`,
`convex`, and `convex-svelte` are peer dependencies — install them
yourself so there's exactly one copy in your app's dependency tree.
Mismatched duplicate copies of `@sveltejs/kit`/`svelte` in particular
will break `instanceof` checks SvelteKit relies on internally (e.g.
`redirect()`); if you hit that, add `resolve.dedupe: ['svelte',
'@sveltejs/kit']` to your `vite.config.ts`.

## Why a proxy, not a direct connection to Convex

Better Auth's session cookie is set on whichever origin issues the
response. If your app's browser code talked to Convex's site URL
directly, the cookie would be third-party to your app's own origin —
breaking normal first-party SSR cookie reads and running into stricter
browser privacy rules for no reason. `createAuthProxyHandle` proxies
`/api/auth/*` through your app's own server, so the cookie ends up
first-party while Convex stays the actual source of truth for the
session.

## Usage

**`src/hooks.server.ts`** — proxy auth requests to Convex:

```ts
import { createAuthProxyHandle } from '@proxie-studio/better-auth-tenant-kit/server';
import { env } from '$env/dynamic/private';

export const handle = createAuthProxyHandle({
	convexSiteUrl: env.CONVEX_SITE_URL
});
```

**Root `+layout.svelte`** — wire the browser client (call once, at the
top of the root layout's `<script>`):

```svelte
<script lang="ts">
	import { createPlatformAuth } from '@proxie-studio/better-auth-tenant-kit';
	import { PUBLIC_CONVEX_URL } from '$env/static/public';

	const platformAuth = createPlatformAuth({ convexUrl: PUBLIC_CONVEX_URL });
</script>
```

`platformAuth.session.current` is a reactive getter (Svelte 5 runes) —
`undefined` while pending, `null` if signed out, otherwise
`{ session, user }`. `platformAuth.authClient` is the underlying
better-auth Svelte client (`useSession()`, `signOut()`, `signIn.email()`,
etc. all work normally). `platformAuth.convex` is the `convex-svelte`
client, already authenticated — pass it to `useQuery`/`useMutation` as
usual.

If you added your own sign-in/sign-up endpoints via a custom Better
Auth plugin (rather than the stock `/sign-in/email`), call them with
plain `fetch()` and then `platformAuth.refreshSession()` — Better
Auth's client only auto-refreshes its session store after its own
built-in endpoints, not custom ones.

**Protected routes** — a `+layout.server.ts` per protected route group:

```ts
import { requireSession, requireAccountType } from '@proxie-studio/better-auth-tenant-kit/server';
import { env } from '$env/dynamic/private';

const config = { convexSiteUrl: env.CONVEX_SITE_URL };

export const load = async (event) => {
	// or requireAccountType(event, config, 'owner') to also gate by role
	const session = await requireSession(event, config);
	return { user: session.user };
};
```

This re-validates against Convex on every request — it's a real
`303` redirect from the server, not a client-side check that can be
bypassed by disabling JS.

**Convex queries in a protected page** — gate on
`convex-svelte`'s `useAuth()` so the query doesn't fire before the
Convex client's token attaches (otherwise you'll briefly see an
"Unauthenticated" error flash on every load):

```svelte
<script lang="ts">
	import { browser } from '$app/environment';
	import { useQuery, useAuth } from 'convex-svelte';
	import { api } from '../convex/_generated/api';

	const auth = browser ? useAuth() : null;
	const data = browser ? useQuery(api.things.list, () => (auth?.isAuthenticated ? {} : 'skip')) : null;
</script>
```

## API

- `createPlatformAuth(config: PlatformAuthConfig)` — browser-only.
- `createAuthProxyHandle(config: PlatformAuthServerConfig): Handle`
- `getServerSession(request, config): Promise<SessionData | null>`
- `requireSession(event, config, redirectTo?): Promise<SessionData>`
- `requireAccountType(event, config, accountType, redirectTo?): Promise<SessionData>`
- Types: `AccountType`, `SessionUser`, `SessionData`,
  `PlatformAuthConfig`, `PlatformAuthServerConfig` (from
  `@proxie-studio/better-auth-tenant-kit` or the `/types` subpath).

`SessionUser` includes `restaurantId`/`accountType` fields matching the
reference backend this was extracted from — rename or extend `types.ts`
for your own tenant model.

## Developing this package

```bash
bun install
bun run build   # svelte-package → dist/
bun run check   # svelte-check
```

## License

MIT
