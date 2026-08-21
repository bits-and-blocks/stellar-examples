/**
 * `npm run trace -- <tx-hash>` — one transaction, as a state progression.
 *
 * Reads nothing from the database. The ingest loop tells you *that* a transfer
 * happened; this tells you what the ledger looked like on either side of it,
 * and the two are joined by a transaction hash rather than by shared storage.
 */
import { parseArgs } from "node:util";

import { ConfigError, DEFAULT_CONFIG_PATH, loadConfig } from "../config.js";
import { EXIT } from "../exit.js";
import { createLogger } from "../log.js";
import { decodeTransaction, MetaError } from "../meta/decode.js";
import { renderTransaction } from "../meta/render.js";
import { NETWORK_PASSPHRASE } from "../network.js";
import { DEFAULT_FIXTURE_DIR, FixtureError, loadFixture } from "../offline/fixtures.js";
import { OfflineRpc } from "../offline/replay.js";
import { RpcError, TraceRpc, type TransactionSource } from "../rpc.js";

const USAGE = `
stellar-trace trace — what one transaction did to the ledger

  npm run trace -- <tx-hash> [options]

  --full             every field of every entry, not only the ones that changed
  --json             the decoded structure, for piping somewhere else
  --offline          read a captured fixture instead of the network
  --fixtures <dir>   which fixture (default: ${DEFAULT_FIXTURE_DIR})
  --config <path>    where the RPC url comes from (default: ${DEFAULT_CONFIG_PATH})
  --help

Exit codes: 0 done · 1 unexpected · ${EXIT.usage} usage ·
${EXIT.wrongNetwork} wrong network · ${EXIT.notFound} no such transaction here
`.trim();

class TraceError extends Error {
  constructor(message: string, readonly exitCode: number) {
    super(message);
  }
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    options: {
      full: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      offline: { type: "boolean", default: false },
      fixtures: { type: "string", default: DEFAULT_FIXTURE_DIR },
      config: { type: "string", default: DEFAULT_CONFIG_PATH },
      help: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  if (values.help || positionals.length === 0) {
    console.log(USAGE);
    return values.help ? 0 : EXIT.usage;
  }
  if (positionals.length > 1) {
    throw new TraceError("one transaction hash at a time", EXIT.usage);
  }

  const hash = (positionals[0] as string).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw new TraceError(
      `"${positionals[0]}" is not a transaction hash — expected 64 hex characters`,
      EXIT.usage,
    );
  }

  const config = loadConfig(values.config);
  const log = createLogger({ format: "text", level: "warn" });

  // Offline reads a captured fixture and never constructs a client.
  const rpc: TransactionSource =
    values.offline
      ? new OfflineRpc(loadFixture(values.fixtures))
      : new TraceRpc({ url: config.rpcUrl, log });

  const network = await rpc.getNetwork();
  if (network.passphrase !== NETWORK_PASSPHRASE) {
    throw new TraceError(
      `the RPC server serves "${network.passphrase}", and this example is testnet only`,
      EXIT.wrongNetwork,
    );
  }

  const record = await rpc.getTransaction(hash);

  if (record.status === "NOT_FOUND") {
    // Two very different situations, and the ledger range tells them apart.
    // Saying which one it is saves the reader from wondering whether they
    // mistyped the hash.
    throw new TraceError(
      `no transaction ${hash} on this RPC server.\n\n` +
        `  It holds ledgers ${record.oldestLedger} to ${record.latestLedger}. A ` +
        `transaction older than\n  ledger ${record.oldestLedger} is not missing — ` +
        `it is outside the window, and no RPC\n  method will return it. A newer ` +
        `one may not have been applied yet.`,
      EXIT.notFound,
    );
  }

  const decoded = decodeTransaction(record, hash);

  if (values.json) {
    console.log(JSON.stringify(decoded, null, 2));
    return 0;
  }

  console.log(renderTransaction(decoded, { full: values.full }));
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    if (
      error instanceof TraceError ||
      error instanceof ConfigError ||
      error instanceof FixtureError ||
      error instanceof MetaError
    ) {
      console.error(`\nx ${error.message}\n`);
      process.exitCode = error instanceof TraceError ? error.exitCode : EXIT.usage;
      return;
    }
    if (error instanceof RpcError) {
      console.error(`\nx the RPC server refused: [${error.code}] ${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    console.error(error);
    process.exitCode = 1;
  });
