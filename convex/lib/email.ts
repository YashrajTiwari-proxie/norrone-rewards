// Transactional email via Resend's REST API (plain fetch — no SDK needed,
// keeps this runnable in Convex's default V8 action runtime). Both
// RESEND_API_KEY and EMAIL_FROM are set via `npx convex env set`, same as
// WALLET_SIGNING_SECRET. EMAIL_FROM defaults to Resend's sandbox sender,
// which works with zero domain verification — fine until a real "from"
// domain is chosen.

export async function sendEmail({
	to,
	subject,
	html
}: {
	to: string;
	subject: string;
	html: string;
}): Promise<void> {
	const apiKey = process.env.RESEND_API_KEY;
	if (!apiKey) {
		throw new Error("RESEND_API_KEY is not configured — set it with `npx convex env set RESEND_API_KEY <key>`");
	}
	const from = process.env.EMAIL_FROM ?? "Norrone Loyalty <onboarding@resend.dev>";

	const res = await fetch("https://api.resend.com/emails", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json"
		},
		body: JSON.stringify({ from, to, subject, html })
	});

	if (!res.ok) {
		throw new Error(`Email send failed: ${res.status} ${await res.text()}`);
	}
}
