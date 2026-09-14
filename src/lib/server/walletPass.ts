/**
 * Apple/Google wallet pass generation (§7). Not wired up yet — needs an
 * Apple Pass Type ID certificate + WWDR certificate + private key, and a
 * Google Wallet Issuer account + service account key, none of which exist
 * in this environment. Every route below returns 503 until the relevant
 * env vars are set; the shape of what to build is documented here so
 * wiring in real credentials later is a small change, not a redesign.
 *
 * Apple: build pass.json (generic/storeCard fields, webServiceURL pointing
 * at /v1/wallet/apple/v1/..., authenticationToken, barcode.message = the
 * signed coupon payload from couponSigning.ts for coupon passes), zip it
 * with the icons from pass_templates, sign the manifest with the Pass
 * Type ID cert + WWDR cert (PKCS#7 detached signature), return the
 * .pkpass binary with `application/vnd.apple.pkpass`.
 *
 * Google: build a LoyaltyClass/LoyaltyObject (or GenericObject for
 * coupons) via the Google Wallet REST API using a service-account JWT,
 * then return a "Add to Google Wallet" link (a signed JWT save URL) or
 * redirect to it.
 */

const APPLE_CONFIGURED = false; // flips true once cert/key env vars are wired in
const GOOGLE_CONFIGURED = false; // flips true once the service account key is wired in

export class WalletNotConfiguredError extends Error {}

export function assertAppleWalletConfigured() {
	if (!APPLE_CONFIGURED) {
		throw new WalletNotConfiguredError(
			'Apple Wallet is not configured — missing Pass Type ID certificate / WWDR certificate / private key.'
		);
	}
}

export function assertGoogleWalletConfigured() {
	if (!GOOGLE_CONFIGURED) {
		throw new WalletNotConfiguredError(
			'Google Wallet is not configured — missing service account credentials.'
		);
	}
}
