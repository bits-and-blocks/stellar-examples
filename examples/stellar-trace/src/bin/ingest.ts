/**
 * `npm run ingest` — the command line around the loop.
 *
 * Ctrl-C is part of the demonstration rather than an afterthought: the first
 * one lets the page in flight finish committing and prints where it got to,
 * which is the state a restart picks up from. The second one kills it outright,
 * which is the case the page/cursor transaction exists to survive.
 */
import { parseArgs } from "node:util";

import { ConfigError, DEFAULT_CONFIG_PATH, loadConfig } from "../config.js";
import { SchemaError, TraceStore } from "../db.js";
import { FilterError } from "../filters.js";
import { createLogger, type LogFormat } from "../log.js";
import { EXIT, IngestError, ingest, type StartLedger } from "../ingest.js";
import { DEFAULT_FIXTURE_DIR, FixtureError, loadFixture } from "../offline/fixtures.js";
import { OfflineRpc } from "../offline/replay.js";
import { TraceRpc, type EventSource } from "../rpc.js";

const USAGE = `
stellar-trace ingest — poll getEvents into SQLite, resumably

  npm run ingest -- [options]

  --db <path>              database file (default: trace.db)
  --config <path>          filter config (default: ${DEFAULT_CONFIG_PATH})
  --start-ledger <n>       where a fresh database starts: a ledger number,
                           "latest", "oldest", or "latest-<n>" for a window
                           ending now (default: latest)
  --end-ledger <n>         stop once everything through this ledger is stored
  --once                   stop on reaching the tip instead of polling
  --poll-interval <ms>     wait between polls once caught up
  --limit <n>              events per request, at most 10000
  --acknowledge-gap        continue past ledgers that aged out of the RPC's
                           retention window, recording the gap
  --offline                read a captured fixture instead of the network
  --fixtures <dir>         which fixture (default: ${DEFAULT_FIXTURE_DIR})
  --log <text|json>        default: text on a terminal, json otherwise
  --help

Exit codes: 0 done · 1 unexpected · ${EXIT.usage} usage or config ·
${EXIT.wrongNetwork} wrong network · ${EXIT.retentionGap} history aged out ·
${EXIT.filterMismatch} filters changed under an existing database
`.trim();

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      db: { type: "string", default: "trace.db" },
      config: { type: "string", default: DEFAULT_CONFIG_PATH },
      "start-ledger": { type: "string" },
      "end-ledger": { type: "string" },
      once: { type: "boolean", default: false },
      "poll-interval": { type: "string" },
      limit: { type: "string" },
      "acknowledge-gap": { type: "boolean", default: false },
      offline: { type: "boolean", default: false },
      fixtures: { type: "string", default: DEFAULT_FIXTURE_DIR },
      log: { type: "string" },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(USAGE);
    return 0;
  }

  const format = values.log as LogFormat | undefined;
  if (format && format !== "text" && format !== "json") {
    throw new IngestError(`--log must be "text" or "json"`, EXIT.usage);
  }
  const log = createLogger({ format });

  const config = loadConfig(values.config);
  if (values["poll-interval"]) config.pollIntervalMs = integer(values["poll-interval"], "--poll-interval");
  if (values.limit) config.pageLimit = integer(values.limit, "--limit");

  const store = TraceStore.open(values.db);

  // Two stages, because "stop" means two different things. The first
  // interrupt lets the page in flight land, which is the tidy stop. The
  // second abandons the request itself, which is the impatient one — and
  // either way the database is left on a committed cursor, so neither is
  // more correct than the other, only faster.
  const betweenPages = new AbortController();
  const inFlight = new AbortController();

  let interrupts = 0;
  const onSignal = () => {
    if (++interrupts > 1) {
      log.warn("second interrupt — abandoning the request in flight");
      inFlight.abort();
      return;
    }
    log.info("interrupt — finishing the page in flight, then stopping");
    betweenPages.abort();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  // An offline run never constructs a TraceRpc, so it has no path to the
  // network at all — not a blocked one, an absent one.
  const source: EventSource =
    values.offline
      ? new OfflineRpc(loadFixture(values.fixtures))
      : new TraceRpc({ url: config.rpcUrl, log, signal: inFlight.signal });

  if (values.offline) log.info("offline", { fixtures: values.fixtures });

  // Live, "latest" is the right default: an indexer started now should follow
  // the network from now. Offline, the fixture is the whole world and there is
  // no reason to start at the end of it.
  const start: StartLedger | undefined = values["start-ledger"]
    ? startLedger(values["start-ledger"])
    : values.offline
      ? "oldest"
      : undefined;

  try {
    const summary = await ingest({
      config,
      store,
      rpc: source,
      log,
      ...(start === undefined ? {} : { startLedger: start }),
      ...(values["end-ledger"] ? { endLedger: integer(values["end-ledger"], "--end-ledger") } : {}),
      once: values.once,
      acknowledgeGap: values["acknowledge-gap"],
      signal: betweenPages.signal,
    });

    const stats = store.stats();
    log.info("stopped", {
      because: summary.stoppedBecause,
      pages: summary.pages,
      inserted: summary.inserted,
      duplicates: summary.duplicates,
      throughLedger: summary.throughLedger,
      storedEvents: stats.events,
      db: values.db,
    });
    for (const gap of store.gaps()) {
      log.warn("this database has a known gap", {
        fromLedger: gap.fromLedger,
        toLedger: gap.toLedger,
        reason: gap.reason,
      });
    }
    return interrupts > 0 ? 130 : 0;
  } finally {
    store.close();
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}

/** `latest`, `oldest`, `latest-2000`, or a ledger number. */
function startLedger(value: string): StartLedger {
  if (value === "latest" || value === "oldest") return value;
  const relative = /^latest-(\d+)$/.exec(value);
  if (relative) return { latestMinus: integer(relative[1] as string, "--start-ledger") };
  return integer(value, "--start-ledger");
}

function integer(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new IngestError(`${flag} must be a non-negative integer, got "${value}"`, EXIT.usage);
  }
  return parsed;
}

/**
 * Exit by setting a code and letting the event loop drain, never by calling
 * `process.exit`. Tearing the loop down while `fetch` still has a socket in
 * hand trips a libuv assertion on Windows and exits 127 — which would replace
 * every considered exit code below with a crash. Draining costs about half a
 * second and also lets stdout flush.
 */
main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    if (
      error instanceof IngestError ||
      error instanceof ConfigError ||
      error instanceof FilterError ||
      error instanceof FixtureError ||
      error instanceof SchemaError
    ) {
      // Expected refusals: one line, no stack. The message is the product.
      console.error(`\nx ${error.message}\n`);
      process.exit(error instanceof IngestError ? error.exitCode : EXIT.usage);
    }
    console.error(error);
    process.exit(1);
  });
