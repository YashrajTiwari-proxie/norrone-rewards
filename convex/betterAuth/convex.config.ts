import { defineComponent } from "convex/server";

// Local wrapper, mirroring admin-panel-v2's pattern — @convex-dev/better-auth
// expects the *consuming app* to register its own named component instance
// (not import a shared one), so this thin file is what auth.ts's
// createClient(components.betterAuth, ...) actually points at.
const component = defineComponent("betterAuth");

export default component;
