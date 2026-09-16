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
