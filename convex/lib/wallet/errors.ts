// Shared between walletNode.ts ("use node" — Apple pass building) and
// googlePass.ts (standard runtime) and httpWallet.ts (standard runtime,
// dispatches to both). Deliberately has zero Node-specific imports so
// httpWallet.ts can safely import it without pulling node:crypto/
// node-forge into the standard V8 action runtime's bundle.
export const WALLET_NOT_CONFIGURED = "WALLET_NOT_CONFIGURED";
