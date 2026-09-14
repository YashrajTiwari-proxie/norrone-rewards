import adapter from '@sveltejs/adapter-vercel';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// Pinned to Vercel explicitly (was adapter-auto) — faster installs,
			// no mid-build adapter download, and lets us set Vercel-specific
			// options here if needed later. See https://svelte.dev/docs/kit/adapter-vercel.
			adapter: adapter()
		})
	]
});
