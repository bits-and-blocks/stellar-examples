/**
 * `npm run serve` — the proof view, on a port.
 *
 * Reads the same database the indexer fills and the same source the trace
 * command uses, so `--offline` here means exactly what it means there: the
 * page is served from a captured fixture and cannot reach the network.
 */
import { parseArgs } from "node:util";

import { ConfigError, DEFAULT_CONFIG_PATH, loadConfig } from "../config.js";
import { EXIT } from "../exit.js";
import { SchemaError, TraceStore } from "../db.js";
import { createLogger } from "../log.js";
import { NETWORK_PASSPHRASE } from "../network.js";
import { DEFAULT_FIXTURE_DIR, FixtureError, loadFixture } from "../offline/fixtures.js";
import { OfflineRpc } from "../offline/replay.js";
import { TraceRpc, type TransactionSource } from "../rpc.js";
import { createProofView } from "../web/server.js";

const USAGE = `
stellar-trace serve — the proof view

  npm run serve -- [options]

  --port <n>         default: 3000
  --host <host>      default: 127.0.0.1
  --db <path>        the indexer's database (default: trace.db)
  --offline          serve from a captured fixture instead of the network
  --fixtures <dir>   which fixture (default: ${DEFAULT_FIXTURE_DIR})
  --config <path>    where the RPC url comes from (default: ${DEFAULT_CONFIG_PATH})
  --help
`.trim();

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      port: { type: "string", default: "3000" },
      host: { type: "string", default: "127.0.0.1" },
      db: { type: "string", default: "trace.db" },
      offline: { type: "boolean", default: false },
      fixtures: { type: "string", default: DEFAULT_FIXTURE_DIR },
      config: { type: "string", default: DEFAULT_CONFIG_PATH },
      help: { type: "boolean", default: false },
    },
  });

  if (values.help) {
    console.log(USAGE);
    return 0;
  }

  const log = createLogger({ format: "text" });
  const config = loadConfig(values.config);
  const store = TraceStore.open(values.db);

  let source: TransactionSource;
  let origin: { kind: "network" | "fixture"; name: string };
  let window: { oldestLedger: number; latestLedger: number } | null = null;

  if (values.offline) {
    const fixture = loadFixture(values.fixtures);
    source = new OfflineRpc(fixture);
    origin = { kind: "fixture", name: values.fixtures };
    window = {
      oldestLedger: fixture.manifest.range.startLedger,
      latestLedger: fixture.manifest.range.endLedger,
    };
  } else {
    const rpc = new TraceRpc({ url: config.rpcUrl, log });
    const network = await rpc.getNetwork();
    if (network.passphrase !== NETWORK_PASSPHRASE) {
      console.error(`\nx the RPC server serves "${network.passphrase}" — testnet only\n`);
      return EXIT.wrongNetwork;
    }
    // Asked once at startup rather than per request: the banner's job is to be
    // roughly honest about the window, not to be a health check.
    const health = await rpc.getHealth();
    source = rpc;
    origin = { kind: "network", name: config.rpcUrl };
    window = { oldestLedger: health.oldestLedger, latestLedger: health.latestLedger };
  }

  const server = createProofView({ store, source, origin, window });
  const port = Number(values.port);

  await new Promise<void>((resolve) => server.listen(port, values.host, resolve));

  const stats = store.stats();
  log.info("serving the proof view", {
    url: `http://${values.host}:${port}/`,
    db: values.db,
    events: stats.events,
    ...(values.offline ? { fixtures: values.fixtures } : { rpc: config.rpcUrl }),
  });
  if (stats.events === 0) {
    log.warn("the database is empty, so the page has nothing to suggest", {
      fill: values.offline
        ? `npm run ingest -- --offline --db ${values.db} --once`
        : `npm run ingest -- --db ${values.db} --start-ledger latest-200 --once`,
    });
  }

  const stop = () => {
    server.close();
    store.close();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    if (
      error instanceof ConfigError ||
      error instanceof FixtureError ||
      error instanceof SchemaError
    ) {
      console.error(`\nx ${error.message}\n`);
      process.exitCode = EXIT.usage;
      return;
    }
    console.error(error);
    process.exitCode = 1;
  });
