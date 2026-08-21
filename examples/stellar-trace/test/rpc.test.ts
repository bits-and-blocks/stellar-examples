import assert from "node:assert/strict";
import { test } from "node:test";

import { RpcError } from "../src/rpc.js";

test("a retention-window refusal is recognised, with its bounds", () => {
  // Verbatim from soroban-testnet.stellar.org, asked to resume from a cursor
  // older than the retention window.
  const error = new RpcError(
    -32600,
    "startLedger must be within the ledger range: 4124535 - 4245494",
  );
  assert.deepEqual(error.retentionWindow, { oldest: 4124535, latest: 4245494 });
});

test("other refusals are not mistaken for it", () => {
  assert.equal(new RpcError(-32602, "invalid parameters").retentionWindow, null);
  assert.equal(new RpcError(-32600, "something else entirely").retentionWindow, null);
});
