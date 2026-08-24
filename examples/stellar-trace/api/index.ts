/**
 * The proof view, adapted for Vercel's Node.js function runtime.
 *
 * There is no live indexer here — a serverless function cannot run the
 * `ingest` poll loop, and the platform's filesystem is read-only outside
 * `/tmp`. So this serves the same offline slice `npm run demo` does: the
 * committed `fixtures/testnet-slice` fixture, and a `demo.db` built from it
 * during `npm run vercel-build` (see package.json) rather than at request
 * time. Both are shipped into the function bundle via `vercel.json`'s
 * `includeFiles` and read back out through `process.cwd()`, which is where
 * Vercel places them.
 *
 * `TraceStore.open` always opens its file read-write (it turns on WAL, which
 * needs to create `-wal`/`-shm` siblings), so the bundled `demo.db` is copied
 * into `/tmp` — the one writable directory here — on cold start, and reused
 * for the lifetime of that instance.
 */
import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { TraceStore } from "../src/db.js";
import { DEFAULT_FIXTURE_DIR, loadFixture } from "../src/offline/fixtures.js";
import { OfflineRpc } from "../src/offline/replay.js";
import { createRequestListener, type RequestListener } from "../src/web/server.js";

let listener: RequestListener | undefined;

function getListener(): RequestListener {
  if (listener) return listener;

  const bundledDb = path.join(process.cwd(), "demo.db");
  const runtimeDb = path.join("/tmp", "demo.db");
  if (!existsSync(runtimeDb) && existsSync(bundledDb)) {
    copyFileSync(bundledDb, runtimeDb);
  }

  const fixture = loadFixture(path.join(process.cwd(), DEFAULT_FIXTURE_DIR));
  const store = TraceStore.open(runtimeDb);
  const source = new OfflineRpc(fixture);

  listener = createRequestListener({
    store,
    source,
    origin: { kind: "fixture", name: DEFAULT_FIXTURE_DIR },
    window: {
      oldestLedger: fixture.manifest.range.startLedger,
      latestLedger: fixture.manifest.range.endLedger,
    },
  });
  return listener;
}

export default function handler(request: IncomingMessage, response: ServerResponse) {
  return getListener()(request, response);
}
