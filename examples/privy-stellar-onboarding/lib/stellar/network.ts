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

/**
 * The block explorers a transaction can be opened in.
 *
 * Both point at their testnet views, which is the only network this app can
 * produce a transaction for. A mainnet link would 404 on every hash here.
 */
export type Explorer = {
  id: "expert" | "chain";
  name: string;
  txUrl: (hash: string) => string;
  accountUrl: (address: string) => string;
};

export const EXPLORERS: readonly Explorer[] = [
  {
    id: "expert",
    name: "Stellar Expert",
    txUrl: (hash) => `https://stellar.expert/explorer/testnet/tx/${hash}`,
    accountUrl: (address) =>
      `https://stellar.expert/explorer/testnet/account/${address}`,
  },
  {
    id: "chain",
    name: "StellarChain",
    txUrl: (hash) => `https://testnet.stellarchain.io/tx/${hash}`,
    accountUrl: (address) => `https://testnet.stellarchain.io/address/${address}`,
  },
];

export const explorerTxUrl = (hash: string) => EXPLORERS[0].txUrl(hash);

export const explorerAccountUrl = (address: string) =>
  EXPLORERS[0].accountUrl(address);
