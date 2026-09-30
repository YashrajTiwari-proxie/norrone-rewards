// Pure block -> email-HTML renderer. Deliberately has zero dependency on
// Convex, Svelte, or campaigns/templates specifically — it's data in, an
// HTML string out — so it's reusable both for the designer's live preview
// (imported directly into the browser bundle) and for the actual send
// (imported from convex/newsletter.ts and convex/transactional.ts). Table-
// based markup throughout, not flexbox/grid, since those don't render
// reliably across email clients (Outlook in particular).

export type EmailBlock =
	| { type: "heading"; text: string }
	| { type: "paragraph"; text: string }
	| { type: "image"; url: string; alt?: string }
	| { type: "button"; label: string; url: string }
	| { type: "divider" }
	| { type: "spacer"; height: number }
	// Org campaigns only — resolved against the org's own reward/coupon
	// catalog at render time (see `opts.rewards`/`opts.coupons` below).
	// Neither carries its own copy: a reward's name/description and a
	// coupon's discount/expiry always come from the live definition
	// (rewards) or the specific instance minted for the recipient
	// (coupons), never baked into the block itself.
	| { type: "reward"; rewardId: string }
	| { type: "coupon"; couponDefinitionId: string };

export const BLOCK_TYPES = ["heading", "paragraph", "image", "button", "divider", "spacer", "reward", "coupon"] as const;

export function defaultBlockFor(type: EmailBlock["type"]): EmailBlock {
	switch (type) {
		case "heading":
			return { type: "heading", text: "Heading" };
		case "paragraph":
			return { type: "paragraph", text: "Write something here." };
		case "image":
			return { type: "image", url: "", alt: "" };
		case "button":
			return { type: "button", label: "Click here", url: "" };
		case "divider":
			return { type: "divider" };
		case "spacer":
			return { type: "spacer", height: 24 };
		case "reward":
			return { type: "reward", rewardId: "" };
		case "coupon":
			return { type: "coupon", couponDefinitionId: "" };
	}
}

// Starting point for a new campaign when no saved template is picked.
export const DEFAULT_TEMPLATE_BLOCKS: EmailBlock[] = [
	{ type: "heading", text: "Norrone Rewards" },
	{ type: "paragraph", text: "Write your update here." },
	{ type: "button", label: "Learn more", url: "" }
];

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

const INK = "#161616";
const TEXT_MUTED = "#6e6d68";
const LINE = "#e5e1d8";
const PAPER = "#f4f1ec";

export type ResolvedReward = { name: string; description?: string };
export type ResolvedCoupon = {
	code: string;
	discountValue: number;
	discountType: "PERCENTAGE" | "FIXED";
	expiresAt: number;
};

export type RenderOpts = {
	unsubscribeUrl?: string;
	/** Keyed by rewardId. A reward block with no matching entry renders nothing — same "skip if incomplete" rule as an image/button with no url. */
	rewards?: Record<string, ResolvedReward>;
	/** Keyed by couponDefinitionId. A coupon block with no matching entry renders nothing. */
	coupons?: Record<string, ResolvedCoupon>;
};

function formatDiscount(c: ResolvedCoupon): string {
	return c.discountType === "PERCENTAGE" ? `${c.discountValue}% off` : `$${c.discountValue.toFixed(2)} off`;
}

function renderBlock(block: EmailBlock, opts: RenderOpts): string {
	const cell = (inner: string, padding = "0 32px") =>
		`<tr><td style="padding:${padding}">${inner}</td></tr>`;

	switch (block.type) {
		case "heading":
			return cell(
				`<h2 style="margin:0;font-family:Georgia,serif;font-size:24px;line-height:1.3;color:${INK}">${escapeHtml(block.text)}</h2>`,
				"24px 32px 0"
			);
		case "paragraph":
			return cell(
				`<p style="margin:0;font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:${INK}">${escapeHtml(block.text)}</p>`,
				"12px 32px 0"
			);
		case "image":
			if (!block.url) return "";
			return cell(
				`<img src="${escapeHtml(block.url)}" alt="${escapeHtml(block.alt ?? "")}" width="100%" style="display:block;width:100%;max-width:536px;border-radius:12px" />`,
				"20px 32px 0"
			);
		case "button":
			if (!block.url) return "";
			return cell(
				`<table cellpadding="0" cellspacing="0" border="0"><tr><td style="border-radius:999px;background:${INK}">` +
					`<a href="${escapeHtml(block.url)}" style="display:inline-block;padding:12px 28px;font-family:Arial,sans-serif;font-size:14px;font-weight:600;color:#fffffa;text-decoration:none;border-radius:999px">${escapeHtml(block.label)}</a>` +
					`</td></tr></table>`,
				"20px 32px 0"
			);
		case "divider":
			return cell(`<div style="border-top:1px solid ${LINE}"></div>`, "24px 32px 0");
		case "spacer":
			return `<tr><td style="height:${Math.max(0, block.height)}px;line-height:${Math.max(0, block.height)}px;font-size:0">&nbsp;</td></tr>`;
		case "reward": {
			const reward = opts.rewards?.[block.rewardId];
			if (!reward) return "";
			return cell(
				`<table cellpadding="0" cellspacing="0" width="100%" style="background:${PAPER};border:1px solid ${LINE};border-radius:14px">
					<tr><td style="padding:16px 20px">
						<div style="font:600 11px Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:${TEXT_MUTED}">Reward</div>
						<div style="margin-top:4px;font:600 17px Georgia,serif;color:${INK}">${escapeHtml(reward.name)}</div>
						${reward.description ? `<div style="margin-top:4px;font:400 13px Arial,sans-serif;line-height:1.5;color:${TEXT_MUTED}">${escapeHtml(reward.description)}</div>` : ""}
					</td></tr>
				</table>`,
				"20px 32px 0"
			);
		}
		case "coupon": {
			const coupon = opts.coupons?.[block.couponDefinitionId];
			if (!coupon) return "";
			const expires = new Date(coupon.expiresAt).toLocaleDateString(undefined, {
				month: "short",
				day: "numeric",
				year: "numeric"
			});
			return cell(
				`<table cellpadding="0" cellspacing="0" width="100%" style="background:${INK};border-radius:14px">
					<tr><td style="padding:20px;text-align:center">
						<div style="font:600 11px Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#C6CCD3">${escapeHtml(formatDiscount(coupon))}</div>
						<div style="margin-top:8px;font:700 22px/1.2 Georgia,serif;letter-spacing:.04em;color:#fffffa">${escapeHtml(coupon.code)}</div>
						<div style="margin-top:6px;font:400 12px Arial,sans-serif;color:#9a9d9a">Expires ${expires}</div>
					</td></tr>
				</table>`,
				"20px 32px 0"
			);
		}
	}
}

/**
 * Renders an ordered list of blocks into a self-contained HTML email.
 * `unsubscribeUrl`, when given, appends a footer with the required
 * one-click unsubscribe link — always include it for a real send; omit it
 * only for previewing inside the designer. `rewards`/`coupons` resolve any
 * reward/coupon blocks — see RenderOpts.
 */
export function renderBlocksToHtml(blocks: EmailBlock[], opts: RenderOpts = {}): string {
	const body = blocks.map((b) => renderBlock(b, opts)).join("\n");
	const footer = opts.unsubscribeUrl
		? `<tr><td style="padding:32px 32px 24px">
				<div style="border-top:1px solid ${LINE};padding-top:16px;font-family:Arial,sans-serif;font-size:12px;line-height:1.6;color:${TEXT_MUTED}">
					You're receiving this because you subscribed to Norrone Rewards updates.
					<a href="${escapeHtml(opts.unsubscribeUrl)}" style="color:${TEXT_MUTED}">Unsubscribe</a>
				</div>
			</td></tr>`
		: "";

	return `<!doctype html>
<html>
	<body style="margin:0;padding:0;background:${PAPER}">
		<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER}">
			<tr>
				<td align="center" style="padding:32px 16px">
					<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fffffa;border-radius:20px;border:1px solid ${LINE}">
						${body}
						${footer}
						<tr><td style="height:8px;line-height:8px;font-size:0">&nbsp;</td></tr>
					</table>
				</td>
			</tr>
		</table>
	</body>
</html>`;
}
