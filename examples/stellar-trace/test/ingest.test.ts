/**
 * The loop's decisions, driven by a scripted server instead of testnet.
 *
 * The one that matters is the scan cap: an empty page whose cursor has not
 * reached `latestLedger` means the server stopped scanning early, and asking
 * again immediately is the difference between catching up and falling behind
 * by 10,000 ledgers a poll forever.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { loadConfig } from "../src/config.js";
import { TraceStore } from "../src/db.js";
import { EXIT, IngestError, ingest } from "../src/ingest.js";
import { createLogger } from "../src/log.js";
import { NETWORK_PASSPHRASE } from "../src/network.js";
import { RpcError } from "../src/rpc.js";
import type { EventSource, GetEventsRequest, GetEventsResponse, RawEvent } from "../src/rpc.js";
import { cursorForLedger } from "../src/toid.js";

const dir = mkdtempSync(join(tmpdir(), "stellar-trace-ingest-"));
// maxRetries: Windows can hold a just-closed SQLite file open a moment longer
// than the process that closed it.
after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const config = loadConfig();
const log = createLogger({ format: "text", level: "error" });
const store = (name: string) => TraceStore.open(join(dir, `${name}.db`));

const event = (ledger: number, index: number): RawEvent => ({
  type: "contract",
  ledger,
  ledgerClosedAt: "2026-08-20T18:12:51Z",
  contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  id: `${(BigInt(ledger) << 32n).toString().padStart(19, "0")}-${String(index).padStart(10, "0")}`,
  transactionIndex: 0,
  operationIndex: 0,
  txHash: "0b32f422161f59a7bd839e8f6dab43b8282b36db666d0661eddcd1110fabc05a",
  inSuccessfulContractCall: true,
  topic: ["AAAADwAAAAh0cmFuc2Zlcg=="],
  value: "AAAACgAAAAAAAAAAAAAAAAX14QA=",
});

/** A server that hands back a scripted list of pages, recording the asks. */
function scripted(pages: Array<Partial<GetEventsResponse>>, latestLedger = 1_000_000): {
  source: EventSource;
  requests: GetEventsRequest[];
} {
  const requests: GetEventsRequest[] = [];
  let next = 0;
  return {
    requests,
    source: {
      getNetwork: async () => ({ passphrase: NETWORK_PASSPHRASE, protocolVersion: 27 }),
      getHealth: async () => ({
        status: "healthy",
        oldestLedger: 900_000,
        latestLedger,
        ledgerRetentionWindow: 120_960,
      }),
      getEvents: async (request) => {
        const { filters, limit, ...range } = request;
        requests.push(range as GetEventsRequest);
        const page = pages[next++];
        assert.ok(page, `the loop asked for page ${next}, which was not scripted`);
        return {
          events: [],
          cursor: cursorForLedger(latestLedger),
          latestLedger,
          oldestLedger: 900_000,
          latestLedgerCloseTime: "0",
          oldestLedgerCloseTime: "0",
          ...page,
        };
      },
    },
  };
}

test("an empty page short of the tip is asked again, not slept on", async () => {
  // Three empty pages walking 10,000 ledgers at a time, then one that reaches
  // the tip. A loop that read "no events" as "caught up" would stop at one.
  const { source, requests } = scripted(
    [
      { cursor: cursorForLedger(970_000) },
      { cursor: cursorForLedger(980_000) },
      { cursor: cursorForLedger(990_000) },
      { cursor: cursorForLedger(1_000_000) },
    ],
    1_000_000,
  );

  const db = store("scan-cap");
  const summary = await ingest({
    config,
    store: db,
    rpc: source,
    log,
    startLedger: 960_000,
    once: true,
  });

  assert.equal(summary.pages, 4);
  assert.equal(summary.events, 0);
  assert.equal(summary.stoppedBecause, "caught-up");
  // The first ask is by ledger, every one after it by the cursor it was given.
  assert.deepEqual(requests[0], { startLedger: 960_000 });
  assert.deepEqual(requests[1], { cursor: cursorForLedger(970_000) });
  assert.equal(db.readState()?.cursorLedger, 1_000_000);
  db.close();
});

test("a full page is not caught up even when its cursor reaches the tip", async () => {
  const full = Array.from({ length: config.pageLimit }, (_, i) => event(1_000_000, i));
  const { source } = scripted(
    [
      { events: full, cursor: full[full.length - 1]!.id },
      { events: [event(1_000_000, config.pageLimit)], cursor: cursorForLedger(1_000_000) },
    ],
    1_000_000,
  );

  const db = store("full-page");
  const summary = await ingest({ config, store: db, rpc: source, log, startLedger: 1_000_000, once: true });

  assert.equal(summary.pages, 2);
  assert.equal(summary.events, config.pageLimit + 1);
  db.close();
});

test("--end-ledger drops the overshoot and stores a cursor that matches", async () => {
  const { source } = scripted([
    {
      events: [event(950_100, 0), event(950_500, 0), event(951_500, 0)],
      cursor: cursorForLedger(952_000),
    },
  ]);

  const db = store("end-ledger");
  const summary = await ingest({
    config,
    store: db,
    rpc: source,
    log,
    startLedger: 950_000,
    endLedger: 951_000,
    once: true,
  });

  assert.equal(summary.stoppedBecause, "end-ledger");
  assert.equal(summary.events, 2);
  assert.equal(db.readState()?.cursor, cursorForLedger(951_000));
  db.close();
});

test("a database resumes from its cursor and ignores --start-ledger", async () => {
  const first = scripted([{ events: [event(950_000, 0)], cursor: cursorForLedger(1_000_000) }]);
  const db = store("resume");
  await ingest({ config, store: db, rpc: first.source, log, startLedger: 950_000, once: true });
  db.close();

  const again = store("resume");
  const second = scripted([{ cursor: cursorForLedger(1_000_000) }]);
  await ingest({ config, store: again, rpc: second.source, log, startLedger: 912_345, once: true });
  assert.deepEqual(second.requests[0], { cursor: cursorForLedger(1_000_000) });
  again.close();
});

test("a page the server calls too expensive is retried smaller", async () => {
  const { source } = scripted([{ cursor: cursorForLedger(1_000_000) }]);
  const asked: Array<number | undefined> = [];
  let refusals = 2;

  const throttling: EventSource = {
    ...source,
    getEvents: async (request) => {
      asked.push(request.limit);
      if (refusals-- > 0) {
        throw new RpcError(-32001, "request exceeded processing limit threshold");
      }
      return source.getEvents(request);
    },
  };

  const db = store("throttled");
  const summary = await ingest({
    config,
    store: db,
    rpc: throttling,
    log,
    startLedger: 950_000,
    once: true,
  });

  // Halved per refusal, rather than the same ask repeated until it gives up.
  assert.deepEqual(asked, [config.pageLimit, config.pageLimit / 2, config.pageLimit / 4]);
  assert.equal(summary.stoppedBecause, "caught-up");
  db.close();
});

test("a mainnet passphrase stops it before anything is written", async () => {
  const { source } = scripted([]);
  const db = store("wrong-network");
  await assert.rejects(
    ingest({
      config,
      store: db,
      log,
      startLedger: 950_000,
      once: true,
      rpc: { ...source, getNetwork: async () => ({ passphrase: "Public Global Stellar Network ; September 2015", protocolVersion: 27 }) },
    }),
    (error: unknown) => error instanceof IngestError && error.exitCode === EXIT.wrongNetwork,
  );
  assert.equal(db.stats().events, 0);
  db.close();
});

test("a start ledger outside the retention window is refused", async () => {
  const { source } = scripted([]);
  const db = store("outside-window");
  await assert.rejects(
    ingest({ config, store: db, rpc: source, log, startLedger: 100, once: true }),
    (error: unknown) => error instanceof IngestError && error.exitCode === EXIT.usage,
  );
  db.close();
});
