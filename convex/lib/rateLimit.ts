import { RateLimiter, MINUTE } from "@convex-dev/rate-limiter";
import { components } from "../_generated/api";

/**
 * Every rate-limit bucket this app uses. There were none before this file
 * (a security audit's own follow-up caught it — see docs/AUDIT.md) —
 * neither the public /v1 API nor Better Auth's sign-in had any throttling
 * at all, meaning both could be hammered as fast as the network allows.
 */
export const rateLimiter = new RateLimiter(components.rateLimiter, {
	// Public API — keyed by the caller's own hashed API key, so one
	// integration's burst never affects another organization's key. Token
	// bucket rather than a fixed window so a legitimate POS can burst
	// during a rush (e.g. several PUT .../customers/:id calls back to
	// back) without tripping the limit, while a sustained hammering
	// (brute-forcing coupon codes, scraping customer views) still gets
	// capped. 120/min sustained, burst capacity 200 — generous enough for
	// any real storefront/POS traffic pattern, still a real ceiling.
	// `shards: 10` spreads one key's counter across 10 documents instead
	// of 1 — found necessary live: a burst of genuinely concurrent
	// requests on the same key otherwise all try to update the exact same
	// document, and (unlike a plain top-level mutation) a conflict on a
	// ctx.runMutation call made from inside an httpAction is NOT
	// automatically retried by Convex, surfacing as an uncaught 500 rather
	// than a clean 429. Sharding doesn't eliminate that possibility, just
	// makes it rare enough for real traffic — see requireApiKey's own
	// fail-open handling in httpApiV1.ts for the remaining edge case.
	apiRequest: { kind: "token bucket", rate: 120, period: MINUTE, capacity: 200, shards: 10 },

	// Better Auth sign-in — keyed by the email being signed into (not by
	// IP; Better Auth's own built-in limiter, enabled separately in
	// auth.ts, already covers the IP dimension). A per-account bucket
	// means a distributed attacker rotating source IPs against ONE known
	// email still hits a wall, which a purely IP-keyed limit alone
	// wouldn't catch. Loose on purpose (5 attempts / 5 min) — this is a
	// backstop against sustained/distributed brute force, not the first
	// line of defense against a single fast burst (the IP-based limiter
	// handles that). Sharded for the same reason as apiRequest above —
	// several browser tabs/devices signing into the same account at once
	// is a real, not even adversarial, scenario.
	accountSignInAttempt: { kind: "token bucket", rate: 5, period: 5 * MINUTE, capacity: 5, shards: 3 }
});
