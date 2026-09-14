/**
 * Shared types only — no business logic. Mirrors whatever fields your
 * backend embeds on the Better Auth user doc (restaurantId/organizationId/
 * accountType in the reference implementation this package was extracted
 * from — rename/extend as needed for your own tenant model). Kept here so
 * every app renders/guards against the same shape instead of
 * re-declaring it.
 */

export type AccountType = "customer" | "staff";

/**
 * Role ladder for staff accounts (employee < manager < owner < org_admin
 * in the reference implementation). Not itself embedded on the session —
 * the session only carries `accountType`; specific role assignments live
 * server-side (e.g. in a Convex authorization component) and are checked
 * per-request, not read out of the JWT. Exported here purely as a shared
 * type for UI code that displays/selects a role.
 */
export type StaffRole = "employee" | "manager" | "owner" | "org_admin";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  image?: string | null;
  restaurantId?: string;
  organizationId?: string;
  accountType?: AccountType;
};

export type SessionData = {
  session: {
    id: string;
    userId: string;
    expiresAt: string;
    token: string;
  };
  user: SessionUser;
};

export type PlatformAuthConfig = {
  /** Convex deployment URL used by the Convex client (e.g. PUBLIC_CONVEX_URL). */
  convexUrl: string;
  /**
   * Origin + basePath the browser's auth client talks to. Left relative
   * ("/api/auth") so requests hit this app's own origin and are proxied
   * server-side to Convex (see server.ts) — that's what makes the
   * session cookie first-party for this app's domain.
   */
  authBasePath?: string;
};

export type PlatformAuthServerConfig = {
  /** Convex HTTP actions URL Better Auth is actually hosted on (e.g. CONVEX_SITE_URL). */
  convexSiteUrl: string;
  authBasePath?: string;
};
