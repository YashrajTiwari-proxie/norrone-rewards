import { createAuthProxyHandle, getServerSession } from '@proxie-studio/better-auth-tenant-kit/server';
import { PUBLIC_CONVEX_SITE_URL } from '$env/static/public';
import type { Handle } from '@sveltejs/kit';

const authConfig = { convexSiteUrl: PUBLIC_CONVEX_SITE_URL };
const authProxy = createAuthProxyHandle(authConfig);

export const handle: Handle = async ({ event, resolve }) => {
	if (event.url.pathname.startsWith('/api/auth')) {
		return authProxy({ event, resolve });
	}

	event.locals.session = await getServerSession(event.request, authConfig);

	return resolve(event);
};
