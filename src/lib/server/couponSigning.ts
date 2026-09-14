import { createHmac, timingSafeEqual } from 'node:crypto';
import { WALLET_SIGNING_SECRET } from '$env/static/private';

/**
 * §7 OPEN item, resolved: coupon QR/barcode payloads are signed so a
 * screenshotted or hand-edited code is rejected before it ever reaches
 * the database. The payload embedded in the pass's barcode is
 * `<code>.<signature>`; plain unsigned codes (staff typing a code in at
 * the POS) still work — the signature only gates the wallet-pass path.
 */
export function signCouponPayload(code: string): string {
	const signature = createHmac('sha256', WALLET_SIGNING_SECRET).update(code).digest('base64url');
	return `${code}.${signature}`;
}

/** Verifies a scanned payload and returns the underlying code, or null if invalid/tampered. */
export function verifySignedCouponPayload(payload: string): string | null {
	const separatorIndex = payload.lastIndexOf('.');
	if (separatorIndex === -1) return null;

	const code = payload.slice(0, separatorIndex);
	const providedSignature = payload.slice(separatorIndex + 1);
	const expectedSignature = createHmac('sha256', WALLET_SIGNING_SECRET).update(code).digest('base64url');

	const a = Buffer.from(providedSignature);
	const b = Buffer.from(expectedSignature);
	if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

	return code;
}

/**
 * Accepts either a signed payload (`code.sig`, from a scanned wallet
 * barcode) or a plain code (typed in at the POS). Generated codes never
 * contain a dot, so a dot's presence means "this must verify" — falling
 * through to a raw DB lookup on a bad signature would just re-query with
 * garbage, but rejecting explicitly gives a clearer error than 404.
 */
export function resolveRedeemCode(codeOrPayload: string): { code: string } | { error: 'INVALID_SIGNATURE' } {
	if (!codeOrPayload.includes('.')) {
		return { code: codeOrPayload };
	}

	const verified = verifySignedCouponPayload(codeOrPayload);
	return verified ? { code: verified } : { error: 'INVALID_SIGNATURE' };
}
