/**
 * "Kill it mid-run and restart — no gap, no duplicates." Checked, not asserted.
 *
 * Two databases are filled from the same fixed range of testnet ledgers. The
 * first run is left alone. The second is killed with SIGKILL — no cleanup, no
 * flush, the case a graceful shutdown handler would hide — and restarted, over
 * and over, until it finishes on its own. Then the two are compared id by id.
 *
 * The range is historical and bounded, so both runs see identical data and the
 * comparison means something. Run it with:
 *
 *     npm run check:restart
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "../src/config.js";
import { TraceStore } from "../src/db.js";
import { createLogger } from "../src/log.js";
import { TraceRpc } from "../src/rpc.js";

const HERE = fileURLToPath(new URL("..", import.meta.url));
const CLI = join(HERE, "src", "bin", "ingest.ts");

/** Enough ledgers to need several pages at this limit, few enough to be quick. */
const LEDGER_SPAN = 2_000;
/** Events per request. Small, so a kill has plenty of page boundaries to miss. */
const PAGE_LIMIT = 400;
/** Stay back from the tip: ledgers still closing would differ between runs. */
const TIP_MARGIN = 50;

type Run = { code: number | null; pages: number; killed: boolean };

async function runIngest(args: string[], killAfterPages: number | null): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", CLI, ...args], {
      cwd: HERE,
      stdio: ["ignore", "pipe", "inherit"],
    });

    let pages = 0;
    let killed = false;
    let buffered = "";

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffered += chunk;
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const entry = JSON.parse(line) as { msg?: string };
        if (entry.msg !== "page") continue;
        pages += 1;
        if (killAfterPages !== null && pages >= killAfterPages && !killed) {
          // SIGKILL, not SIGINT: the point is the run that gets no chance to
          // tidy up. On Windows this is TerminateProcess, which is the same
          // abruptness.
          killed = true;
          child.kill("SIGKILL");
        }
      }
    });

    child.on("error", reject);
    child.on("exit", (code) => resolve({ code, pages, killed }));
  });
}

const check = (() => {
  let failures = 0;
  return {
    that(name: string, ok: boolean, detail = "") {
      console.log(`  ${ok ? "ok      " : "FAILED  "} ${name}${detail ? `  ${detail}` : ""}`);
      if (!ok) failures += 1;
    },
    get failures() {
      return failures;
    },
  };
})();

const dir = mkdtempSync(join(tmpdir(), "stellar-trace-restart-"));

try {
  const config = loadConfig(join(HERE, "trace.config.json"));
  const log = createLogger({ format: "text", level: "warn" });
  const rpc = new TraceRpc({ url: config.rpcUrl, log });

  const health = await rpc.getHealth();
  const endLedger = health.latestLedger - TIP_MARGIN;
  const startLedger = endLedger - LEDGER_SPAN;

  console.log(
    `\nrestart safety, testnet ledgers ${startLedger}-${endLedger}, ${PAGE_LIMIT} events per page\n`,
  );

  const common = [
    "--start-ledger",
    String(startLedger),
    "--end-ledger",
    String(endLedger),
    "--limit",
    String(PAGE_LIMIT),
    "--log",
    "json",
  ];

  const referencePath = join(dir, "reference.db");
  const reference = await runIngest([...common, "--db", referencePath], null);
  if (reference.code !== 0) {
    throw new Error(`the reference run exited ${reference.code}`);
  }
  console.log(`  reference run       ${reference.pages} pages, uninterrupted`);

  // Kill after the first page, then after the second, and so on, so the kill
  // lands somewhere new each time rather than always at the same boundary.
  const interruptedPath = join(dir, "interrupted.db");
  let attempts = 0;
  let kills = 0;
  let last: Run;
  do {
    attempts += 1;
    last = await runIngest([...common, "--db", interruptedPath], attempts);
    if (last.killed) kills += 1;
    if (!last.killed && last.code !== 0) {
      throw new Error(`the interrupted run exited ${last.code} without being killed`);
    }
    if (attempts > 20) throw new Error("gave up after 20 restarts");
  } while (last.killed);
  console.log(`  interrupted run     killed ${kills} times, finished on process ${attempts}\n`);

  const referenceStore = TraceStore.open(referencePath);
  const interruptedStore = TraceStore.open(interruptedPath);
  const expected = referenceStore.eventIds();
  const actual = interruptedStore.eventIds();

  check.that(
    "the range is not empty",
    expected.length > 0,
    `${expected.length} events`,
  );
  check.that(
    "the kills landed mid-run",
    kills > 0 && attempts > 1,
    `${kills} kills across ${attempts} processes`,
  );
  check.that(
    "no gap",
    actual.length === expected.length && actual.every((id, i) => id === expected[i]),
    `${actual.length} of ${expected.length} events, in the same order`,
  );
  check.that(
    "no duplicates",
    new Set(actual).size === actual.length,
    `${new Set(actual).size} distinct ids`,
  );
  check.that(
    "the same cursor",
    interruptedStore.readState()?.cursor === referenceStore.readState()?.cursor,
    String(interruptedStore.readState()?.cursor),
  );
  check.that("no gaps recorded", interruptedStore.gaps().length === 0);

  referenceStore.close();
  interruptedStore.close();
  console.log("");
  process.exitCode = check.failures === 0 ? 0 : 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
