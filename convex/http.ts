import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { authComponent, createAuth } from "./auth";
import { handleV1Get, handleV1Post, handleV1Put } from "./httpApiV1";
import { handleAppleWallet, handleGoogleWallet } from "./httpWallet";

const http = httpRouter();

authComponent.registerRoutes(http, createAuth);

// Wallet-pass routes — registered as a more specific pathPrefix so Convex's
// router picks these over the general /v1/ GET route below (longest-prefix
// match wins). Token-authenticated (see lib/walletSigning.ts), not the
// API-key scheme the rest of /v1/ uses — these links are meant to be
// opened directly on a customer's phone.
http.route({ pathPrefix: "/v1/wallet/apple/", method: "GET", handler: handleAppleWallet });
http.route({ pathPrefix: "/v1/wallet/google/", method: "GET", handler: handleGoogleWallet });

// Public /v1/... loyalty API (see httpApiV1.ts) — API-key authenticated,
// not a Better Auth session.
http.route({ pathPrefix: "/v1/", method: "GET", handler: handleV1Get });
http.route({ pathPrefix: "/v1/", method: "POST", handler: handleV1Post });
http.route({ pathPrefix: "/v1/", method: "PUT", handler: handleV1Put });

// CORS preflight for the publishable-key/browser use case documented on
// the API Keys page — a custom Authorization header makes every
// cross-origin call "non-simple", so the browser sends this first.
http.route({
	pathPrefix: "/v1/",
	method: "OPTIONS",
	handler: httpAction(async () =>
		new Response(null, {
			status: 204,
			headers: {
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
				"Access-Control-Allow-Headers": "Authorization, Content-Type",
				"Access-Control-Max-Age": "86400"
			}
		})
	)
});

export default http;
