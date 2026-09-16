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
import { solidColorPng, solidColorRectPng } from "./lib/wallet/simplePng";
import { WALLET_NOT_CONFIGURED } from "./lib/wallet/errors";
import { ICON_PNG_BASE64, ICON_2X_PNG_BASE64, ICON_3X_PNG_BASE64 } from "./lib/wallet/norroneIcon";
import { signPassAuthToken } from "./lib/walletSigning";
import { patchLoyaltyObject } from "./lib/wallet/googlePass";
import { sendApplePushNotification } from "./lib/wallet/apns";
import { hexToRgb, hexToRgbCss } from "./lib/wallet/color";

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
	return {
		passTypeId,
		teamId,
		certPem,
		keyPem,
		wwdrPem,
		passphrase: process.env.APPLE_PASS_KEY_PASSPHRASE,
		// Optional — auto-update (webServiceURL + APNs push) is a bonus on
		// top of a working pass, not a requirement, so this alone being
		// unset doesn't throw WALLET_NOT_CONFIGURED like the fields above.
		// Uses SITE_URL (the Vercel frontend, proxying /v1/... through to
		// Convex — see src/routes/v1/[...path]/+server.ts) rather than
		// CONVEX_SITE_URL directly: real-device testing showed Apple
		// Wallet's background networking stack (passd) silently failing to
		// complete HTTP/3 connections straight to Convex's `.site` domain
		// (via Cloudflare) — zero requests ever reached Convex, even though
		// curl against the same URL always worked (curl doesn't attempt
		// HTTP/3 by default, so it never exercised the failure). Routing
		// through Vercel's edge sidesteps that negotiation issue entirely.
		convexSiteUrl: process.env.SITE_URL
	};
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

		// Barcode carries the plain customer id — same value Google's pass
		// encodes — so a POS scanning either platform's pass looks up the
		// same record. Linked to the customer, not a one-time code.
		const barcodeMessage = args.customerId;

		const passJson: Record<string, unknown> = {
			formatVersion: 1,
			passTypeIdentifier: env.passTypeId,
			teamIdentifier: env.teamId,
			serialNumber: passData.customerId,
			organizationName: passData.organizationName,
			description: `${passData.organizationName} Loyalty Card`,
			backgroundColor: hexToRgbCss(passData.backgroundColor),
			foregroundColor: hexToRgbCss(passData.foregroundColor),
			labelColor: hexToRgbCss(passData.labelColor),
			// logoText is the text shown next to the logo image on the front
			// of the card — a separate field from organizationName (which
			// isn't rendered on the card itself, only in notifications/list
			// view). Without this, the org's name only ever showed up when
			// there was no logo image to fill that visual slot — adding a
			// real logo silently pushed it out. Always set explicitly now.
			logoText: passData.organizationName,
			storeCard: {
				// headerFields render top-right on the FRONT of the card,
				// next to the logo/org-name header — points live here so
				// they're visible at a glance without scrolling past the box.
				headerFields: [{ key: "points", label: "Points", value: passData.pointBalance }],
				// primaryFields renders as the single biggest, boldest text on
				// the card — used for the org's own name (again, larger than
				// the small header logoText) directly below the strip box.
				primaryFields: [{ key: "shopName", label: "", value: passData.organizationName }],
				secondaryFields: [
					{ key: "status", label: "Status", value: passData.status },
					{
						key: "since",
						label: `${passData.status} since`,
						value: new Date(passData.sinceDate).toLocaleDateString()
					}
				],
				auxiliaryFields: [
					{ key: "member", label: "Name", value: passData.customerName },
					...(passData.tierName ? [{ key: "tier", label: "Tier", value: passData.tierName }] : []),
					...(passData.membershipPlanName
						? [{ key: "membership", label: "Membership", value: passData.membershipPlanName }]
						: []),
					// Last auxiliary field renders lowest in the visible field
					// stack — the closest Apple's storeCard layout gets to a
					// "bottom of the front card" slot without flipping.
					{ key: "poweredByFront", label: "", value: "Powered by Norrone" }
				],
				backFields: [
					{
						key: "about",
						label: "About",
						value: "Show this card at checkout to earn and redeem rewards."
					},
					...(passData.membershipExpiryDate
						? [
								{
									key: "membershipExpiry",
									label: "Membership expires",
									value: new Date(passData.membershipExpiryDate).toLocaleDateString()
								}
							]
						: []),
					{ key: "poweredByBack", label: "", value: "Powered by Norrone" }
				]
			},
			barcodes: [
				{
					format: "PKBarcodeFormatPDF417",
					message: barcodeMessage,
					messageEncoding: "iso-8859-1",
					altText: passData.customerId.slice(-8).toUpperCase()
				}
			]
		};

		// Auto-update: if CONVEX_SITE_URL is set, wire up Apple's PassKit Web
		// Service protocol (convex/httpPassService.ts) so Wallet registers
		// this pass for push updates on install. Omitted entirely otherwise
		// — the pass still works, it just won't auto-refresh.
		//
		// The trailing slash on webServiceURL is required, not cosmetic —
		// Wallet builds the actual request paths via plain string
		// concatenation. Real-device syslog + Vercel logs proved Wallet's own
		// concatenation is `webServiceURL + "v1/devices/..."` — i.e. Wallet
		// itself appends the "v1/" version segment on top of whatever
		// webServiceURL already is. Setting webServiceURL to ".../v1/" (as
		// this used to) therefore produced ".../v1/v1/devices/..." — a
		// doubled prefix that our proxy dutifully forwarded and 404'd on.
		// webServiceURL must be just the bare site root with a trailing
		// slash; Wallet supplies "v1/..." itself.
		if (env.convexSiteUrl) {
			passJson.webServiceURL = `${env.convexSiteUrl}/`;
			passJson.authenticationToken = await signPassAuthToken(passData.customerId);
		}

		// The org's uploaded logo (passTemplates) is used as-is for the logo
		// slot — Apple scales/letterboxes to fit the frame, so this isn't
		// pixel-perfect but is a real logo instead of a flat square. Falls
		// back to a generated flat-color square in the foreground color
		// when the org hasn't uploaded one. The small icon slots always
		// show the Norrone mark — combined with the front-visible
		// headerField above, every pass is visibly "Powered by Norrone"
		// without needing to flip the card.
		const logo = passData.logoUrl
			? await (async () => {
					const logoRes = await fetch(passData.logoUrl!);
					if (!logoRes.ok) throw new Error(`Failed to fetch org logo: ${logoRes.status}`);
					return Buffer.from(await logoRes.arrayBuffer());
				})()
			: solidColorPng(160, hexToRgb(passData.foregroundColor));

		const files: Record<string, Buffer> = {
			"pass.json": Buffer.from(JSON.stringify(passJson)),
			"icon.png": Buffer.from(ICON_PNG_BASE64, "base64"),
			"icon@2x.png": Buffer.from(ICON_2X_PNG_BASE64, "base64"),
			"icon@3x.png": Buffer.from(ICON_3X_PNG_BASE64, "base64"),
			"logo.png": logo
		};

		// The full-width box below the header: the org's own uploaded banner
		// image, used exactly as-is (same single-file-no-@2x/@3x approach as
		// the logo above, since it's real art, not something we're
		// generating at multiple resolutions), or — when they haven't
		// uploaded one — a plain flat fill of their background color at
		// each real resolution. Never a generated shape or pattern.
		if (passData.bannerUrl) {
			const bannerRes = await fetch(passData.bannerUrl);
			if (!bannerRes.ok) throw new Error(`Failed to fetch org banner: ${bannerRes.status}`);
			files["strip.png"] = Buffer.from(await bannerRes.arrayBuffer());
		} else {
			const backgroundRgb = hexToRgb(passData.backgroundColor);
			files["strip.png"] = solidColorRectPng(320, 84, backgroundRgb);
			files["strip@2x.png"] = solidColorRectPng(640, 168, backgroundRgb);
			files["strip@3x.png"] = solidColorRectPng(960, 252, backgroundRgb);
		}

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

/**
 * Fires after any mutation that changes a customer's points/tier/
 * membership (see the ctx.scheduler.runAfter(0, ...) calls in
 * customerGrants.ts and engine.ts) — pushes the update to whichever
 * platforms are configured and actually have a saved/registered pass for
 * this customer. Best-effort throughout: a customer who never added
 * either wallet pass is the common case, not an error.
 */
export const pushWalletUpdates = internalAction({
	args: { customerId: v.id("customers") },
	handler: async (ctx, args) => {
		const passData = await ctx.runQuery(internal.wallet.getPassData, { customerId: args.customerId });

		try {
			await patchLoyaltyObject(passData);
		} catch (err) {
			if (!(err instanceof ConvexError)) console.error("Google Wallet push update failed", err);
			// WALLET_NOT_CONFIGURED is the routine case (Google not set up) — ignore silently.
		}

		let appleEnv: ReturnType<typeof requiredAppleEnv>;
		try {
			appleEnv = requiredAppleEnv();
		} catch {
			return; // Apple not configured — nothing to push.
		}

		const registrations = await ctx.runQuery(internal.passRegistrations.listBySerial, {
			serialNumber: args.customerId
		});
		for (const reg of registrations) {
			const result = await sendApplePushNotification({
				pushToken: reg.pushToken,
				passTypeIdentifier: appleEnv.passTypeId,
				certPem: appleEnv.certPem,
				keyPem: appleEnv.keyPem,
				passphrase: appleEnv.passphrase
			});
			if (result.shouldRemoveRegistration) {
				await ctx.runMutation(internal.passRegistrations.removeById, { id: reg._id });
			}
		}
	}
});
