const PALETTE = ['var(--stamp-amber)', 'var(--stamp-green)', 'var(--stamp-rust)', '#6E6C61'];

export function tierColor(name: string): string {
	let hash = 0;
	for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
	return PALETTE[hash % PALETTE.length];
}
