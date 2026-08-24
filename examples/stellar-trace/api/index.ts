/**
 * The proof view, adapted for Vercel's Node.js function runtime.
 *
 * There is no live indexer here — a serverless function cannot run the
 * `ingest` poll loop, and getting a file onto the platform's filesystem at
 * request time is unreliable across a monorepo's function-bundling rules.
 * So nothing here is read off disk at request time at all: the fixture and
 * `trace.config.json` are imported as JSON, which `esbuild` (what both
 * `tsx` and Vercel's function builder run on) resolves and inlines into the
 * function bundle at build time — the same guarantee a `.ts` import gets,
 * and one a bundled *file path* does not.
 *
 * The one thing that can't be inlined that way is the SQLite database:
 * `better-sqlite3` needs a real file to open. Rather than ship a prebuilt
 * one and hope it lands somewhere findable, this rebuilds it — in `/tmp`,
 * the one writable path here — from the imported fixture on cold start, the
 * same `ingest` call `npm run ingest -- --offline --once` makes locally.
 */
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import manifest from "../fixtures/testnet-slice/manifest.json" with { type: "json" };
import pages from "../fixtures/testnet-slice/pages.json" with { type: "json" };
import transactions from "../fixtures/testnet-slice/transactions.json" with { type: "json" };
import traceConfig from "../trace.config.json" with { type: "json" };

import { parseConfig, type TraceConfigFile } from "../src/config.js";
import { TraceStore } from "../src/db.js";
import { ingest } from "../src/ingest.js";
import { createLogger } from "../src/log.js";
import {
  assembleFixture,
  type CapturedPage,
  type FixtureManifest,
} from "../src/offline/fixtures.js";
import { OfflineRpc } from "../src/offline/replay.js";
import type { GetTransactionResponse } from "../src/rpc.js";
import { createRequestListener, type RequestListener } from "../src/web/server.js";

let listener: Promise<RequestListener> | undefined;

async function buildListener(): Promise<RequestListener> {
  const log = createLogger({ format: "json" });

  const fixture = assembleFixture(
    "fixtures/testnet-slice",
    manifest as FixtureManifest,
    pages as CapturedPage[],
    transactions as unknown as Record<string, GetTransactionResponse>,
  );
  const config = parseConfig("trace.config.json", traceConfig as TraceConfigFile);
  const rpc = new OfflineRpc(fixture);

  const store = TraceStore.open(path.join("/tmp", "demo.db"));
  await ingest({ config, store, rpc, log, once: true, startLedger: "oldest" });

  return createRequestListener({
    store,
    source: rpc,
    origin: { kind: "fixture", name: "fixtures/testnet-slice" },
    window: {
      oldestLedger: fixture.manifest.range.startLedger,
      latestLedger: fixture.manifest.range.endLedger,
    },
  });
}

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  listener ??= buildListener();
  return (await listener)(request, response);
}
