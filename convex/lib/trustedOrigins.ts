// Browser origins Better Auth's CORS check trusts. Production origins come
// from an env var so they're set per-deployment (`npx convex env set
// TRUSTED_ORIGINS "https://app.norrone.example"`), never hardcoded here —
// only the local Vite dev port is a permanent entry.
export const trustedOrigins = (process.env.TRUSTED_ORIGINS ?? "")
	.split(",")
	.map((o) => o.trim())
	.filter(Boolean)
	.concat(["http://localhost:5173", "http://127.0.0.1:5173"]);
