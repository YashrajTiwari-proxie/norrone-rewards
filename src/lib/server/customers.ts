import { error } from '@sveltejs/kit';
import { supabaseAdmin } from './supabaseAdmin';
import type { CustomerRow } from './customerView';

export async function loadCustomer(shopId: string, externalId: string): Promise<CustomerRow> {
	const { data: customer, error: dbError } = await supabaseAdmin
		.from('customers')
		.select('*')
		.eq('shop_id', shopId)
		.eq('external_id', externalId)
		.maybeSingle();

	if (dbError) {
		error(500, 'Failed to load customer.');
	}
	if (!customer) {
		error(404, 'Customer not found.');
	}

	return customer;
}
