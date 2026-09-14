"use node";

// Apple Wallet pass-update pushes use the same Pass Type ID certificate
// that signs the pass itself for mutual TLS against APNs — no separate
// push certificate needed. This is HTTP/2 with a client cert, which only
// node:http2 (not fetch) supports, hence this file needing "use node"
// (it's only ever imported from walletNode.ts, which already has the
// directive, but keeping it here too documents the real reason).
import { connect } from "node:http2";

const APNS_HOST = "api.push.apple.com";

/**
 * Tells one device's Wallet app that a pass changed, so it re-fetches via
 * the PassKit Web Service (convex/httpPassService.ts) — this call itself
 * carries no payload, it's just a wake-up signal per Apple's protocol.
 * Resolves without throwing on most failures (an expired/unregistered
 * push token is routine, e.g. the customer deleted the pass) — the caller
 * removes the registration on a 410, everything else is just logged.
 */
export async function sendApplePushNotification(input: {
	pushToken: string;
	passTypeIdentifier: string;
	certPem: string;
	keyPem: string;
	passphrase?: string;
}): Promise<{ ok: boolean; status: number; shouldRemoveRegistration: boolean }> {
	return new Promise((resolve) => {
		const client = connect(`https://${APNS_HOST}`, {
			cert: input.certPem,
			key: input.keyPem,
			passphrase: input.passphrase
		});

		client.on("error", (err) => {
			console.error("APNs connection error", err);
			client.close();
			resolve({ ok: false, status: 0, shouldRemoveRegistration: false });
		});

		const req = client.request({
			":method": "POST",
			":path": `/3/device/${input.pushToken}`,
			"apns-topic": input.passTypeIdentifier,
			"content-type": "application/json"
		});

		let status = 0;
		req.on("response", (headers) => {
			status = Number(headers[":status"] ?? 0);
		});

		let body = "";
		req.on("data", (chunk) => {
			body += chunk;
		});

		req.on("end", () => {
			client.close();
			if (status !== 200) console.warn("APNs push failed", status, body);
			resolve({
				ok: status === 200,
				status,
				// 410 Gone / 400 BadDeviceToken mean this token will never work
				// again — anything else (network blip, 5xx) is worth retrying
				// next time rather than deleting the registration.
				shouldRemoveRegistration: status === 410 || status === 400
			});
		});

		req.on("error", (err) => {
			console.error("APNs request error", err);
			client.close();
			resolve({ ok: false, status: 0, shouldRemoveRegistration: false });
		});

		req.end(JSON.stringify({}));
	});
}
