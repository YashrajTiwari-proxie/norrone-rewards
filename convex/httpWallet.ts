import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { ConvexError } from "convex/values";
import { verifyWalletToken } from "./lib/walletSigning";
import { buildGoogleSaveUrl } from "./lib/wallet/googlePass";
import { WALLET_NOT_CONFIGURED } from "./lib/wallet/errors";

const NOT_CONFIGURED_HEADERS = { "content-type": "application/json" };

function notConfiguredResponse(message: string): Response {
	return new Response(JSON.stringify({ error: "WALLET_NOT_CONFIGURED", message }), {
		status: 503,
		headers: NOT_CONFIGURED_HEADERS
	});
}

function isWalletNotConfigured(err: unknown): err is ConvexError<{ code: string; message: string }> {
	return err instanceof ConvexError && (err.data as { code?: string } | undefined)?.code === WALLET_NOT_CONFIGURED;
}

function tokenFromPath(pathname: string, prefix: string): string | null {
	if (!pathname.startsWith(prefix)) return null;
	const token = pathname.slice(prefix.length).replace(/^\/+/, "");
	return token || null;
}

/** GET /v1/wallet/apple/:token → .pkpass binary, or 503 if Apple Wallet isn't configured. */
export const handleAppleWallet = httpAction(async (ctx, request) => {
	const url = new URL(request.url);
	const token = tokenFromPath(url.pathname, "/v1/wallet/apple/");
	if (!token) return new Response("Not found", { status: 404 });

	const verified = await verifyWalletToken(token);
	if ("error" in verified) {
		return new Response(JSON.stringify({ error: "INVALID_TOKEN", message: verified.error }), {
			status: 401,
			headers: NOT_CONFIGURED_HEADERS
		});
	}

	try {
		const base64 = await ctx.runAction(internal.walletNode.buildApplePassBase64, {
			customerId: verified.customerId as Id<"customers">
		});
		const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
		return new Response(bytes, {
			status: 200,
			headers: {
				"content-type": "application/vnd.apple.pkpass",
				"content-disposition": "attachment; filename=loyalty.pkpass",
				"cache-control": "no-store"
			}
		});
	} catch (err) {
		if (isWalletNotConfigured(err)) {
			return notConfiguredResponse(err.data.message);
		}
		throw err;
	}
});

/** GET /v1/wallet/google/:token → 302 to the "Save to Google Wallet" link, or 503. */
export const handleGoogleWallet = httpAction(async (ctx, request) => {
	const url = new URL(request.url);
	const token = tokenFromPath(url.pathname, "/v1/wallet/google/");
	if (!token) return new Response("Not found", { status: 404 });

	const verified = await verifyWalletToken(token);
	if ("error" in verified) {
		return new Response(JSON.stringify({ error: "INVALID_TOKEN", message: verified.error }), {
			status: 401,
			headers: NOT_CONFIGURED_HEADERS
		});
	}

	try {
		const passData = await ctx.runQuery(internal.wallet.getPassData, {
			customerId: verified.customerId as Id<"customers">
		});
		const saveUrl = await buildGoogleSaveUrl(passData);
		return new Response(null, { status: 302, headers: { location: saveUrl } });
	} catch (err) {
		if (isWalletNotConfigured(err)) {
			return notConfiguredResponse(err.data.message);
		}
		throw err;
	}
});
