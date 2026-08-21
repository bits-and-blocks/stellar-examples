/**
 * The page, against a real server on a real port.
 *
 * Every test here is about a state a reader can reach, and most of them are
 * about the states that go wrong. A proof view that renders a trace is easy;
 * one that says something true when it has nothing to render is the part worth
 * testing, because a blank result reads as "nothing happened" and that is the
 * one thing this page must never imply.
 *
 * The server is served from the committed fixture, so these tests need no
 * network — the fixture is loaded before `fetch` is replaced, and the only
 * `fetch` calls are to localhost.
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";

import { loadConfig } from "../src/config.js";
import { TraceStore } from "../src/db.js";
import { ingest } from "../src/ingest.js";
import { createLogger } from "../src/log.js";
import { DEFAULT_FIXTURE_DIR, loadFixture } from "../src/offline/fixtures.js";
import { OfflineRpc } from "../src/offline/replay.js";
import { createProofView } from "../src/web/server.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const fixture = loadFixture(join(ROOT, DEFAULT_FIXTURE_DIR));
const config = loadConfig(join(ROOT, "trace.config.json"));
const log = createLogger({ format: "text", level: "error" });
const dir = mkdtempSync(join(tmpdir(), "stellar-trace-web-"));

const { range } = fixture.manifest;
/** A transaction the fixture holds meta for, from the newest ledgers. */
const KNOWN = Object.keys(fixture.transactions)[0] as string;
const UNKNOWN = "0".repeat(64);

type Running = { url: string; store: TraceStore; server: Server };
const running: Running[] = [];

/** A server over a database ingested up to `endLedger`. */
async function serve(name: string, endLedger?: number): Promise<Running> {
  const store = TraceStore.open(join(dir, `${name}.db`));
  await ingest({
    config,
    store,
    rpc: new OfflineRpc(fixture),
    log,
    startLedger: "oldest",
    once: true,
    ...(endLedger === undefined ? {} : { endLedger }),
  });

  const server = createProofView({
    store,
    source: new OfflineRpc(fixture),
    origin: { kind: "fixture", name: DEFAULT_FIXTURE_DIR },
    window: { oldestLedger: range.startLedger, latestLedger: range.endLedger },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const instance = {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    store,
    server,
  };
  running.push(instance);
  return instance;
}

let full: Running;
let partial: Running;
let empty: Running;

before(async () => {
  full = await serve("full");
  // Ingested only the first few ledgers, so the newest transactions are
  // fetchable but outside what this deployment indexed.
  partial = await serve("partial", range.startLedger + 2);
  empty = await serveEmpty();
});

async function serveEmpty(): Promise<Running> {
  const store = TraceStore.open(join(dir, "empty.db"));
  const server = createProofView({
    store,
    source: new OfflineRpc(fixture),
    origin: { kind: "fixture", name: DEFAULT_FIXTURE_DIR },
    window: { oldestLedger: range.startLedger, latestLedger: range.endLedger },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const instance = {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    store,
    server,
  };
  running.push(instance);
  return instance;
}

after(async () => {
  for (const instance of running) {
    await new Promise<void>((resolve) => instance.server.close(() => resolve()));
    instance.store.close();
  }
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const get = async (base: string, path: string) => {
  const response = await fetch(`${base}${path}`);
  return { status: response.status, body: await response.text() };
};

test("the home page states the indexed range and suggests transactions", async () => {
  const { status, body } = await get(full.url, "/");
  assert.equal(status, 200);
  assert.match(body, new RegExp(`Indexed <strong>ledgers ${range.startLedger}–${range.endLedger}`));
  assert.match(body, /captured fixture/);
  // Someone arriving with only the URL needs somewhere to start.
  assert.match(body, new RegExp(`/trace\\?tx=[0-9a-f]{64}`));
  assert.match(body, /XLM|USDC/, "the suggestions are decoded, not bare hashes");
});

test("a hash in the index renders the progression, entries and all", async () => {
  const { status, body } = await get(full.url, `/trace?tx=${KNOWN}`);
  assert.equal(status, 200);
  assert.match(body, new RegExp(KNOWN));
  assert.match(body, /in the index/);
  assert.match(body, /Fee and sequence number, before any operation ran/);
  // The claim of the whole track: a value, before and after.
  assert.match(body, /class="mono was">[^<]+<\/td><td class="mono now">/);
});

test("a hash outside the indexed range is explained, not blanked", async () => {
  const { status, body } = await get(partial.url, `/trace?tx=${KNOWN}`);
  assert.equal(status, 200);
  assert.match(body, /outside the indexed range/);
  assert.match(body, new RegExp(`starts at ledger\\s+${range.startLedger}`));
  // Still rendered: the index decides what can be suggested, not what can be
  // explained.
  assert.match(body, /Fee and sequence number/);
});

test("a hash nothing can produce names the window it fell outside", async () => {
  const { status, body } = await get(full.url, `/trace?tx=${UNKNOWN}`);
  assert.equal(status, 404);
  assert.match(body, /No such transaction here/);
  assert.match(body, new RegExp(`ledgers ${range.startLedger}–${range.endLedger}`));
  assert.doesNotMatch(body, /Fee and sequence number/, "nothing is rendered as if traced");
});

test("a malformed hash is refused without looking anything up", async () => {
  const { status, body } = await get(full.url, "/trace?tx=nope");
  assert.equal(status, 400);
  assert.match(body, /not a transaction hash/);
  assert.match(body, /64 hexadecimal characters/);
});

test("an empty index says so instead of looking broken", async () => {
  const { status, body } = await get(empty.url, "/");
  assert.equal(status, 200);
  assert.match(body, /nothing indexed yet/);
  assert.match(body, /npm run ingest/);
  assert.match(body, /nothing to suggest/);
});

test("what a reader types is escaped before it is echoed back", async () => {
  const { body } = await get(full.url, `/trace?tx=${encodeURIComponent("<script>x</script>")}`);
  assert.match(body, /&lt;script&gt;/);
  assert.doesNotMatch(body, /<script>x<\/script>/);
});

test("an unknown path is answered rather than left hanging", async () => {
  const { status, body } = await get(full.url, "/nope");
  assert.equal(status, 404);
  assert.match(body, /No such transaction here/);
});
