/**
 * Network configuration. Testnet only, by construction.
 *
 * The passphrase is a literal and is never read from the config file or the
 * environment, so there is no setting that points this indexer at mainnet.
 * It is not decoration either: `preflight` calls `getNetwork` and refuses to
 * start when the RPC server reports a different passphrase, which turns
 * "someone pasted a mainnet RPC URL into trace.config.json" into a startup
 * error rather than a database full of the wrong network's events.
 */
export const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

export const DEFAULT_RPC_URL = "https://soroban-testnet.stellar.org";

/**
 * Limits the RPC server enforces on `getEvents`. Checked here so a bad config
 * fails before the first request with a message naming the limit, rather than
 * as a `-32602 invalid parameters` from the server halfway through a run.
 *
 * Every one of these was confirmed against `soroban-testnet.stellar.org`
 * (protocol 27) rather than taken from documentation — see the README.
 */
export const RPC_LIMITS = {
  /** `maximum 5 filters per request` */
  filters: 5,
  /** Topic matcher arrays per filter. */
  topicMatchers: 5,
  /** Contract ids per filter. */
  contractIds: 5,
  /** A topic matcher is 1 to 4 segments, matching a contract event's topics. */
  topicSegments: 4,
  /** `limit must not exceed 10000` — records, not ledgers. */
  pageLimit: 10_000,
  /**
   * Ledgers scanned per request. Not an error when exceeded: the server
   * silently stops scanning and hands back a cursor at the end of the window
   * it did cover. See `isCaughtUp` in ingest.ts — this cap is the reason an
   * empty page cannot be read as "caught up to the tip".
   */
  ledgerScan: 10_000,
} as const;
