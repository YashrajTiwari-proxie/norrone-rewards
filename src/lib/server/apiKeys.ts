import { randomBytes, createHash } from 'node:crypto';

export type ApiKeyType = 'secret' | 'publishable';

const PREFIX: Record<ApiKeyType, string> = {
	secret: 'sk_',
	publishable: 'pk_'
};

/** Generates a new plaintext API key. Show it to the user exactly once — only the hash is stored. */
export function generateApiKey(type: ApiKeyType): string {
	return `${PREFIX[type]}${randomBytes(24).toString('base64url')}`;
}

export function hashApiKey(plaintextKey: string): string {
	return createHash('sha256').update(plaintextKey).digest('hex');
}

export function apiKeyTypeFromPlaintext(plaintextKey: string): ApiKeyType | null {
	if (plaintextKey.startsWith(PREFIX.secret)) return 'secret';
	if (plaintextKey.startsWith(PREFIX.publishable)) return 'publishable';
	return null;
}
