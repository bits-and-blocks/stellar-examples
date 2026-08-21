import assert from "node:assert/strict";
import { test } from "node:test";

import { cursorForLedger, ledgerOf, parseEventId, ToidError } from "../src/toid.js";

test("an event id decodes to its position", () => {
  // Straight off a testnet getEvents response.
  assert.deepEqual(parseEventId("0018234000187334656-0000000002"), {
    ledger: 4245434,
    txIndex: 2,
    opIndex: 0,
    eventIndex: 2,
  });
});

test("an empty-page cursor decodes to the last ledger the server scanned", () => {
  // The server returned this for a filter that matched nothing over ledgers
  // 4130000..4245000: it stopped at 4139999, exactly 10,000 ledgers in.
  assert.equal(ledgerOf("0017781164605439999-4294967295"), 4139999);
  assert.equal(cursorForLedger(4139999), "0017781164605439999-4294967295");
});

test("anything else is refused rather than decoded to ledger 0", () => {
  assert.throws(() => parseEventId("nonsense"), ToidError);
  assert.throws(() => parseEventId("123"), ToidError);
  assert.throws(() => parseEventId("12-34-56"), ToidError);
});
