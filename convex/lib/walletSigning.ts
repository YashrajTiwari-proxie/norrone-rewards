// HMAC-signed, short-lived tokens for the wallet-pass HTTP endpoints
// (convex/httpWallet.ts). Same Web Crypto HMAC approach as couponSigning.ts
// — reuses WALLET_SIGNING_SECRET rather than provisioning a second secret.
// Token-based (not a Better Auth session or API key) so the resulting link
// works when a customer opens it directly on their phone, outside any
// dashboard session, and expires on its own rather than needing revocation.

function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

async function hmacSign(secret: string, message: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"]
	);
	const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
	let binary = "";
	for (const byte of new Uint8Array(signature)) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 minutes — plenty to load a wallet page

/** `${customerId}.${expiresAtMs}.${signature}`, base64url-safe (no `.` in any part but the separators). */
export async function signWalletToken(customerId: string, ttlMs = DEFAULT_TTL_MS): Promise<string> {
	const secret = process.env.WALLET_SIGNING_SECRET;
	if (!secret) throw new Error("WALLET_SIGNING_SECRET is not configured");
	const expiresAt = Date.now() + ttlMs;
	const payload = `${customerId}.${expiresAt}`;
	return `${payload}.${await hmacSign(secret, payload)}`;
}

export async function verifyWalletToken(token: string): Promise<{ customerId: string } | { error: string }> {
	const secret = process.env.WALLET_SIGNING_SECRET;
	if (!secret) return { error: "WALLET_SIGNING_SECRET is not configured" };

	const parts = token.split(".");
	if (parts.length !== 3) return { error: "Malformed token" };
	const [customerId, expiresAtStr, signature] = parts;

	const payload = `${customerId}.${expiresAtStr}`;
	const expected = await hmacSign(secret, payload);
	if (!timingSafeEqual(signature, expected)) return { error: "Invalid signature" };

	const expiresAt = Number(expiresAtStr);
	if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return { error: "Token expired" };

	return { customerId };
}
