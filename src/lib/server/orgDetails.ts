/** Shared by admin org create/edit and the self-serve /signup form. */
export function parseOrgDetails(formData: FormData) {
	const phoneNumber = formData.get('phoneNumber');
	const website = formData.get('website');
	const address = formData.get('address');
	const regionId = formData.get('regionId');
	const currencyCode = formData.get('currencyCode');
	const businessRegistrationNumber = formData.get('businessRegistrationNumber');
	const taxId = formData.get('taxId');

	return {
		phone_number: typeof phoneNumber === 'string' && phoneNumber.trim() ? phoneNumber.trim() : null,
		website: typeof website === 'string' && website.trim() ? website.trim() : null,
		address: typeof address === 'string' && address.trim() ? address.trim() : null,
		region_id: typeof regionId === 'string' && regionId ? regionId : null,
		currency_code: typeof currencyCode === 'string' && currencyCode.trim() ? currencyCode.trim().toUpperCase() : null,
		business_registration_number:
			typeof businessRegistrationNumber === 'string' && businessRegistrationNumber.trim()
				? businessRegistrationNumber.trim()
				: null,
		tax_id: typeof taxId === 'string' && taxId.trim() ? taxId.trim() : null
	};
}

/** Shared by the org dashboard's shop create/edit forms. */
export function parseShopDetails(formData: FormData) {
	const phoneNumber = formData.get('shopPhoneNumber');
	const address = formData.get('shopAddress');
	const regionId = formData.get('shopRegionId');
	const currencyCode = formData.get('shopCurrencyCode');

	return {
		phone_number: typeof phoneNumber === 'string' && phoneNumber.trim() ? phoneNumber.trim() : null,
		address: typeof address === 'string' && address.trim() ? address.trim() : null,
		region_id: typeof regionId === 'string' && regionId ? regionId : null,
		currency_code: typeof currencyCode === 'string' && currencyCode.trim() ? currencyCode.trim().toUpperCase() : null
	};
}
