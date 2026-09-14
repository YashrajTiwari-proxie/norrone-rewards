// Every page below this layout reads/writes through Convex's reactive
// client (convex-svelte's useQuery/useMutation), which requires
// setupConvex() to have run in a browser — see root +layout.svelte.
// Disabling SSR for the whole app is the standard way to use Convex from
// SvelteKit (there's no server-side Convex subscription story here);
// +layout.server.ts's session check still runs server-side either way —
// only the page HTML itself is no longer pre-rendered.
export const ssr = false;
