"use node";

// Apple Wallet .pkpass generation — the only file in this codebase that
// needs the Node runtime, because node-forge's PKCS#7 detached-signature
// support (required for Apple's manifest.json signing) relies on Node's
// Buffer/crypto internals; Web Crypto has no CMS/PKCS#7 primitive.
//
// Ships a single default (non-per-org-customizable) design — solid ink-
// colored square icons generated on the fly (see lib/wallet/simplePng.ts)
// rather than real branding assets, since no dashboard template-editing
// UI exists yet. No webServiceURL/push-update registration is included —
// this generates a static pass on every request; auto-updating passes
// (Apple's device-registration protocol, backed by the already-existing
// passRegistrations table) is a follow-up, not this phase.
//
// Returns everything base64-encoded because action return values cross a
// JSON boundary back to the calling httpAction (convex/httpWallet.ts).

import * as forge from "node-forge";
import { zipSync } from "fflate";
import { createHash } from "node:crypto";
import { v, ConvexError } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { solidColorPng } from "./lib/wallet/simplePng";
import { WALLET_NOT_CONFIGURED } from "./lib/wallet/errors";

// A plain `Error` subclass doesn't reliably survive the ctx.runAction
// boundary back to the calling httpAction (convex/httpWallet.ts) — only
// ConvexError's structured `.data` is guaranteed to cross intact, so
// "not configured" is signaled with the same ConvexError({code, message})
// convention used everywhere else in this codebase, not a custom class.

function requiredAppleEnv() {
	const passTypeId = process.env.APPLE_PASS_TYPE_ID;
	const teamId = process.env.APPLE_TEAM_ID;
	const certPem = process.env.APPLE_PASS_CERT_PEM;
	const keyPem = process.env.APPLE_PASS_KEY_PEM;
	const wwdrPem = process.env.APPLE_WWDR_CERT_PEM;
	if (!passTypeId || !teamId || !certPem || !keyPem || !wwdrPem) {
		throw new ConvexError({
			code: WALLET_NOT_CONFIGURED,
			message:
				"Apple Wallet is not configured — missing Pass Type ID / Team ID / certificate / private key / WWDR certificate."
		});
	}
	return { passTypeId, teamId, certPem, keyPem, wwdrPem, passphrase: process.env.APPLE_PASS_KEY_PASSPHRASE };
}

function rgbFromCss(color: string): [number, number, number] {
	const match = color.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
	if (!match) return [27, 36, 48];
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function sha1Hex(buf: Buffer): string {
	return createHash("sha1").update(buf).digest("hex");
}

function signManifest(manifest: Buffer, env: ReturnType<typeof requiredAppleEnv>): Buffer {
	const signerCert = forge.pki.certificateFromPem(env.certPem);
	const wwdrCert = forge.pki.certificateFromPem(env.wwdrPem);
	const privateKey = env.passphrase
		? forge.pki.decryptRsaPrivateKey(env.keyPem, env.passphrase)
		: forge.pki.privateKeyFromPem(env.keyPem);

	const p7 = forge.pkcs7.createSignedData();
	p7.content = forge.util.createBuffer(manifest.toString("binary"), "raw");
	p7.addCertificate(signerCert);
	p7.addCertificate(wwdrCert);
	p7.addSigner({
		key: privateKey,
		certificate: signerCert,
		digestAlgorithm: forge.pki.oids.sha256,
		authenticatedAttributes: [
			{ type: forge.pki.oids.contentType, value: forge.pki.oids.data },
			{ type: forge.pki.oids.messageDigest },
			{ type: forge.pki.oids.signingTime }
		]
	});
	p7.sign({ detached: true });

	const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
	return Buffer.from(der, "binary");
}

export const buildApplePassBase64 = internalAction({
	args: { customerId: v.id("customers") },
	handler: async (ctx, args): Promise<string> => {
		const env = requiredAppleEnv(); // throws first — no point building the pass if it can't be signed

		const passData = await ctx.runQuery(internal.wallet.getPassData, { customerId: args.customerId });

		const barcodeMessage = args.customerId; // plain customer id is enough here — not a redeemable coupon code, just an identifier the POS can look up

		const passJson = {
			formatVersion: 1,
			passTypeIdentifier: env.passTypeId,
			teamIdentifier: env.teamId,
			serialNumber: passData.customerId,
			organizationName: passData.organizationName,
			description: `${passData.organizationName} Loyalty Card`,
			backgroundColor: passData.backgroundColor,
			foregroundColor: passData.foregroundColor,
			storeCard: {
				primaryFields: [{ key: "points", label: "Points", value: passData.pointBalance }],
				secondaryFields: passData.tierName
					? [{ key: "tier", label: "Tier", value: passData.tierName }]
					: [],
				auxiliaryFields: [{ key: "member", label: "Member", value: passData.customerName }],
				backFields: [
					{
						key: "about",
						label: "About",
						value: "Show this card at checkout to earn and redeem rewards."
					}
				]
			},
			barcodes: [{ format: "PKBarcodeFormatQR", message: barcodeMessage, messageEncoding: "iso-8859-1" }]
		};

		const rgb = rgbFromCss(passData.foregroundColor);
		const icon = solidColorPng(29, rgb);
		const icon2x = solidColorPng(58, rgb);
		const logo = solidColorPng(160, rgb);

		const files: Record<string, Buffer> = {
			"pass.json": Buffer.from(JSON.stringify(passJson)),
			"icon.png": icon,
			"icon@2x.png": icon2x,
			"logo.png": logo
		};

		const manifest: Record<string, string> = {};
		for (const [name, data] of Object.entries(files)) manifest[name] = sha1Hex(data);
		const manifestBuf = Buffer.from(JSON.stringify(manifest));

		const signature = signManifest(manifestBuf, env);

		const zipInput: Record<string, Uint8Array> = { "manifest.json": manifestBuf, signature };
		for (const [name, data] of Object.entries(files)) zipInput[name] = data;

		const zipped = zipSync(zipInput, { level: 0 }); // STORE only — pkpass files are typically uncompressed
		return Buffer.from(zipped).toString("base64");
	}
});
