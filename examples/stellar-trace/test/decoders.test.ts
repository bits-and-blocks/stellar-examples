/**
 * The SAC decoders, against events that really happened.
 *
 * Every fixture in `sac-events.json` is a `getEvents` result from testnet with
 * its topics and value left as base64 XDR — the same bytes the ingest stores,
 * so these tests exercise the path a decoder actually runs on.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { nativeToScVal, xdr } from "@stellar/stellar-sdk";

import { decoders } from "../src/decoders/index.js";
import type { EventInput } from "../src/decoders/types.js";

type Fixture = {
  note: string;
  contractId: string;
  topicsXdr: string[];
  valueXdr: string;
};

const FIXTURES = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/sac-events.json", import.meta.url)), "utf8"),
) as Fixture[];

const asInput = (fixture: Fixture): EventInput => ({
  contractId: fixture.contractId,
  topics: fixture.topicsXdr.map((topic) => xdr.ScVal.fromXDR(topic, "base64")),
  data: xdr.ScVal.fromXDR(fixture.valueXdr, "base64"),
});

const find = (fragment: string): Fixture => {
  const found = FIXTURES.filter((fixture) => fixture.note.includes(fragment));
  assert.equal(found.length, 1, `expected one fixture matching "${fragment}"`);
  return found[0] as Fixture;
};

const decode = (fragment: string) => decoders.decode(asInput(find(fragment)));

test("a classic payment decodes as a transfer of XLM", () => {
  const decoded = decode("a classic payment");
  assert.ok(decoded);
  assert.equal(decoded.kind, "transfer");
  assert.equal(decoded.fields["asset"], "native");
  assert.equal(decoded.fields["amount"], "10,000.0000000");
  assert.match(decoded.summary, /^10,000\.0000000 XLM from G/);
});

test("a muxed destination puts the amount in a map, and it still decodes", () => {
  // The case that decodes fine until the first payment to an exchange goes
  // past: the value is {amount, to_muxed_id} rather than an i128.
  const decoded = decode("a transfer to a muxed destination");
  assert.ok(decoded);
  assert.equal(decoded.kind, "transfer");
  assert.equal(decoded.fields["amount"], "0.0000001");
  assert.equal(decoded.fields["to_muxed_id"], "XLM e2e monitor transaction");
  assert.match(decoded.summary, /muxed: XLM e2e monitor transaction/);
});

test("mint, burn, clawback and approve each decode to their own shape", () => {
  const mint = decode("mint: the recipient");
  assert.equal(mint?.kind, "mint");
  assert.ok(mint?.fields["to"]?.startsWith("G"));
  assert.equal(mint?.fields["admin"], undefined);

  const burn = decode("burn");
  assert.equal(burn?.kind, "burn");
  assert.match(burn?.summary ?? "", /burned from G/);

  const clawback = decode("clawback");
  assert.equal(clawback?.kind, "clawback");
  assert.match(clawback?.summary ?? "", /clawed back from G/);

  const approve = decode("approve");
  assert.equal(approve?.kind, "approve");
  assert.equal(approve?.fields["expires at ledger"], "4238504");
  assert.ok(approve?.fields["spender"]?.startsWith("C"));
});

test("the fee event decodes, and a negative one is a refund", () => {
  const fee = decode("the fee every classic transaction");
  assert.equal(fee?.kind, "fee");
  assert.match(fee?.summary ?? "", /XLM fee from G/);

  // Every Soroban transaction emits a second fee event after its operations,
  // returning the reserved resource fee it did not spend. Same shape, negative
  // amount — read as a charge, it would double-count the fee.
  const refunded: EventInput = {
    ...asInput(find("the fee every classic transaction")),
    data: nativeToScVal(-24_557n, { type: "i128" }),
  };
  const refund = decoders.decode(refunded);
  assert.equal(refund?.kind, "fee");
  assert.match(refund?.summary ?? "", /^0\.0024557 XLM refunded to G/);
  assert.deepEqual(refund?.notes, [
    "negative: the unused part of a reserved resource fee",
  ]);
});

test("the emitting contract is checked against the asset it names", () => {
  const honest = decode("a classic payment");
  assert.deepEqual(honest?.notes, [
    "emitted by native's Stellar Asset Contract, derived and matched",
  ]);

  // The same event, claimed by a contract that is not XLM's SAC. Nothing about
  // the topics changed — which is the point: the topics are the claim, and the
  // contract's address is what settles it.
  const impostor = decoders.decode({
    ...asInput(find("a classic payment")),
    contractId: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  });
  assert.equal(impostor?.kind, "transfer");
  assert.match(impostor?.notes[0] ?? "", /is not native's Stellar Asset Contract/);
  // And with the asset unestablished, seven decimal places is not a claim this
  // tool is entitled to make.
  assert.equal(impostor?.fields["amount"], "100000000000");
});

test("an event that only shares a name with the token interface is declined", () => {
  // A contract emitting a one-topic `transfer` of its own design, and another
  // whose three-topic `mint` names an address where the asset would be. Both
  // are real, both are legitimate, and neither is the token interface.
  assert.equal(decode("its own one-topic transfer"), null);
  assert.equal(decode("three-topic mint names an address"), null);
});

test("every fixture either decodes or declines, and none throws", () => {
  for (const fixture of FIXTURES) {
    const decoded = decoders.decode(asInput(fixture));
    if (decoded === null) continue;
    assert.ok(decoded.summary.length > 0, fixture.note);
    assert.ok(decoded.kind.length > 0, fixture.note);
  }
});
