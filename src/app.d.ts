// See https://svelte.dev/docs/kit/types#app.d.ts
import type { SessionData } from '@proxie-studio/better-auth-tenant-kit';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			session: SessionData | null;
		}
		interface PageData {
			session: SessionData | null;
		}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
