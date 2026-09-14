// Port of src/lib/server/couponSigning.ts onto Web Crypto (HMAC via
// crypto.subtle instead of node:crypto), for the same reason as
// lib/apiKeys.ts. Wallet-pass issuance itself is still paused, but the
// redeem endpoint should already accept a signed payload the moment
// wallet passes start emitting one — so this ports now rather than later.

function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) {
		diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
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

export async function signCouponPayload(code: string): Promise<string> {
	const secret = process.env.WALLET_SIGNING_SECRET;
	if (!secret) throw new Error("WALLET_SIGNING_SECRET is not configured");
	return `${code}.${await hmacSign(secret, code)}`;
}

async function verifySignedCouponPayload(payload: string): Promise<string | null> {
	const secret = process.env.WALLET_SIGNING_SECRET;
	if (!secret) return null;
	const separatorIndex = payload.lastIndexOf(".");
	if (separatorIndex === -1) return null;

	const code = payload.slice(0, separatorIndex);
	const providedSignature = payload.slice(separatorIndex + 1);
	const expectedSignature = await hmacSign(secret, code);

	return timingSafeEqual(providedSignature, expectedSignature) ? code : null;
}

/**
 * Accepts either a signed payload (`code.sig`, from a scanned wallet
 * barcode) or a plain code (typed in at the POS). Generated codes never
 * contain a dot, so a dot's presence means "this must verify".
 */
export async function resolveRedeemCode(
	codeOrPayload: string
): Promise<{ code: string } | { error: "INVALID_SIGNATURE" }> {
	if (!codeOrPayload.includes(".")) {
		return { code: codeOrPayload };
	}
	const verified = await verifySignedCouponPayload(codeOrPayload);
	return verified ? { code: verified } : { error: "INVALID_SIGNATURE" };
}
