import assert from "node:assert/strict";
import { test } from "node:test";

import { Asset } from "@stellar/stellar-sdk";

import { loadConfig } from "../src/config.js";
import { encodeFilters, encodeTopicSegment, fingerprintFilters, FilterError } from "../src/filters.js";
import { NETWORK_PASSPHRASE } from "../src/network.js";

test("symbols encode to the base64 ScVal the RPC server matches on", () => {
  // Compared against a live testnet response, not just against the SDK.
  assert.equal(encodeTopicSegment("transfer"), "AAAADwAAAAh0cmFuc2Zlcg==");
  assert.equal(encodeTopicSegment("mint"), "AAAADwAAAARtaW50");
  assert.equal(encodeTopicSegment("burn"), "AAAADwAAAARidXJu");
});

test("wildcards and raw XDR pass through", () => {
  assert.equal(encodeTopicSegment("*"), "*");
  assert.equal(encodeTopicSegment("base64:AAAADwAAAARtaW50"), "AAAADwAAAARtaW50");
});

test("a segment that is neither is refused rather than encoded oddly", () => {
  assert.throws(() => encodeTopicSegment("not a symbol"), FilterError);
  assert.throws(() => encodeTopicSegment("base64:!!!"), FilterError);
});

test("the RPC server's own limits are checked before the request", () => {
  assert.throws(() => encodeFilters([]), FilterError);
  assert.throws(() => encodeFilters(Array(6).fill({ type: "contract" })), FilterError);
  assert.throws(
    () => encodeFilters([{ topics: [["transfer", "*", "*", "*", "*"]] }]),
    FilterError,
  );
  assert.throws(() => encodeFilters([{ contractIds: ["nope"] }]), FilterError);
  assert.throws(() => encodeFilters([{ type: "diagnostic" as never }]), FilterError);
});

test("the fingerprint ignores ordering but not content", () => {
  const a = encodeFilters([{ contractIds: ["C".padEnd(56, "A")], topics: [["mint", "*"], ["burn", "*"]] }]);
  const b = encodeFilters([{ contractIds: ["C".padEnd(56, "A")], topics: [["burn", "*"], ["mint", "*"]] }]);
  const c = encodeFilters([{ contractIds: ["C".padEnd(56, "A")], topics: [["burn", "*"]] }]);
  assert.equal(fingerprintFilters(a), fingerprintFilters(b));
  assert.notEqual(fingerprintFilters(a), fingerprintFilters(c));
});

test("the shipped config names the testnet SACs, derived rather than trusted", () => {
  const config = loadConfig();
  const ids = config.filters[0]?.contractIds ?? [];
  const xlm = Asset.native().contractId(NETWORK_PASSPHRASE);
  const usdc = new Asset(
    "USDC",
    "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  ).contractId(NETWORK_PASSPHRASE);
  assert.deepEqual([...ids].sort(), [xlm, usdc].sort());
});
