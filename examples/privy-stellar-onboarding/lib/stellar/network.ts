/**
 * Network configuration. Testnet only, by construction.
 *
 * Every value here is a literal. None of them is read from the environment,
 * so there is no configuration path — no `.env`, no build flag, no Vercel
 * setting — that can point this app at mainnet. Switching networks requires
 * editing this file and passing code review.
 *
 * The passphrase matters more than the URLs: it is mixed into the payload that
 * gets signed (see `Transaction.hash()`), so a transaction built here can only
 * ever be valid on testnet. A mainnet Horizon would reject it as `tx_bad_auth`
 * rather than accepting it.
 */

export const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

export const HORIZON_URL = "https://horizon-testnet.stellar.org";
export const SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
export const FRIENDBOT_URL = "https://friendbot.stellar.org";

export const explorerTxUrl = (hash: string) =>
  `https://stellar.expert/explorer/testnet/tx/${hash}`;

export const explorerAccountUrl = (address: string) =>
  `https://stellar.expert/explorer/testnet/account/${address}`;
