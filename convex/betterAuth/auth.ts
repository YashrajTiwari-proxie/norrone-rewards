import { createAuth } from "../auth";

// Used only by `npx auth generate` (the Better Auth CLI needs a top-level
// `auth` export to introspect the schema/config) — never imported at runtime.
export const auth = createAuth({} as any);
