import { browser } from "$app/environment";
import { createAuthClient } from "better-auth/svelte";
import { convexClient } from "@convex-dev/better-auth/client/plugins";
import { setupConvex, setupAuth } from "convex-svelte";
import type { PlatformAuthConfig, SessionData } from "./types.js";

/**
 * Explicit return type for createPlatformAuth below. svelte-package's
 * declaration-emit step silently drops the .d.ts for this file if the
 * return type is left fully inferred — "the inferred type ... cannot be
 * named without a reference to external modules" is a known
 * @sveltejs/package limitation for functions returning object literals
 * built from other packages' client types. Spelling the type out via
 * ReturnType<typeof ...> (rather than letting it infer across module
 * boundaries) is the documented workaround.
 */
type PlatformAuthInstance = {
  authClient: ReturnType<typeof createAuthClient>;
  convex: ReturnType<typeof setupConvex> | null;
  session: {
    readonly current: SessionData | null | undefined;
    readonly isPending: boolean;
  };
  refreshSession: () => Promise<void>;
};

/**
 * The one call apps make instead of configuring Better Auth or the
 * Convex client directly. Wires:
 *  - better-auth's Svelte client, pointed at this app's own origin
 *    (proxied server-side to Convex — see server.ts) so the session
 *    cookie is first-party.
 *  - convex-svelte's client, authenticated via the official
 *    `authClient.convex.token()` endpoint (from the `convex()` server
 *    plugin's companion `convexClient()` client plugin) — the same
 *    mechanism @convex-dev/better-auth's React binding uses, just
 *    wired for Svelte 5 runes instead of React hooks.
 *
 * Must be called from browser-rendered code (a root +layout.svelte's
 * script, guarded by `browser` from $app/environment already applied
 * here) — Convex's client and better-auth's session store aren't
 * meant to run during SSR.
 */
export function createPlatformAuth(config: PlatformAuthConfig): PlatformAuthInstance {
  // better-auth's client requires an absolute URL. In the browser that's
  // this page's own origin (so requests hit the proxy in hooks.server.ts);
  // during SSR nothing here is ever dereferenced (session comes from
  // getServerSession in server.ts instead), so any valid absolute URL
  // satisfies the constructor.
  const basePath = config.authBasePath ?? "/api/auth";
  const baseURL = browser
    ? new URL(basePath, window.location.origin).toString()
    : new URL(basePath, "http://localhost").toString();

  const authClient = createAuthClient({
    baseURL,
    plugins: [convexClient()],
  });

  if (!browser) {
    return {
      authClient,
      convex: null,
      session: {
        get current(): SessionData | null | undefined {
          return undefined;
        },
        get isPending() {
          return true;
        },
      },
      refreshSession: async () => {},
    };
  }

  const convex = setupConvex(config.convexUrl);

  const sessionStore = authClient.useSession();
  let sessionState = $state(sessionStore.get());
  sessionStore.subscribe((value) => {
    sessionState = value;
  });

  setupAuth(() => ({
    isLoading: sessionState.isPending,
    isAuthenticated: Boolean(sessionState.data?.session),
    fetchAccessToken: async () => {
      const { data } = await authClient.convex.token({
        fetchOptions: { throw: false },
      });
      return data?.token ?? null;
    },
  }));

  return {
    authClient,
    convex,
    session: {
      get current(): SessionData | null | undefined {
        return sessionState.data as SessionData | null | undefined;
      },
      get isPending() {
        return sessionState.isPending;
      },
    },
    /**
     * Call after any sign-in/sign-up that didn't go through one of
     * authClient's own built-in methods — e.g. a custom tenant-scoped
     * endpoint called via plain fetch(). Better Auth's client only
     * auto-refreshes its session store for a hardcoded set of built-in
     * paths (/sign-in/email, /sign-up/email, /sign-out, ...); custom
     * plugin endpoints aren't in that list, so nothing tells
     * `useSession()` to refetch on its own. `$store.notify("$sessionSignal")`
     * is the same public signal Better Auth's own plugins use for this.
     *
     * Awaits the *actual* refetch settling (not just firing it) —
     * `notify()` alone kicks off an async fetch and returns immediately,
     * so code that calls `goto()` right after `notify()` without
     * awaiting anything can render the next page before the store
     * reflects the new session, which then wrongly reads as "logged
     * out" if that page checks `session.current` right away.
     */
    refreshSession: () => {
      authClient.$store.notify("$sessionSignal");
      return new Promise<void>((resolve) => {
        // subscribe() calls its listener synchronously with the current
        // value — if isPending is already false at subscribe time, the
        // listener fires before `unsubscribe` is assigned below
        // (ReferenceError: TDZ). Deferring the unsubscribe() call to a
        // microtask sidesteps that.
        let resolved = false;
        const unsubscribe = sessionStore.subscribe((value) => {
          if (value.isPending || resolved) return;
          resolved = true;
          resolve();
          queueMicrotask(() => unsubscribe());
        });
      });
    },
  };
}

export type PlatformAuth = ReturnType<typeof createPlatformAuth>;
