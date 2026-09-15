import { PUBLIC_CONVEX_SITE_URL } from '$env/static/public';
import type { RequestHandler } from './$types';

/**
 * Transparent reverse proxy for the public /v1/... API onto Convex's
 * `.site` domain — added specifically because Apple's Wallet app
 * (`passd`) was silently never completing its PassKit web-service calls
 * (device registration, pass refresh) directly against the raw
 * `*.convex.site` domain. Device-side syslog showed `passd` attempting
 * HTTPS/QUIC (HTTP/3) connections right at pass-install time that were
 * torn down immediately, with zero requests ever reaching Convex's
 * application logs — pointing at an HTTP/3 negotiation issue between the
 * device's background networking stack and Cloudflare (which fronts
 * Convex's site domain), something our `curl` testing never exercised
 * since curl defaults to HTTP/2 unless explicitly told to use HTTP/3.
 *
 * Routing PassKit traffic through Vercel's own edge (mature, widely-used
 * HTTP/3 fallback behavior) instead sidesteps that entirely, without
 * touching any of the actual endpoint logic in convex/httpPassService.ts
 * etc. — this is a pure byte-for-byte relay. walletNode.ts's
 * `webServiceURL` points here instead of directly at Convex; every other
 * consumer of /v1/... (the demo pages, direct API integrations) is
 * unaffected and can keep hitting Convex directly.
 */
const proxy: RequestHandler = async ({ request, params, url }) => {
	const target = `${PUBLIC_CONVEX_SITE_URL}/v1/${params.path ?? ''}${url.search}`;

	const headers = new Headers(request.headers);
	headers.delete('host');

	const upstream = await fetch(target, {
		method: request.method,
		headers,
		body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
		// @ts-expect-error - duplex is required by undici for streaming request bodies but missing from the RequestInit type
		duplex: 'half'
	});

	const responseHeaders = new Headers(upstream.headers);
	// Hop-by-hop headers must not be forwarded verbatim through a proxy.
	responseHeaders.delete('content-encoding');
	responseHeaders.delete('content-length');
	responseHeaders.delete('transfer-encoding');
	responseHeaders.delete('connection');

	return new Response(upstream.body, {
		status: upstream.status,
		headers: responseHeaders
	});
};

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
