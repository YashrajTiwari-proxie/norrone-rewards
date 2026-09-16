"use node";

// Minimal from-scratch PNG encoder (no image library needed) — used only
// to generate the flat-color default icon/logo for Apple Wallet passes
// until real per-org branding assets exist. Truecolor (RGB, no alpha),
// 8-bit depth, single IDAT chunk, filter type 0 (none) per scanline.
//
// Only ever imported from convex/walletNode.ts (also "use node") — Convex's
// bundler requires the directive on every file that directly imports a
// Node builtin, not just the action's own entry file.
import { deflateSync } from "node:zlib";

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();

function crc32(buf: Buffer): number {
	let crc = 0xffffffff;
	for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
	const typeBuf = Buffer.from(type, "ascii");
	const lenBuf = Buffer.alloc(4);
	lenBuf.writeUInt32BE(data.length, 0);
	const crcBuf = Buffer.alloc(4);
	crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
	return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * General-purpose truecolor PNG encoder — `pixelAt` is called once per
 * pixel and returns its RGB. Shared by solidColorPng below (a flat fill)
 * and stripPng.ts's banded strip (a couple of flat-filled rectangles) —
 * same encoder, different pixel functions, so the PNG plumbing (IHDR/
 * IDAT/IEND, zlib deflate) only exists once.
 */
export function rgbPngFromPixels(
	width: number,
	height: number,
	pixelAt: (x: number, y: number) => [number, number, number]
): Buffer {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 2; // color type: truecolor (RGB)
	ihdr[10] = 0; // compression
	ihdr[11] = 0; // filter
	ihdr[12] = 0; // interlace

	const rowLength = 1 + width * 3; // filter byte + RGB per pixel
	const raw = Buffer.alloc(rowLength * height);
	for (let y = 0; y < height; y++) {
		const rowStart = y * rowLength;
		raw[rowStart] = 0; // filter type: none
		for (let x = 0; x < width; x++) {
			const [r, g, b] = pixelAt(x, y);
			const px = rowStart + 1 + x * 3;
			raw[px] = r;
			raw[px + 1] = g;
			raw[px + 2] = b;
		}
	}
	const idat = deflateSync(raw);

	return Buffer.concat([PNG_SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

/** A flat-color square PNG, `size`x`size`, RGB [r,g,b] each 0-255. */
export function solidColorPng(size: number, [r, g, b]: [number, number, number]): Buffer {
	return rgbPngFromPixels(size, size, () => [r, g, b]);
}

/** A flat-color rectangular PNG — the strip/hero box's fallback when an org hasn't uploaded a banner image. */
export function solidColorRectPng(width: number, height: number, [r, g, b]: [number, number, number]): Buffer {
	return rgbPngFromPixels(width, height, () => [r, g, b]);
}
