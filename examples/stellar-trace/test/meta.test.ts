/**
 * The decoder, against transactions that really happened.
 *
 * The fixtures are `getTransaction` responses from testnet, trimmed to the
 * fields a decoder reads, and the numbers asserted below are the balances
 * those accounts actually held. No network is touched, so these keep working
 * long after the transactions age out of the RPC's retention window — which,
 * for a fixture recording state that no method can return any more, is rather
 * the point.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { decodeTransaction, MetaError, type EntryChange } from "../src/meta/decode.js";
import { formatStroops } from "../src/format.js";
import { renderTransaction } from "../src/meta/render.js";
import type { TransactionRecord } from "../src/meta/decode.js";

const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));

/** A classic payment of 9.25 XLM, which emits a SAC transfer event. */
const PAYMENT = "476eb1bb01e3342ed6acaa5228f4e4c27f231eb5917872d71c0012e0eeafde8f";
/** A fee-bumped SAC transfer of USDXM from an account into a contract. */
const SAC_INTO_CONTRACT = "ea2c1ab722495a8ae5ab52a6afe65492ddaeb17ea55fb913fadbaf17b399f158";
/** A transaction that failed. */
const FAILED = "697eaf10912b4dcf4ec665d26422970ab22b953a87844f8fe6931229e034d92b";

const load = (hash: string) =>
  decodeTransaction(
    JSON.parse(readFileSync(join(FIXTURES, `${hash}.json`), "utf8")) as TransactionRecord,
    hash,
  );

/**
 * The one change matching a label, in a given phase.
 *
 * The phase is not optional, because an account routinely changes twice in one
 * transaction — once when its sequence number is bumped before any operation
 * runs, and again inside the operation — and a test that conflated the two
 * would be asserting on whichever came first.
 */
const changeIn = (hash: string, phase: string, label: string): EntryChange => {
  const found = load(hash)
    .steps.filter((step) => step.phase.kind === phase)
    .flatMap((step) => step.changes)
    .filter((change) => change.entry.label.includes(label));
  assert.equal(found.length, 1, `expected exactly one change to ${label} in ${phase}`);
  return found[0] as EntryChange;
};

test("a payment shows both accounts moving, before and after", () => {
  const tx = load(PAYMENT);
  assert.equal(tx.status, "SUCCESS");
  assert.equal(tx.metaVersion, 4);
  assert.equal(tx.ledger, 4245730);

  const sender = changeIn(PAYMENT, "operation", "GBRMG…RTUS");
  const receiver = changeIn(PAYMENT, "operation", "GAV6P…OU6O");

  const balance = (change: EntryChange, side: "before" | "after") =>
    change[side]?.["XLM balance"];

  // 9.25 XLM out of one account and into the other.
  assert.equal(balance(sender, "before"), "9,981.9999800 (99819999800)");
  assert.equal(balance(sender, "after"), "9,972.7499800 (99727499800)");
  assert.equal(balance(receiver, "before"), "10,018.0000000 (100180000000)");
  assert.equal(balance(receiver, "after"), "10,027.2500000 (100272500000)");
  assert.equal(sender.kind, "updated");
});

test("the fee is charged where the entry changes are not", () => {
  // The sender's balance moves by exactly the payment, not the payment plus
  // the fee: fee charging happens in its own phase, whose entry changes live
  // in the ledger close meta rather than in the transaction's. All the
  // transaction meta has to say about it is the CAP-67 fee event.
  const tx = load(PAYMENT);
  const setup = tx.steps.find((step) => step.phase.kind === "setup");
  assert.ok(setup);
  assert.equal(setup.events.length, 1);
  assert.deepEqual(setup.events[0]?.topics, [
    "fee",
    "GBRMGCKG7U2CX7LIWHP4SDSAO7OGXQDRTEJDBMPE27E5X4O73OV3RTUS",
  ]);
  assert.equal(setup.events[0]?.value, "100");
  assert.equal(tx.feeCharged, "100");

  // Before any operation runs, the source account changes only its sequence
  // number and the bookkeeping that goes with it. Not its balance — which is
  // the whole point: the 100 stroops never appear as an entry change.
  const setupChange = changeIn(PAYMENT, "setup", "GBRMG…RTUS");
  assert.deepEqual(
    setupChange.changed.map((diff) => diff.field),
    ["sequence", "sequence bumped in ledger", "sequence bumped at"],
  );
  assert.equal(setupChange.before?.["XLM balance"], setupChange.after?.["XLM balance"]);
});

test("a SAC transfer into a contract creates the contract's balance entry", () => {
  const tx = load(SAC_INTO_CONTRACT);
  assert.equal(tx.feeBump, true);
  assert.equal(tx.resultCode, "FeeBumpInnerSuccess");

  // Out of a trustline...
  const trustline = changeIn(SAC_INTO_CONTRACT, "operation", "trustline");
  assert.equal(trustline.kind, "updated");
  assert.equal(trustline.before?.["balance"], "900,994,962,179.1009330 (9009949621791009330)");
  assert.equal(trustline.after?.["balance"], "900,994,962,179.1008330 (9009949621791008330)");

  // ...and into a contract balance that did not exist until this transaction,
  // which is why it has a before of nothing rather than a before of zero.
  const balance = changeIn(SAC_INTO_CONTRACT, "operation", "balance of CDEMM…JAFJ");
  assert.equal(balance.kind, "created");
  assert.equal(balance.before, null);
  assert.equal(balance.after?.["amount"], "0.0001000 (1000)");
});

test("the transfer event and the entries it moved sit in the same step", () => {
  const tx = load(SAC_INTO_CONTRACT);
  const operation = tx.steps.find((step) => step.phase.kind === "operation");
  assert.ok(operation);
  assert.equal(operation.events.length, 1);
  assert.equal(operation.events[0]?.topics[0], "transfer");
  assert.equal(operation.events[0]?.value, "1000");
  assert.ok(
    operation.changes.some((change) => change.entry.label.startsWith("balance of")),
    "the balance the event describes should be in the same step as the event",
  );
});

test("an entry touched and written back unchanged says so", () => {
  // The inner source account of a fee bump: the meta records an update, and
  // the two entries are byte-identical.
  const change = changeIn(SAC_INTO_CONTRACT, "setup", "GDBZA…X475");
  assert.equal(change.kind, "updated");
  assert.deepEqual(change.changed, []);
  assert.equal(change.identical, true);
  assert.match(renderTransaction(load(SAC_INTO_CONTRACT)), /written back byte for byte identical/);
});

test("a failed transaction changed nothing but its sequence number", () => {
  const tx = load(FAILED);
  assert.equal(tx.status, "FAILED");
  assert.equal(tx.resultCode, "Failed");
  // No operation ran, so the meta carries no operation steps at all.
  assert.deepEqual(
    tx.steps.map((step) => step.phase.kind),
    ["setup"],
  );
  assert.match(renderTransaction(tx), /did not succeed/);
});

test("a response with no meta is refused rather than rendered empty", () => {
  assert.throws(() => decodeTransaction({ status: "SUCCESS" }, "abc"), MetaError);
});

test("stroops are formatted at seven decimals, negatives included", () => {
  assert.equal(formatStroops(0n), "0.0000000");
  assert.equal(formatStroops(1n), "0.0000001");
  assert.equal(formatStroops(100_000_000n), "10.0000000");
  assert.equal(formatStroops(-92_500_000n), "-9.2500000");
  assert.equal(formatStroops(9_009_949_621_791_009_330n), "900,994,962,179.1009330");
});
