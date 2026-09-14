import type { SupabaseClient } from '@supabase/supabase-js';

/** Checks platform_admins membership via the RLS-scoped client (its own select-own-row policy). */
export async function isPlatformAdmin(supabase: SupabaseClient, userId: string): Promise<boolean> {
	const { data } = await supabase.from('platform_admins').select('id').eq('user_id', userId).maybeSingle();
	return data !== null;
}
