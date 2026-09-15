import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { verifyPassAuthToken } from "./lib/walletSigning";

/**
 * Apple's PassKit Web Service protocol (registered under /v1/devices/ and
 * /v1/passes/ in http.ts, more specific prefixes than httpApiV1.ts's
 * general /v1/ handlers, so these win). Apple's Wallet app calls these
 * directly once a pass with webServiceURL+authenticationToken is
 * installed — see convex/walletNode.ts's buildApplePassBase64. Full
 * protocol reference: developer.apple.com/documentation/walletpasses.
 *
 * serialNumber is always a customer id in this app (see walletNode.ts),
 * and authenticationToken is the deterministic HMAC from
 * lib/walletSigning.ts's signPassAuthToken — no session/API-key auth
 * here, this is Apple's own device-to-server protocol.
 */

function authToken(request: Request): string | null {
	const header = request.headers.get("authorization") ?? "";
	const match = header.match(/^ApplePass\s+(.+)$/);
	return match ? match[1] : null;
}

/** POST /v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber */
export const registerDevice = httpAction(async (ctx, request) => {
	const segments = new URL(request.url).pathname.split("/").filter(Boolean);
	// ["v1", "devices", deviceLibraryIdentifier, "registrations", passTypeIdentifier, serialNumber]
	if (segments.length !== 6 || segments[3] !== "registrations") return new Response(null, { status: 404 });
	const [, , deviceLibraryIdentifier, , passTypeIdentifier, serialNumber] = segments;

	const token = authToken(request);
	if (!token || !(await verifyPassAuthToken(serialNumber, token))) {
		return new Response(null, { status: 401 });
	}

	const body = await request.json().catch(() => null);
	if (!body?.pushToken || typeof body.pushToken !== "string") {
		return new Response(null, { status: 400 });
	}

	const { alreadyRegistered } = await ctx.runMutation(internal.passRegistrations.register, {
		deviceLibraryIdentifier,
		passTypeIdentifier,
		serialNumber,
		pushToken: body.pushToken
	});

	return new Response(null, { status: alreadyRegistered ? 200 : 201 });
});

/** DELETE /v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber */
export const unregisterDevice = httpAction(async (ctx, request) => {
	const segments = new URL(request.url).pathname.split("/").filter(Boolean);
	if (segments.length !== 6 || segments[3] !== "registrations") return new Response(null, { status: 404 });
	const [, , deviceLibraryIdentifier, , passTypeIdentifier, serialNumber] = segments;

	const token = authToken(request);
	if (!token || !(await verifyPassAuthToken(serialNumber, token))) {
		return new Response(null, { status: 401 });
	}

	const { found } = await ctx.runMutation(internal.passRegistrations.unregister, {
		deviceLibraryIdentifier,
		passTypeIdentifier,
		serialNumber
	});
	return new Response(null, { status: found ? 200 : 404 });
});

/**
 * GET /v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier?passesUpdatedSince=...
 * Unauthenticated per Apple's spec — this is a routine poll, not a
 * customer-identifying read. We don't track per-serial version tags, so
 * every registered serial is always reported as "updated"; the device
 * then re-fetches each and compares Last-Modified itself, so over-
 * reporting here is correct per spec, just not maximally efficient.
 */
export const listUpdatablePasses = httpAction(async (ctx, request) => {
	const segments = new URL(request.url).pathname.split("/").filter(Boolean);
	// ["v1", "devices", deviceLibraryIdentifier, "registrations", passTypeIdentifier]
	if (segments.length !== 5 || segments[3] !== "registrations") return new Response(null, { status: 404 });
	const [, , deviceLibraryIdentifier, , passTypeIdentifier] = segments;

	const serialNumbers = await ctx.runQuery(internal.passRegistrations.listByDeviceAndType, {
		deviceLibraryIdentifier,
		passTypeIdentifier
	});
	if (serialNumbers.length === 0) return new Response(null, { status: 204 });

	return new Response(JSON.stringify({ lastUpdated: String(Date.now()), serialNumbers }), {
		status: 200,
		headers: { "content-type": "application/json" }
	});
});

/** GET /v1/passes/:passTypeIdentifier/:serialNumber — the actual updated pass. */
export const getLatestPass = httpAction(async (ctx, request) => {
	const segments = new URL(request.url).pathname.split("/").filter(Boolean);
	// ["v1", "passes", passTypeIdentifier, serialNumber]
	if (segments.length !== 4) return new Response(null, { status: 404 });
	const serialNumber = segments[3];

	const token = authToken(request);
	if (!token || !(await verifyPassAuthToken(serialNumber, token))) {
		return new Response(null, { status: 401 });
	}

	try {
		const base64 = await ctx.runAction(internal.walletNode.buildApplePassBase64, {
			customerId: serialNumber as Id<"customers">
		});
		const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
		return new Response(bytes, {
			status: 200,
			headers: {
				"content-type": "application/vnd.apple.pkpass",
				"last-modified": new Date().toUTCString(),
				"cache-control": "no-store"
			}
		});
	} catch (err) {
		console.error("getLatestPass failed", err);
		return new Response(null, { status: 404 });
	}
});

/** POST /v1/log — Apple's Wallet app reports client-side errors here; we just log them. */
export const logErrors = httpAction(async (_ctx, request) => {
	const body = await request.json().catch(() => null);
	if (body?.logs) console.warn("Apple Wallet client log", body.logs);
	return new Response(null, { status: 200 });
});
