import { getContext, setContext } from 'svelte';
import type { PlatformAuth } from '@proxie-studio/better-auth-tenant-kit';

const KEY = Symbol('platformAuth');

export function setPlatformAuthContext(auth: PlatformAuth) {
	setContext(KEY, auth);
}

export function getPlatformAuthContext(): PlatformAuth {
	const auth = getContext<PlatformAuth>(KEY);
	if (!auth) {
		throw new Error('platformAuth context not found — is this rendered under the root +layout.svelte?');
	}
	return auth;
}
