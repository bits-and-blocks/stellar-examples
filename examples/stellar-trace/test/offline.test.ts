/**
 * The whole stack, offline, with `fetch` taken away.
 *
 * `npm run demo` is the version of this a person watches. This is the version
 * CI runs: same fixture, same code, and the network replaced by something that
 * throws — so a passing test cannot be a passing test that quietly reached
 * testnet.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import { loadConfig } from "../src/config.js";
import { TraceStore } from "../src/db.js";
import { ingest } from "../src/ingest.js";
import { createLogger } from "../src/log.js";
import { decodeTransaction } from "../src/meta/decode.js";
import { renderTransaction } from "../src/meta/render.js";
import { DEFAULT_FIXTURE_DIR, FixtureError, loadFixture } from "../src/offline/fixtures.js";
import { OfflineRpc } from "../src/offline/replay.js";
import { RpcError } from "../src/rpc.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const fixture = loadFixture(join(ROOT, DEFAULT_FIXTURE_DIR));
const config = loadConfig(join(ROOT, "trace.config.json"));
const log = createLogger({ format: "text", level: "error" });

const dir = mkdtempSync(join(tmpdir(), "stellar-trace-offline-"));
const realFetch = globalThis.fetch;

before(() => {
  globalThis.fetch = (() => {
    throw new Error("a test reached for the network");
  }) as unknown as typeof fetch;
});

after(() => {
  globalThis.fetch = realFetch;
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("the fixture is a coherent slice of testnet", () => {
  const { manifest, events, transactions } = fixture;
  assert.equal(manifest.network.passphrase, "Test SDF Network ; September 2015");
  assert.equal(manifest.counts.events, events.length);
  assert.ok(events.length > 0, "a fixture with no events would demonstrate nothing");
  assert.ok(Object.keys(transactions).length > 0);

  // Every ledger it claims to cover, and none it does not.
  for (const event of events) {
    assert.ok(event.ledger >= manifest.range.startLedger, event.id);
    assert.ok(event.ledger <= manifest.range.endLedger, event.id);
  }
  // Every transaction it holds meta for is one its events name.
  const named = new Set(events.map((event) => event.txHash));
  for (const hash of Object.keys(transactions)) assert.ok(named.has(hash), hash);
});

test("ingest fills a database from the fixture with no network at all", async () => {
  const store = TraceStore.open(join(dir, "offline.db"));
  const summary = await ingest({
    config,
    store,
    rpc: new OfflineRpc(fixture),
    log,
    startLedger: "oldest",
    once: true,
  });

  assert.equal(summary.stoppedBecause, "caught-up");
  assert.equal(summary.inserted, fixture.manifest.counts.events);
  assert.equal(store.stats().events, fixture.manifest.counts.events);
  assert.equal(store.readState()?.cursorLedger, fixture.manifest.range.endLedger);
  store.close();
});

test("a small --limit pages the same events, which a transcript could not", async () => {
  // The reason replay re-derives paging instead of replaying the recorded
  // request/response pairs: this run asks questions the capture never asked.
  const store = TraceStore.open(join(dir, "paged.db"));
  const summary = await ingest({
    config: { ...config, pageLimit: 7 },
    store,
    rpc: new OfflineRpc(fixture),
    log,
    startLedger: "oldest",
    once: true,
  });

  assert.ok(summary.pages > 10, `expected many pages, got ${summary.pages}`);
  assert.equal(summary.inserted, fixture.manifest.counts.events);
  store.close();
});

test("a traced transaction renders from the fixture's own meta", () => {
  const [hash, record] = Object.entries(fixture.transactions)[0] ?? [];
  assert.ok(hash && record);

  const rendered = renderTransaction(decodeTransaction(record, hash));
  assert.match(rendered, new RegExp(`transaction ${hash}`));
  assert.match(rendered, /ledger \d+/);
  // Something moved, and the entry behind it is there.
  assert.match(rendered, /(created|updated|removed)/);
});

test("replay refuses the requests a real server refuses", async () => {
  const rpc = new OfflineRpc(fixture);
  const { range } = fixture.manifest;

  await assert.rejects(
    rpc.getEvents({ filters: config.filters, startLedger: range.startLedger - 1 }),
    (error: unknown) => error instanceof RpcError && error.retentionWindow !== null,
    "a ledger before the capture is outside the window, and says so in the server's words",
  );

  const missing = await rpc.getTransaction("0".repeat(64));
  assert.equal(missing.status, "NOT_FOUND");
  assert.equal(missing.oldestLedger, range.startLedger);
});

test("replaying against different filters is refused, not answered quietly", async () => {
  // The fixture holds what one filter set matched. Serving it to another would
  // look like a quiet network rather than a mismatch, and the difference
  // matters most when someone is repointing the example.
  const other = {
    ...config,
    filters: [{ type: "contract" as const, topics: [["AAAADwAAAARtaW50"]] }],
  };
  await assert.rejects(
    new OfflineRpc(fixture).getEvents({ filters: other.filters }),
    FixtureError,
  );
});
