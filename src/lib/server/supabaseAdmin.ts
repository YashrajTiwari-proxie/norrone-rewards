import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';

/**
 * Service-role client — bypasses RLS. Only use from server code that has
 * already resolved and verified an API key via requireApiKey() (§2), or
 * from Postgres-function callers that don't need per-row RLS at all.
 * Never import this into anything that runs in the browser.
 */
export const supabaseAdmin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
	auth: { persistSession: false, autoRefreshToken: false }
});
