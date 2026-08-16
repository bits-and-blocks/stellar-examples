/**
 * Read `stellar contract info meta --output json` on stdin, emit the SEP-58
 * vocabulary fields as TSV (`key<TAB>value`) in the order they appear.
 *
 * Order is preserved because the fields are replayed back through --meta on
 * rebuild, and the meta lands inside the Wasm — so the order they are written
 * in is part of what gets hashed. Replaying in read order reproduces it without
 * either side having to agree on a canonical sort.
 *
 * Exit codes:
 *   0  fields found and well-formed
 *   3  no SEP-58 build metadata present
 *   4  a field is present but malformed
 *
 * Format regexes are copied verbatim from SEP-58 v0.6.0 §1 and §2. A value that
 * fails its regex is "not conformant" per the spec, and we refuse it rather
 * than trying to be helpful — a verifier that repairs sloppy metadata teaches
 * producers that sloppy metadata is fine.
 */
const FORMATS = {
  bldimg: /^(?:localhost(?::\d+)?|[^\s@/]*[.:][^\s@/]*)\/[^\s@]+@sha256:[0-9a-f]{64}$/,
  bldopt: /^--[A-Za-z][A-Za-z0-9_-]*(=.+)?$/,
  bldarg: /^.+$/,
  source_sha256: /^[0-9a-f]{64}$/,
  source_uri: /^[a-zA-Z][a-zA-Z0-9+.-]*:\S+$/,
};

const raw = await new Promise((resolve) => {
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (d) => (buf += d));
  process.stdin.on("end", () => resolve(buf));
});

let entries;
try {
  entries = JSON.parse(raw.trim() || "[]");
} catch {
  console.error("could not parse contract meta as JSON");
  process.exit(4);
}

const fields = entries
  .map((e) => e.sc_meta_v0)
  .filter((e) => e && Object.hasOwn(FORMATS, e.key));

if (fields.length === 0) process.exit(3);

const malformed = fields.filter((f) => !FORMATS[f.key].test(f.val));
if (malformed.length > 0) {
  for (const f of malformed) {
    console.error(`  ${f.key}: ${JSON.stringify(f.val)}`);
    console.error(`    does not match SEP-58 format ${FORMATS[f.key]}`);
  }
  process.exit(4);
}

// A tab in a value would corrupt the TSV the shell reads back. No SEP-58 field
// can legitimately contain one (every format regex forbids whitespace except
// bldarg, which is free-form), so treat it as malformed rather than emitting
// output the caller would silently misparse.
for (const f of fields) {
  if (f.val.includes("\t") || f.val.includes("\n")) {
    console.error(`  ${f.key}: contains a tab or newline, which is not replayable`);
    process.exit(4);
  }
}

process.stdout.write(fields.map((f) => `${f.key}\t${f.val}`).join("\n") + "\n");
