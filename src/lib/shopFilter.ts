export function getViewingShopId(url: URL): string | null {
	const shop = url.searchParams.get('shop');
	return shop && shop !== 'all' ? shop : null;
}
