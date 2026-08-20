/**
 * `npm run demo` — the whole stack, with the network unplugged.
 *
 * Ingest a captured slice of testnet into a fresh database, list what it
 * holds, and trace one transaction down to the ledger entries it moved. Every
 * step runs the real command with the real code; only the bytes come from
 * `fixtures/` instead of from an RPC server.
 *
 * Each command is spawned with `scripts/no-network.ts` imported ahead of it,
 * which replaces `fetch` with something that throws. So a green demo is not
 * evidence that the network happened to be up — it is evidence that nothing
 * asked for it.
 */
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const HERE = fileURLToPath(new URL("..", import.meta.url));
// A file:// URL rather than a path: `--import` requires one for an absolute
// location, and a Windows path is not one.
const NO_NETWORK = new URL("./no-network.ts", import.meta.url).href;
const { values } = parseArgs({
  options: {
    // Overridable so a test can run the demo without writing into the project
    // it is testing.
    db: { type: "string", default: "demo.db" },
  },
});
const DB = values.db;

const run = (title: string, args: string[]): string => {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
  console.log(`$ ${args.join(" ")}\n`);

  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--import", NO_NETWORK, ...args],
    { cwd: HERE, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );

  if (result.status !== 0) {
    console.error(result.stdout);
    throw new Error(`${args[0]} exited ${result.status}`);
  }
  console.log(result.stdout.trimEnd());
  return result.stdout;
};

for (const suffix of ["", "-wal", "-shm"]) {
  rmSync(`${HERE}${DB}${suffix}`, { force: true });
}

console.log(
  "\nstellar-trace, offline\n" +
    "  Every command below runs with fetch replaced by a refusal, so nothing\n" +
    "  here can reach testnet. The data is a captured slice of it.",
);

run("1. Ingest the captured ledgers", [
  "src/bin/ingest.ts",
  "--offline",
  "--db",
  DB,
  "--once",
  "--log",
  "text",
]);

const listing = run("2. What the database holds", [
  "scripts/recent.ts",
  "--db",
  DB,
  "--limit",
  "5",
]);

// Trace whichever transaction the listing suggested, so the demo follows the
// fixture rather than a hash written down when it was captured.
const suggested = /npm run trace -- ([0-9a-f]{64})/.exec(listing)?.[1];
if (!suggested) throw new Error("the listing named no transaction to trace");

run("3. Trace one of them", ["src/bin/trace.ts", "--offline", suggested]);

console.log(
  "\n\x1b[1mThat was the whole stack with the network unplugged.\x1b[0m\n" +
    "  Recapture with: npm run capture -- --ledgers 200\n",
);
