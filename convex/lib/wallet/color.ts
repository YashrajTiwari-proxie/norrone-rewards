// Pure-math color helpers shared by both wallet platforms — no Node
// builtins, so this file (unlike simplePng.ts/stripPng.ts) needs no "use
// node" directive and can be imported from either runtime.

export function hexToRgb(hex: string): [number, number, number] {
	const match = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
	if (!match) return [0, 0, 0];
	return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
	return `#${[r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0")).join("")}`;
}

/** Apple's pass.json wants CSS rgb() strings, not hex. */
export function hexToRgbCss(hex: string): string {
	const [r, g, b] = hexToRgb(hex);
	return `rgb(${r}, ${g}, ${b})`;
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
	const toLinear = (c: number) => {
		const s = c / 255;
		return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
	};
	const [rl, gl, bl] = [toLinear(r), toLinear(g), toLinear(b)];
	return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

/** WCAG contrast ratio between two hex colors — 1 (identical) to 21 (black/white). */
export function contrastRatio(hexA: string, hexB: string): number {
	const la = relativeLuminance(hexToRgb(hexA));
	const lb = relativeLuminance(hexToRgb(hexB));
	const [lighter, darker] = la > lb ? [la, lb] : [lb, la];
	return (lighter + 0.05) / (darker + 0.05);
}

/** The minimum bar a pass's own text must clear against its background — same threshold WCAG AA uses for normal text. */
export const MIN_CONTRAST_RATIO = 4.5;

/**
 * Apple's labelColor (the small caption above each field's value, e.g.
 * "POINTS" above the number) is deliberately not an org-set color — it's
 * a fixed blend between background and foreground, weighted toward the
 * background so labels read as visually secondary to the field values
 * they sit above, on any org's palette.
 */
export function deriveLabelColor(backgroundHex: string, foregroundHex: string): string {
	const bg = hexToRgb(backgroundHex);
	const fg = hexToRgb(foregroundHex);
	const blend = bg.map((c, i) => c * 0.55 + fg[i] * 0.45) as [number, number, number];
	return rgbToHex(blend);
}
