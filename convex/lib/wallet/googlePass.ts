// Google Wallet "Save to Google Wallet" link + per-org LoyaltyClass
// management — a signed JWT and plain REST calls, not a binary artifact,
// so unlike Apple's pass this needs no Node runtime: `jose` signs RS256
// over Web Crypto, fitting this codebase's existing pattern
// (couponSigning.ts) of preferring crypto.subtle over node:crypto.
import { SignJWT, importPKCS8 } from "jose";
import { ConvexError } from "convex/values";
import { WALLET_NOT_CONFIGURED } from "./errors";

type PassData = {
	customerId: string;
	organizationId: string;
	customerName: string;
	organizationName: string;
	pointBalance: number;
	tierName: string | null;
	membershipPlanName: string | null;
	membershipExpiryDate: number | null; // epoch ms
	backgroundColor: string; // hex, e.g. "#1b2430"
	googleClassId: string | null; // set once the org has its own branded class — see ensureLoyaltyClass
};

type ServiceAccount = { client_email: string; private_key: string };

function requiredGoogleEnv(): { issuerId: string; defaultClassId: string; serviceAccount: ServiceAccount } {
	const issuerId = process.env.GOOGLE_WALLET_ISSUER_ID;
	const classId = process.env.GOOGLE_WALLET_CLASS_ID;
	const serviceAccountJson = process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_JSON;
	if (!issuerId || !serviceAccountJson) {
		throw new ConvexError({
			code: WALLET_NOT_CONFIGURED,
			message: "Google Wallet is not configured — missing issuer id or service account credentials."
		});
	}
	let parsed: { client_email?: string; private_key?: string };
	try {
		parsed = JSON.parse(serviceAccountJson);
	} catch {
		throw new ConvexError({
			code: WALLET_NOT_CONFIGURED,
			message: "GOOGLE_WALLET_SERVICE_ACCOUNT_JSON is not valid JSON."
		});
	}
	if (!parsed.client_email || !parsed.private_key) {
		throw new ConvexError({
			code: WALLET_NOT_CONFIGURED,
			message: "GOOGLE_WALLET_SERVICE_ACCOUNT_JSON is missing client_email/private_key."
		});
	}
	// defaultClassId is used by any org that hasn't customized its pass
	// template yet — `${issuerId}.norrone_loyalty_default`, created once
	// (see README's wallet setup guide), unless overridden.
	return {
		issuerId,
		defaultClassId: classId ?? `${issuerId}.norrone_loyalty_default`,
		serviceAccount: parsed as ServiceAccount
	};
}

async function getAccessToken(serviceAccount: ServiceAccount): Promise<string> {
	const key = await importPKCS8(serviceAccount.private_key, "RS256");
	const now = Math.floor(Date.now() / 1000);
	const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/wallet_object.issuer" })
		.setProtectedHeader({ alg: "RS256" })
		.setIssuedAt(now)
		.setExpirationTime(now + 3600)
		.setIssuer(serviceAccount.client_email)
		.setAudience("https://oauth2.googleapis.com/token")
		.sign(key);

	const res = await fetch("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
			assertion
		})
	});
	const body = await res.json();
	if (!res.ok) {
		throw new Error(`Google OAuth token exchange failed: ${res.status} ${JSON.stringify(body)}`);
	}
	return body.access_token as string;
}

const POWERED_BY_MODULE = { header: "", body: "Powered by Norrone" };

function loyaltyTextModules(passData: Pick<PassData, "tierName" | "membershipPlanName" | "membershipExpiryDate">) {
	const modules: { header: string; body: string }[] = [];
	if (passData.tierName) modules.push({ header: "Tier", body: passData.tierName });
	if (passData.membershipPlanName) {
		const expiry = passData.membershipExpiryDate
			? ` (expires ${new Date(passData.membershipExpiryDate).toLocaleDateString()})`
			: "";
		modules.push({ header: "Membership", body: `${passData.membershipPlanName}${expiry}` });
	}
	modules.push(POWERED_BY_MODULE);
	return modules;
}

function loyaltyObjectFor(passData: PassData, classId: string, issuerId: string) {
	return {
		id: `${issuerId}.${passData.customerId}`,
		classId,
		state: "ACTIVE",
		accountName: passData.customerName,
		accountId: passData.customerId,
		loyaltyPoints: { label: "Points", balance: { string: String(passData.pointBalance) } },
		textModulesData: loyaltyTextModules(passData),
		hexBackgroundColor: passData.backgroundColor,
		// Carries the same customer id used everywhere else in this codebase
		// to identify a customer — same value Apple's barcode encodes, so a
		// POS scanning either pass looks up the same record. PDF417 (a
		// linear barcode), not QR, to match typical POS scanner expectations
		// for a loyalty/membership card.
		barcode: { type: "PDF_417", value: passData.customerId }
	};
}

export async function buildGoogleSaveUrl(passData: PassData): Promise<string> {
	const env = requiredGoogleEnv();
	const classId = passData.googleClassId ?? env.defaultClassId;
	const loyaltyObject = loyaltyObjectFor(passData, classId, env.issuerId);

	const key = await importPKCS8(env.serviceAccount.private_key, "RS256");
	const jwt = await new SignJWT({
		iss: env.serviceAccount.client_email,
		aud: "google",
		typ: "savetowallet",
		payload: { loyaltyObjects: [loyaltyObject] }
	} as Record<string, unknown>)
		.setProtectedHeader({ alg: "RS256" })
		.setIssuedAt()
		.sign(key);

	return `https://pay.google.com/gp/v/save/${jwt}`;
}

/**
 * Pushes fresh points/tier onto an already-saved loyaltyObject so a
 * customer's pass updates on their phone without them re-tapping "Add to
 * Google Wallet" — unlike Apple, Google Wallet objects live server-side,
 * so an authenticated PATCH is all "auto-update" requires here. A 404
 * (customer never saved the pass) is expected and not an error — there's
 * nothing to update yet.
 */
export async function patchLoyaltyObject(passData: PassData): Promise<{ updated: boolean }> {
	const env = requiredGoogleEnv();
	const classId = passData.googleClassId ?? env.defaultClassId;
	const objectId = `${env.issuerId}.${passData.customerId}`;
	const accessToken = await getAccessToken(env.serviceAccount);

	const res = await fetch(`https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject/${objectId}`, {
		method: "PATCH",
		headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
		body: JSON.stringify(loyaltyObjectFor(passData, classId, env.issuerId))
	});
	if (res.status === 404) return { updated: false };
	if (!res.ok) {
		const body = await res.json().catch(() => null);
		throw new Error(`Google Wallet object update failed: ${res.status} ${JSON.stringify(body)}`);
	}
	return { updated: true };
}

/**
 * Creates (or updates, if it already exists) a LoyaltyClass branded for
 * one organization — Google's class-level fields (logo, name, color) are
 * shared by every customer's loyaltyObject that references it, so a
 * custom template needs its own class rather than editing the shared
 * default. Called from passTemplates.ts's save action whenever an org
 * updates its branding; returns the class id to store on that org's
 * passTemplates row.
 */
export async function ensureLoyaltyClass(input: {
	organizationId: string;
	organizationName: string;
	logoUrl: string | null;
	backgroundColor: string;
	// Pre-generated (see walletNode.ts's generateHeroImageUrl) — this file
	// has no Node runtime access to build the PNG itself, only to host a
	// URL Google can fetch from.
	heroImageUrl: string | null;
}): Promise<string> {
	const env = requiredGoogleEnv();
	const classId = `${env.issuerId}.org_${input.organizationId}`;
	const accessToken = await getAccessToken(env.serviceAccount);

	// Google rejects class creation without a programLogo entirely, so an
	// org that hasn't uploaded one yet still gets the platform default —
	// same fallback the default shared class itself uses.
	const logoUrl = input.logoUrl ?? `${process.env.SITE_URL ?? "https://norrone-rewards-better-auth-tenant.vercel.app"}/wallet-logo.png`;

	const classBody = {
		id: classId,
		// issuerName renders as a small, always-visible line near the top
		// of the card (unlike textModulesData, which is tucked into an
		// expandable details section) — this is the one prominent, no-tap
		// spot to put "Powered by Norrone" on Google's side.
		issuerName: "Powered by Norrone",
		programName: input.organizationName,
		reviewStatus: "UNDER_REVIEW",
		hexBackgroundColor: input.backgroundColor,
		programLogo: { sourceUri: { uri: logoUrl } },
		homepageUri: { uri: "https://norrone-rewards-better-auth-tenant.vercel.app", description: "Powered by Norrone" },
		// Google's one real design surface beyond flat color + logo — see
		// docs/WALLET_PASS_REDESIGN_PLAN.md. Omitted entirely (rather than
		// pointing at a broken URL) if generation failed upstream.
		...(input.heroImageUrl ? { heroImage: { sourceUri: { uri: input.heroImageUrl } } } : {})
	};

	// Try update first (most calls after the first are updates); fall back
	// to insert on a 404 the first time this org saves a template.
	const patchRes = await fetch(
		`https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass/${classId}`,
		{
			method: "PATCH",
			headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
			body: JSON.stringify(classBody)
		}
	);
	if (patchRes.ok) return classId;
	if (patchRes.status !== 404) {
		const body = await patchRes.json().catch(() => null);
		throw new Error(`Google Wallet class update failed: ${patchRes.status} ${JSON.stringify(body)}`);
	}

	const createRes = await fetch("https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass", {
		method: "POST",
		headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
		body: JSON.stringify(classBody)
	});
	if (!createRes.ok) {
		const body = await createRes.json().catch(() => null);
		throw new Error(`Google Wallet class creation failed: ${createRes.status} ${JSON.stringify(body)}`);
	}
	return classId;
}
