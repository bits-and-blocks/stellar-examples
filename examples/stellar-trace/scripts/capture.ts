/**
 * `npm run capture` — snapshot a slice of testnet into the repository.
 *
 * Captures whole `getEvents` responses and the `getTransaction` results for
 * the transactions they name, and writes them where `--offline` can find them.
 * Nothing is decoded or reshaped on the way through: the point of a fixture is
 * to be the bytes the network really sent, so that a demo running against it
 * is running against evidence rather than against something plausible.
 *
 *     npm run capture -- --ledgers 200
 *     npm run capture -- --start-ledger 4247000 --ledgers 200 --name my-slice
 *
 * Rerun it when the fixture ages out of usefulness. Nothing breaks when it
 * does — a fixture is a closed universe and keeps working long after its
 * ledgers have left the RPC's retention window, which is exactly why the demo
 * uses one.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { DEFAULT_CONFIG_PATH, loadConfig } from "../src/config.js";
import { createLogger } from "../src/log.js";
import { NETWORK_PASSPHRASE } from "../src/network.js";
import {
  DEFAULT_FIXTURE_DIR,
  MANIFEST_FILE,
  PAGES_FILE,
  TRANSACTIONS_FILE,
  type CapturedPage,
  type FixtureManifest,
} from "../src/offline/fixtures.js";
import { TraceRpc, type GetTransactionResponse } from "../src/rpc.js";
import { ledgerOf } from "../src/toid.js";

const { values } = parseArgs({
  options: {
    out: { type: "string" },
    name: { type: "string" },
    config: { type: "string", default: DEFAULT_CONFIG_PATH },
    "start-ledger": { type: "string" },
    ledgers: { type: "string", default: "200" },
    /** How many transactions to fetch meta for. The events are all kept. */
    transactions: { type: "string", default: "25" },
    limit: { type: "string", default: "1000" },
  },
});

const config = loadConfig(values.config);
const log = createLogger({ format: "text" });
const rpc = new TraceRpc({ url: config.rpcUrl, log });

const network = await rpc.getNetwork();
if (network.passphrase !== NETWORK_PASSPHRASE) {
  throw new Error(`refusing to capture from "${network.passphrase}" — testnet only`);
}

const health = await rpc.getHealth();
const span = Number(values.ledgers);
// Stay back from the tip: a ledger that is still closing would be captured
// half-written, and the fixture would disagree with the network it came from.
const endLedger = Math.min(health.latestLedger - 10, health.latestLedger);
const startLedger = values["start-ledger"]
  ? Number(values["start-ledger"])
  : endLedger - span + 1;

if (startLedger < health.oldestLedger) {
  throw new Error(
    `ledger ${startLedger} is outside the retention window ` +
      `(${health.oldestLedger} to ${health.latestLedger})`,
  );
}

log.info("capturing", { startLedger, endLedger, filters: config.fingerprint });

// --- events, one page at a time, kept whole -------------------------------

const pages: CapturedPage[] = [];
let cursor: string | null = null;

for (;;) {
  const request = cursor
    ? { cursor, limit: Number(values.limit) }
    : { startLedger, limit: Number(values.limit) };

  const response = await rpc.getEvents({ ...request, filters: config.filters });

  // Drop anything past the end of the range rather than keeping a partial
  // ledger: the fixture claims to hold a range, and it should hold all of it.
  const events = response.events.filter((event) => event.ledger <= endLedger);
  const overshot = events.length < response.events.length;

  pages.push({ request, response: { ...response, events } });
  cursor = response.cursor;

  const through = ledgerOf(response.cursor);
  log.info("page", { events: events.length, through });

  if (overshot || through >= endLedger) break;
}

const events = pages.flatMap((page) => page.response.events);

// --- transaction meta, for the most recent transactions in the range -------

const hashes: string[] = [];
for (const event of [...events].reverse()) {
  if (hashes.length >= Number(values.transactions)) break;
  if (!hashes.includes(event.txHash)) hashes.push(event.txHash);
}

const transactions: Record<string, GetTransactionResponse> = {};
for (const hash of hashes) {
  const record = await rpc.getTransaction(hash);
  if (record.status === "NOT_FOUND") {
    log.warn("skipping a transaction the server no longer holds", { hash });
    continue;
  }
  // Server state — where the tip was when we asked — would go stale and make
  // the fixture look like it had changed. Only the transaction is kept.
  transactions[hash] = {
    status: record.status,
    txHash: record.txHash,
    ledger: record.ledger,
    createdAt: record.createdAt,
    applicationOrder: record.applicationOrder,
    feeBump: record.feeBump,
    envelopeXdr: record.envelopeXdr,
    resultXdr: record.resultXdr,
    resultMetaXdr: record.resultMetaXdr,
  } as GetTransactionResponse;
}

// --- write ----------------------------------------------------------------

const directory = values.out ?? DEFAULT_FIXTURE_DIR;
const manifest: FixtureManifest = {
  name: values.name ?? `testnet-${startLedger}-${endLedger}`,
  capturedAt: new Date().toISOString(),
  rpcUrl: config.rpcUrl,
  network,
  range: { startLedger, endLedger },
  filters: config.filters,
  filterFingerprint: config.fingerprint,
  counts: {
    pages: pages.length,
    events: events.length,
    transactions: Object.keys(transactions).length,
  },
};

mkdirSync(directory, { recursive: true });
write(join(directory, MANIFEST_FILE), manifest);
write(join(directory, PAGES_FILE), pages);
write(join(directory, TRANSACTIONS_FILE), transactions);

log.info("captured", {
  directory,
  ledgers: endLedger - startLedger + 1,
  ...manifest.counts,
});

function write(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 1)}\n`);
}
