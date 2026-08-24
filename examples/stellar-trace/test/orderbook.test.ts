/**
 * The second contract's decoders, against the fixture that was already there.
 *
 * No new fixture file: these events sit inside the transaction meta committed
 * for the offline demo, which is the point being made — a decoder added later
 * reads data captured earlier, and needs nothing else to arrive with it.
 *
 * The last test is the one worth reading. It takes the decoder's claim about
 * `top_changed` and checks it against the contract's own ledger entry in the
 * same transaction: the two ticks in the event must be the before and after of
 * `["BestTick", market, side]`. That is this whole example's thesis, turned on
 * a contract nobody here wrote.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { Address, scValToNative, xdr } from "@stellar/stellar-sdk";

import { decoders } from "../src/decoders/index.js";
import { decodeTransaction, type TransactionRecord } from "../src/meta/decode.js";
import type { DecodedEvent } from "../src/decoders/types.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ORDER_BOOK = "CDX3WVFY6GV53J3XT53MNPE5HVKAGTCH74W3AWGMI43KUFK5TSXOU2RO";

const TRANSACTIONS = JSON.parse(
  readFileSync(join(ROOT, "fixtures/testnet-slice/transactions.json"), "utf8"),
) as Record<string, TransactionRecord>;

/** Every decoded event of one kind across the whole fixture. */
function decodedEvents(kind: string): DecodedEvent[] {
  const found: DecodedEvent[] = [];
  for (const [hash, record] of Object.entries(TRANSACTIONS)) {
    for (const step of decodeTransaction(record, hash).steps) {
      for (const event of step.events) {
        if (event.decoded?.kind === kind) found.push(event.decoded);
      }
    }
  }
  return found;
}

test("the fixture already holds this contract's events, undecoded until now", () => {
  const kinds = new Set<string>();
  for (const [hash, record] of Object.entries(TRANSACTIONS)) {
    for (const step of decodeTransaction(record, hash).steps) {
      for (const event of step.events) {
        if (event.contractId === ORDER_BOOK && event.decoded) kinds.add(event.decoded.kind);
      }
    }
  }
  assert.deepEqual([...kinds].sort(), ["rested", "settled", "top_changed"]);
});

test("rested names the order, the account and the tick", () => {
  const rested = decodedEvents("rested");
  assert.ok(rested.length > 0);

  const one = rested[0] as DecodedEvent;
  assert.equal(one.fields["market"], "1");
  assert.ok(one.fields["account"]?.startsWith("G"));
  assert.match(one.fields["order"] ?? "", /^\d+$/);
  assert.match(one.fields["tick"] ?? "", /^\d+$/);
  assert.match(one.summary, /^order \d+ from G\S+ rested at tick \d+ on market 1$/);
});

test("values with no name are kept, and said to be unnamed", () => {
  // Two of rested's six values appear in no storage key. Inventing names for
  // them would be exactly the confident wrong sentence the registry avoids.
  const one = decodedEvents("rested")[0] as DecodedEvent;
  assert.match(one.fields["unnamed values"] ?? "", /^\[\d+, \d+\]$/);
  assert.ok(one.notes.some((note) => note.includes("appear in no storage key")));
  assert.ok(one.notes.some((note) => note.includes("not against a published schema")));
});

test("settled decodes, and shares its order id with rested", () => {
  const settled = decodedEvents("settled");
  assert.ok(settled.length > 0);
  const one = settled[0] as DecodedEvent;
  assert.match(one.summary, /^order \d+ from G\S+ settled on market 1$/);

  // The same order id appears in both events, which is what corroborated the
  // field in the first place.
  const orders = new Set(decodedEvents("rested").map((event) => event.fields["order"]));
  assert.ok(settled.some((event) => orders.has(event.fields["order"])));
});

test("top_changed says what the contract's own BestTick entry did", () => {
  let checked = 0;

  for (const [hash, record] of Object.entries(TRANSACTIONS)) {
    const decoded = decodeTransaction(record, hash);
    const events = decoded.steps
      .flatMap((step) => step.events)
      .filter((event) => event.decoded?.kind === "top_changed");
    if (events.length === 0) continue;

    // What the entry actually did, read straight out of the same meta.
    const moves = bestTickMoves(record);

    for (const event of events) {
      const claim = event.decoded as DecodedEvent;
      const move = moves.get(`${claim.fields["market"]}|${claim.fields["side"]}`);
      assert.ok(move, `no BestTick entry changed for side ${claim.fields["side"]} in ${hash}`);
      assert.equal(claim.fields["from tick"], move.before, hash);
      assert.equal(claim.fields["to tick"], move.after, hash);
      checked += 1;
    }
  }

  assert.ok(checked > 0, "the fixture should hold at least one top_changed event");
});

/** `market|side` to the before and after tick of the contract's BestTick entry. */
function bestTickMoves(record: TransactionRecord): Map<string, { before: string; after: string }> {
  const meta = xdr.TransactionMeta.fromXDR(record.resultMetaXdr as string, "base64");
  const moves = new Map<string, { before: string; after: string }>();
  const pending = new Map<string, string>();

  for (const operation of meta.v4().operations()) {
    for (const change of operation.changes()) {
      const arm = change.switch().name;
      const entry =
        arm === "ledgerEntryState"
          ? change.state()
          : arm === "ledgerEntryUpdated"
            ? change.updated()
            : null;
      // `switch().name` rather than `arm()`: the two agree for contract data,
      // and only the former is in the typings.
      if (!entry || entry.data().switch().name !== "contractData") continue;

      const data = entry.data().contractData();
      if (Address.fromScAddress(data.contract()).toString() !== ORDER_BOOK) continue;

      const key = scValToNative(data.key()) as unknown[];
      if (!Array.isArray(key) || key[0] !== "BestTick") continue;

      const id = `${key[1]}|${key[2]}`;
      const tick = String((scValToNative(data.val()) as { tick: unknown }).tick);
      if (arm === "ledgerEntryState") pending.set(id, tick);
      else moves.set(id, { before: pending.get(id) ?? "", after: tick });
    }
  }
  return moves;
}
