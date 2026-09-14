import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { authComponent, createAuth } from "./auth";
import { handleV1Get, handleV1Post, handleV1Put } from "./httpApiV1";

const http = httpRouter();

authComponent.registerRoutes(http, createAuth);

// Public /v1/... loyalty API (see httpApiV1.ts) — API-key authenticated,
// not a Better Auth session. Wallet-pass sub-routes are not included;
// wallet passes are paused until real Apple/Google credentials exist.
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
