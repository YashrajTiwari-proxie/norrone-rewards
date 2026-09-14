import { error, redirect } from "@sveltejs/kit";
import type { Handle, RequestEvent } from "@sveltejs/kit";
import type { AccountType, PlatformAuthServerConfig, SessionData } from "./types.js";

const DEFAULT_BASE_PATH = "/api/auth";

/**
 * SvelteKit `Handle` for hooks.server.ts. Proxies every /api/auth/*
 * request to the Convex deployment Better Auth actually runs on,
 * forwarding cookies and headers both ways.
 *
 * Why a proxy instead of pointing the browser straight at Convex: Better
 * Auth's session cookie is set on whichever origin issues the response.
 * If the browser talked to Convex's site URL directly, the cookie would
 * be third-party to this app's own origin, breaking normal first-party
 * SSR cookie reads (and running into stricter SameSite/browser privacy
 * rules for no reason). Proxying server-side makes the cookie
 * first-party for this app while Convex stays the single source of
 * truth for the session itself.
 */
export function createAuthProxyHandle(config: PlatformAuthServerConfig): Handle {
  const basePath = config.authBasePath ?? DEFAULT_BASE_PATH;
  return async ({ event, resolve }) => {
    if (!event.url.pathname.startsWith(basePath)) {
      return resolve(event);
    }

    const target = new URL(
      event.url.pathname + event.url.search,
      config.convexSiteUrl,
    );

    const headers = new Headers(event.request.headers);
    headers.delete("host");
    headers.delete("content-length");
    // Force an uncompressed upstream response instead of forwarding the
    // browser's own Accept-Encoding. When Convex sits behind Cloudflare,
    // Cloudflare can compress with zstd — and this SvelteKit dev server's
    // fetch (whatever wraps/polyfills the global fetch under Vite) was
    // observed to NOT transparently decode a zstd body the way a plain
    // Bun script's fetch does, even via arrayBuffer()/text(). Since
    // content-encoding is already stripped below (this response is never
    // encoded either way), asking the upstream not to compress at all
    // sidesteps the whole "does our runtime decode X" question rather
    // than depending on it. Session/JSON payloads here are tiny, so the
    // bandwidth cost of skipping compression is negligible.
    headers.set("accept-encoding", "identity");

    const upstream = await fetch(target, {
      method: event.request.method,
      headers,
      body:
        event.request.method === "GET" || event.request.method === "HEAD"
          ? undefined
          : await event.request.arrayBuffer(),
      redirect: "manual",
    });

    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.delete("content-encoding");
    responseHeaders.delete("content-length");

    const body = await upstream.arrayBuffer();
    const response = new Response(body, {
      status: upstream.status,
      headers: responseHeaders,
    });

    // Headers.set("set-cookie", ...) overwrites; each cookie needs its
    // own append, and older runtimes don't expose getSetCookie().
    responseHeaders.delete("set-cookie");
    const setCookies =
      typeof upstream.headers.getSetCookie === "function"
        ? upstream.headers.getSetCookie()
        : upstream.headers.get("set-cookie")
          ? [upstream.headers.get("set-cookie")!]
          : [];
    for (const cookie of setCookies) {
      response.headers.append("set-cookie", cookie);
    }

    return response;
  };
}

/**
 * Server-side session lookup for load functions — forwards the
 * incoming request's Cookie header to Convex's `/get-session` endpoint.
 * Never trust anything from the client here; this always re-validates
 * against Convex.
 */
export async function getServerSession(
  request: Request,
  config: PlatformAuthServerConfig,
): Promise<SessionData | null> {
  const basePath = config.authBasePath ?? DEFAULT_BASE_PATH;
  const cookie = request.headers.get("cookie");
  if (!cookie) {
    return null;
  }
  const response = await fetch(
    new URL(`${basePath}/get-session`, config.convexSiteUrl),
    // See createAuthProxyHandle's own comment on accept-encoding: identity —
    // same defense against an upstream zstd body this environment's fetch
    // won't reliably auto-decode.
    { headers: { cookie, "accept-encoding": "identity" } },
  );
  if (!response.ok) {
    return null;
  }
  const data = await response.json();
  return data && data.session ? (data as SessionData) : null;
}

/** Protected-route helper: redirects to /login if there's no session. */
export async function requireSession(
  event: RequestEvent,
  config: PlatformAuthServerConfig,
  redirectTo = "/login",
): Promise<SessionData> {
  const session = await getServerSession(event.request, config);
  if (!session) {
    throw redirect(303, redirectTo);
  }
  return session;
}

/** Protected-route helper: 403s if the session's accountType doesn't match. */
export async function requireAccountType(
  event: RequestEvent,
  config: PlatformAuthServerConfig,
  accountType: AccountType,
  redirectTo = "/login",
): Promise<SessionData> {
  const session = await requireSession(event, config, redirectTo);
  if (session.user.accountType !== accountType) {
    throw error(403, `This account is not a ${accountType} account`);
  }
  return session;
}

/**
 * Protected-route helper: 403s unless this is a staff session. Only
 * gates the UI shell — it can't tell you *which* role the staff member
 * holds or what they're allowed to do (that's not in the session), so
 * every staff-facing query/mutation on the backend still has to enforce
 * its own permission check independently. Use this to avoid rendering a
 * staff dashboard's layout to a customer session before that check runs.
 */
export async function requireStaff(
  event: RequestEvent,
  config: PlatformAuthServerConfig,
  redirectTo = "/login",
): Promise<SessionData> {
  return requireAccountType(event, config, "staff", redirectTo);
}
