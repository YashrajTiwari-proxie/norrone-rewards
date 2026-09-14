import { defineConfig } from 'vitest/config';

// Unit/integration tests for Convex functions (convex/**/*.test.ts), run
// against convex-test's in-memory backend — real schema, real indexes,
// real transactional semantics, no network. Svelte component tests aren't
// covered here; end-to-end UI flows are covered by Playwright (test:e2e).
export default defineConfig({
	test: {
		environment: 'edge-runtime',
		// macOS AppleDouble shadow files (._foo.test.ts) litter this repo
		// and otherwise match the include glob just as well as the real file.
		include: ['convex/**/*.test.ts'],
		exclude: ['**/._*', '**/node_modules/**']
	}
});
