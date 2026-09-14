// Port of src/lib/server/apiKeys.ts. Convex's default (non-Node) runtime
// has no `node:crypto`, so this uses Web Crypto (`crypto.subtle` /
// `crypto.getRandomValues`), which is available in both Convex actions
// and httpActions without a "use node" pragma.

export type ApiKeyType = "secret" | "publishable";

const PREFIX: Record<ApiKeyType, string> = {
	secret: "sk_",
	publishable: "pk_"
};

function toBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Generates a new plaintext API key. Show it to the user exactly once — only the hash is stored. */
export function generateApiKey(type: ApiKeyType): string {
	const bytes = crypto.getRandomValues(new Uint8Array(24));
	return `${PREFIX[type]}${toBase64Url(bytes)}`;
}

export async function hashApiKey(plaintextKey: string): Promise<string> {
	const data = new TextEncoder().encode(plaintextKey);
	const digest = await crypto.subtle.digest("SHA-256", data);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

export function apiKeyTypeFromPlaintext(plaintextKey: string): ApiKeyType | null {
	if (plaintextKey.startsWith(PREFIX.secret)) return "secret";
	if (plaintextKey.startsWith(PREFIX.publishable)) return "publishable";
	return null;
}
