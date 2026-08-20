/**
 * `npm run recent` — the newest transactions in the database, to trace.
 *
 * The example's two commands are joined by a transaction hash and nothing
 * else, and this is the join: the indexer knows which transactions moved a
 * token recently, `trace` explains one of them. It exists because a README
 * cannot promise a hard-coded hash will still be inside the RPC's retention
 * window when someone reads it.
 */
import { parseArgs } from "node:util";

import { TraceStore } from "../src/db.js";

const { values } = parseArgs({
  options: {
    db: { type: "string", default: "trace.db" },
    limit: { type: "string", default: "10" },
    "hash-only": { type: "boolean", default: false },
  },
});

const store = TraceStore.open(values.db);
try {
  const transactions = store.recentTransactions(Number(values.limit));

  if (transactions.length === 0) {
    console.error(
      `\nx ${values.db} holds no events yet. Fill it first:\n\n` +
        `    npm run ingest -- --start-ledger latest-200 --once\n`,
    );
    process.exitCode = 1;
  } else if (values["hash-only"]) {
    // One hash per line, so this can feed another command rather than be
    // copied out by hand.
    for (const transaction of transactions) console.log(transaction.txHash);
  } else {
    console.log("");
    console.log("  ledger     closed                 events   transaction");
    for (const tx of transactions) {
      console.log(
        `  ${tx.ledger}   ${tx.ledgerClosedAt}   ${String(tx.events).padStart(6)}   ${tx.txHash}`,
      );
    }
    console.log("");
    console.log(`  npm run trace -- ${transactions[0]?.txHash}`);
    console.log("");
  }
} finally {
  store.close();
}
