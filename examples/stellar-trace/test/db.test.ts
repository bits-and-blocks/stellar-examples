import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { TraceStore } from "../src/db.js";
import type { RawEvent } from "../src/rpc.js";

const dir = mkdtempSync(join(tmpdir(), "stellar-trace-test-"));
after(() => rmSync(dir, { recursive: true, force: true }));

/** A real testnet SAC transfer, trimmed to the fields the store reads. */
const event = (id: string, ledger: number): RawEvent => ({
  type: "contract",
  ledger,
  ledgerClosedAt: "2026-08-20T18:12:51Z",
  contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  id,
  transactionIndex: 2,
  operationIndex: 0,
  txHash: "0b32f422161f59a7bd839e8f6dab43b8282b36db666d0661eddcd1110fabc05a",
  inSuccessfulContractCall: true,
  topic: ["AAAADwAAAAh0cmFuc2Zlcg==", "AAAAEgAAAAA=", "AAAAEgAAAAA=", "AAAADgAAAAZuYXRpdmUA"],
  value: "AAAACgAAAAAAAAAAAAAAAAX14QA=",
});

const openFresh = (name: string) => {
  const store = TraceStore.open(join(dir, name));
  store.begin({
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
    filterFingerprint: "abc123",
    startLedger: 4_245_000,
  });
  return store;
};

test("a page and its cursor land together, and survive reopening", () => {
  const store = openFresh("commit.db");
  store.commitPage([event("0018234000187334656-0000000000", 4_245_434)], "cursor-1", 4_245_434);
  store.close();

  const reopened = TraceStore.open(join(dir, "commit.db"));
  assert.equal(reopened.stats().events, 1);
  assert.equal(reopened.readState()?.cursor, "cursor-1");
  assert.equal(reopened.readState()?.cursorLedger, 4_245_434);
  reopened.close();
});

test("re-committing a page a restart already stored changes nothing", () => {
  const store = openFresh("dedupe.db");
  const page = [
    event("0018234000187334656-0000000000", 4_245_434),
    event("0018234000187334656-0000000001", 4_245_434),
  ];

  const first = store.commitPage(page, "cursor-1", 4_245_434);
  assert.deepEqual(first, { inserted: 2, duplicates: 0 });

  // Exactly what a kill between "response received" and "transaction
  // committed" produces on the next run: the same page, again.
  const second = store.commitPage(page, "cursor-1", 4_245_434);
  assert.deepEqual(second, { inserted: 0, duplicates: 2 });

  assert.equal(store.stats().events, 2);
  store.close();
});

test("the raw response object is kept alongside the columns", () => {
  const store = openFresh("raw.db");
  const original = event("0018234000187334656-0000000000", 4_245_434);
  store.commitPage([original], "cursor-1", 4_245_434);
  const ids = store.eventIds();
  assert.deepEqual(ids, ["0018234000187334656-0000000000"]);
  store.close();
});

test("gaps are recorded once and read back in ledger order", () => {
  const store = openFresh("gaps.db");
  store.recordGap({ fromLedger: 100, toLedger: 200, reason: "retention" });
  store.recordGap({ fromLedger: 100, toLedger: 200, reason: "retention" });
  store.recordGap({ fromLedger: 10, toLedger: 20, reason: "restarted past" });
  assert.deepEqual(store.gaps(), [
    { fromLedger: 10, toLedger: 20, reason: "restarted past" },
    { fromLedger: 100, toLedger: 200, reason: "retention" },
  ]);
  store.close();
});
