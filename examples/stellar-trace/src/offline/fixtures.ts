/**
 * What a captured slice of testnet looks like on disk, and how it is read.
 *
 * The recorded thing is the **response**, verbatim — pages of `getEvents`
 * exactly as the server returned them, and `getTransaction` results with their
 * base64 XDR untouched. Nothing is normalised on the way in, so a fixture is
 * evidence rather than a summary, and a decoder or a meta reader run against
 * one is running against bytes the network really produced.
 *
 * A fixture is also a small closed universe: its newest ledger is the end of
 * the capture, not the end of testnet. That is what lets the ingest loop reach
 * "caught up" offline instead of chasing a tip it can never see.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { GetEventsResponse, GetTransactionResponse, RawEvent } from "../rpc.js";
import type { RpcFilter } from "../filters.js";

export const DEFAULT_FIXTURE_DIR = "fixtures/testnet-slice";

export type FixtureManifest = {
  name: string;
  capturedAt: string;
  rpcUrl: string;
  network: { passphrase: string; protocolVersion: number };
  /** The ledgers this capture covers, inclusive. */
  range: { startLedger: number; endLedger: number };
  /** The filters the events were captured with, encoded, plus their hash. */
  filters: RpcFilter[];
  filterFingerprint: string;
  counts: { pages: number; events: number; transactions: number };
};

/** One `getEvents` exchange, as it happened. */
export type CapturedPage = {
  request: { startLedger?: number; cursor?: string; limit: number };
  response: GetEventsResponse;
};

export type Fixture = {
  directory: string;
  manifest: FixtureManifest;
  pages: CapturedPage[];
  /** Every captured event, in the order the server returned them. */
  events: RawEvent[];
  transactions: Record<string, GetTransactionResponse>;
};

export class FixtureError extends Error {}

export const MANIFEST_FILE = "manifest.json";
export const PAGES_FILE = "pages.json";
export const TRANSACTIONS_FILE = "transactions.json";

export function loadFixture(directory: string): Fixture {
  const manifest = read<FixtureManifest>(directory, MANIFEST_FILE);
  const pages = read<CapturedPage[]>(directory, PAGES_FILE);
  const transactions = read<Record<string, GetTransactionResponse>>(
    directory,
    TRANSACTIONS_FILE,
  );

  // Flattened here rather than stored flat: the pages are the record, and the
  // event list is a view of them. Ids are unique and ascending, so the order
  // the server produced is the order everything downstream sees.
  const events = pages.flatMap((page) => page.response.events);

  if (manifest.range.endLedger < manifest.range.startLedger) {
    throw new FixtureError(`${directory}: the manifest's ledger range runs backwards`);
  }

  return { directory, manifest, pages, events, transactions };
}

function read<T>(directory: string, file: string): T {
  const path = join(directory, file);
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new FixtureError(
      `could not read ${path}: ${reason}\n\n` +
        `  Fixtures are captured from testnet with:\n` +
        `      npm run capture -- --ledgers 200\n`,
    );
  }
}
