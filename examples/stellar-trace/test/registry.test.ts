/**
 * The registry itself, and the property the repoint depends on.
 *
 * The second test in this file is the one that matters: it reads the source
 * tree and asserts that no code outside `src/decoders/` knows what a
 * `transfer` is. That is what "adding a decoder touches nothing else" means in
 * practice, and it is worth checking rather than intending — the leak that
 * makes a repoint expensive is never deliberate.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { nativeToScVal, xdr } from "@stellar/stellar-sdk";

import { ANY_CONTRACT, DecoderRegistry } from "../src/decoders/index.js";
import type { DecodedEvent, EventInput } from "../src/decoders/types.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const event = (topic: string, contractId: string | null = null): EventInput => ({
  contractId,
  topics: [nativeToScVal(topic, { type: "symbol" })],
  data: nativeToScVal(1n, { type: "i128" }),
});

const stub = (kind: string): DecodedEvent => ({
  kind,
  summary: kind,
  fields: {},
  notes: [],
});

test("a decoder is found by name, and by contract before name", () => {
  const registry = new DecoderRegistry()
    .register(ANY_CONTRACT, "deposit", () => stub("any"))
    .register("CONTRACT", "deposit", () => stub("specific"));

  assert.equal(registry.decode(event("deposit"))?.kind, "any");
  assert.equal(registry.decode(event("deposit", "OTHER"))?.kind, "any");
  // An exact registration wins, which is how one contract's own meaning for a
  // common event name overrides the general reading.
  assert.equal(registry.decode(event("deposit", "CONTRACT"))?.kind, "specific");
});

test("nothing registered, a declining decoder, and a nameless event all read the same", () => {
  const registry = new DecoderRegistry().register(ANY_CONTRACT, "deposit", () => null);

  assert.equal(registry.decode(event("withdraw")), null, "nothing registered");
  assert.equal(registry.decode(event("deposit")), null, "decoder declined");
  assert.equal(
    registry.decode({
      contractId: null,
      topics: [nativeToScVal(7, { type: "u32" })],
      data: xdr.ScVal.scvVoid(),
    }),
    null,
    "first topic is not a symbol, so there is no name to key on",
  );
  assert.equal(
    registry.decode({ contractId: null, topics: [], data: xdr.ScVal.scvVoid() }),
    null,
    "no topics at all",
  );
});

test("registering the same key twice is refused rather than silently winning", () => {
  const registry = new DecoderRegistry().register(ANY_CONTRACT, "deposit", () => stub("first"));
  assert.throws(
    () => registry.register(ANY_CONTRACT, "deposit", () => stub("second")),
    /already registered/,
  );
});

test("a whole decoder can be added without touching anything outside the registry", () => {
  // What the repoint looks like: a function, one `register` call, done. This
  // test imports nothing but the registry to make one and use it.
  const registry = new DecoderRegistry().register(
    "CPOOL",
    "deposit",
    ({ contractId }): DecodedEvent => ({
      kind: "deposit",
      summary: `a deposit into ${contractId}`,
      fields: { pool: contractId ?? "" },
      notes: [],
    }),
  );

  assert.equal(registry.decode(event("deposit", "CPOOL"))?.summary, "a deposit into CPOOL");
  assert.deepEqual(registry.registered(), ["CPOOL|deposit"]);
});

test("no code outside src/decoders knows what a transfer is", () => {
  // Event names the SAC decoders own. If one of these turns up in code
  // anywhere else, the ingest or the query path has learned a token's
  // vocabulary, and pointing this example at another contract stopped being a
  // change confined to one directory.
  const owned = ["transfer", "mint", "burn", "clawback", "approve"];

  const offenders: string[] = [];
  for (const file of sourceFiles(join(ROOT, "src")).concat(sourceFiles(join(ROOT, "scripts")))) {
    if (file.includes(join("src", "decoders"))) continue;
    const code = withoutComments(readFileSync(file, "utf8"));
    for (const name of owned) {
      if (new RegExp(`\\b${name}\\b`).test(code)) {
        offenders.push(`${file.slice(ROOT.length)}: ${name}`);
      }
    }
  }

  assert.deepEqual(offenders, []);
});

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

/**
 * Comments are exempt. A comment explaining that a SAC transfer carries four
 * topics is documentation; a branch on the string "transfer" is coupling.
 */
const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
