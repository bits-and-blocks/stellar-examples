import type { User, WalletWithMetadata } from "@privy-io/react-auth";

/**
 * Finds the user's Stellar embedded wallet.
 *
 * Tier 2 wallets do not appear in `useWallets()` — that hook covers EVM only.
 * They live in `user.linkedAccounts`, discriminated by `chainType`.
 */
export function findStellarWallet(
  user: User | null,
): WalletWithMetadata | null {
  if (!user) return null;

  const account = user.linkedAccounts.find(
    (candidate): candidate is WalletWithMetadata =>
      candidate.type === "wallet" && candidate.chainType === "stellar",
  );

  return account ?? null;
}
