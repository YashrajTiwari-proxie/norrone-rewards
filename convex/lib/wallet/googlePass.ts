// Google Wallet "Save to Google Wallet" link — a signed JWT, not a binary
// artifact, so unlike Apple's pass this needs no Node runtime: `jose`
// signs RS256 over Web Crypto, fitting this codebase's existing pattern
// (couponSigning.ts) of preferring crypto.subtle over node:crypto.
import { SignJWT, importPKCS8 } from "jose";
import { ConvexError } from "convex/values";
import { WALLET_NOT_CONFIGURED } from "./errors";

type PassData = {
	customerId: string;
	customerName: string;
	organizationName: string;
	pointBalance: number;
	tierName: string | null;
	backgroundColor: string;
};

function requiredGoogleEnv() {
	const issuerId = process.env.GOOGLE_WALLET_ISSUER_ID;
	const classId = process.env.GOOGLE_WALLET_CLASS_ID;
	const serviceAccountJson = process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_JSON;
	if (!issuerId || !serviceAccountJson) {
		throw new ConvexError({
			code: WALLET_NOT_CONFIGURED,
			message: "Google Wallet is not configured — missing issuer id or service account credentials."
		});
	}
	let serviceAccount: { client_email?: string; private_key?: string };
	try {
		serviceAccount = JSON.parse(serviceAccountJson);
	} catch {
		throw new ConvexError({
			code: WALLET_NOT_CONFIGURED,
			message: "GOOGLE_WALLET_SERVICE_ACCOUNT_JSON is not valid JSON."
		});
	}
	if (!serviceAccount.client_email || !serviceAccount.private_key) {
		throw new ConvexError({
			code: WALLET_NOT_CONFIGURED,
			message: "GOOGLE_WALLET_SERVICE_ACCOUNT_JSON is missing client_email/private_key."
		});
	}
	// classId defaults to `${issuerId}.norrone_loyalty_default` — Google Wallet
	// classes must be created once via the Wallet API before objects can
	// reference them; out of scope here (default-design pipeline only).
	return { issuerId, classId: classId ?? `${issuerId}.norrone_loyalty_default`, serviceAccount };
}

export async function buildGoogleSaveUrl(passData: PassData): Promise<string> {
	const env = requiredGoogleEnv();

	const objectId = `${env.issuerId}.${passData.customerId}`;
	const loyaltyObject = {
		id: objectId,
		classId: env.classId,
		state: "ACTIVE",
		accountName: passData.customerName,
		accountId: passData.customerId,
		loyaltyPoints: { label: "Points", balance: { string: String(passData.pointBalance) } },
		textModulesData: passData.tierName ? [{ header: "Tier", body: passData.tierName }] : undefined,
		hexBackgroundColor: passData.backgroundColor.startsWith("#") ? passData.backgroundColor : undefined
	};

	const key = await importPKCS8(env.serviceAccount.private_key!, "RS256");
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
