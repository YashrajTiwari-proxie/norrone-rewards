"use node";

// Variant "1b — Banded" from the wallet pass redesign (see
// docs/WALLET_PASS_REDESIGN_PLAN.md): a flat two-tone bar, procedurally
// generated from an org's background+accent hex colors rather than
// uploaded artwork — no per-org design work required beyond picking two
// colors. Used both as Apple's strip image (zipped directly into the
// .pkpass) and, at a different aspect ratio, as Google's heroImage
// (hosted via ctx.storage since Google needs a URL, not inline bytes —
// see walletNode.ts's generateHeroImageUrl).
import { rgbPngFromPixels } from "./simplePng";

/**
 * A solid background fill with an accent-colored block along the
 * bottom-left, covering roughly the bottom third and left ~62% of the
 * image — matches the design doc's 1b mock. Purely geometric, no
 * anti-aliasing needed since every edge is axis-aligned.
 */
export function bandedStripPng(
	width: number,
	height: number,
	background: [number, number, number],
	accent: [number, number, number]
): Buffer {
	const accentBandHeight = Math.round(height * 0.34);
	const accentBandWidth = Math.round(width * 0.62);
	return rgbPngFromPixels(width, height, (x, y) => {
		const inAccentBand = y >= height - accentBandHeight && x < accentBandWidth;
		return inAccentBand ? accent : background;
	});
}
