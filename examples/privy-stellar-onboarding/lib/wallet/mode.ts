/**
 * Which wallet backs the app. One environment variable, read once.
 *
 * This is deliberately not a runtime toggle. `NEXT_PUBLIC_` values are inlined
 * at build time, so a build is either the Privy build or the Wallets Kit
 * build, and only the provider for that mode is ever mounted. That is what
 * lets the two sessions be separate components with separate hooks instead of
 * one component branching on a value React would not let it branch on.
 *
 * Unlike the network configuration, this genuinely is a choice, so it lives in
 * the environment rather than in a pinned literal. It selects who signs, and
 * every mode signs for the same testnet.
 */

export const WALLET_MODES = ["privy", "wallets-kit"] as const;

export type WalletMode = (typeof WALLET_MODES)[number];

const configured = process.env.NEXT_PUBLIC_WALLET_MODE?.trim();

/**
 * The selected mode, or null if the variable was set to something that is not
 * a mode. Null rather than a throw, and rather than a silent fall back to the
 * default: a typo that quietly runs the wrong signer is the one outcome worth
 * ruling out, and `Providers` can say so on the page instead of in a stack
 * trace nobody has the console open for.
 */
export const WALLET_MODE: WalletMode | null = !configured
  ? "privy"
  : (WALLET_MODES.find((mode) => mode === configured) ?? null);

/** What was actually set, for the error message when it is not a mode. */
export const CONFIGURED_WALLET_MODE = configured;
