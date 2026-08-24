/**
 * The proof view: one page, one form, one transaction at a time.
 *
 * `node:http` and server-rendered strings, with no framework and no client
 * JavaScript. The example is a Node and SQLite one; adding a React build to it
 * would put a toolchain between the reader and the thing being demonstrated,
 * and would break the property that matters most here — that the whole page
 * works from a captured fixture with the network unplugged.
 *
 * The server's own job is small: fetch a transaction, decode it, and assemble
 * the honest facts about what this deployment can and cannot see. The rules
 * about what a reader is shown live in `page.ts`.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { TraceStore } from "../db.js";
import { decoders } from "../decoders/index.js";
import { decodeTransaction, MetaError } from "../meta/decode.js";
import type { IndexState, RecentTransaction } from "./page.js";
import { badHashPage, homePage, layout, notFoundPage, tracePage } from "./page.js";
import type { TransactionSource } from "../rpc.js";
import { xdr } from "@stellar/stellar-sdk";

export type ProofViewOptions = {
  store: TraceStore;
  source: TransactionSource;
  /** Where transactions come from, for the banner. */
  origin: { kind: "network" | "fixture"; name: string };
  /** The ledgers that source can still answer for, when it will say. */
  window?: { oldestLedger: number; latestLedger: number } | null;
  recentLimit?: number;
};

export type RequestListener = (request: IncomingMessage, response: ServerResponse) => Promise<void>;

const HASH = /^[0-9a-f]{64}$/;

/**
 * The routing logic on its own, without the `http.Server` `createProofView`
 * wraps it in. Split out so a host that already owns request dispatch — a
 * serverless platform's function runtime, for one — can call it directly
 * instead of handing it a server to `.listen()`.
 */
export function createRequestListener(options: ProofViewOptions): RequestListener {
  const { store, source, origin } = options;

  const state = (): IndexState => {
    const stats = store.stats();
    const ingest = store.readState();
    return {
      startLedger: ingest?.startLedger ?? stats.firstLedger,
      throughLedger: ingest?.cursorLedger ?? stats.lastLedger,
      events: stats.events,
      gaps: store.gaps(),
      source: origin,
      window: options.window ?? null,
    };
  };

  const recent = (): RecentTransaction[] =>
    store.recentTransactions(options.recentLimit ?? 8).map((tx) => ({
      txHash: tx.txHash,
      ledger: tx.ledger,
      ledgerClosedAt: tx.ledgerClosedAt,
      // Decoded here, out of the XDR the ingest stored — the same registry the
      // trace uses, so a suggestion and the page it leads to agree.
      summaries: store
        .eventsForTransaction(tx.txHash)
        .map((event) =>
          decoders.decode({
            contractId: event.contractId,
            topics: event.topicsXdr.map((topic) => xdr.ScVal.fromXDR(topic, "base64")),
            data: xdr.ScVal.fromXDR(event.valueXdr, "base64"),
          }),
        )
        .flatMap((decoded) => (decoded ? [decoded.summary] : [])),
    }));

  return async (request: IncomingMessage, response: ServerResponse) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");

      if (url.pathname === "/") {
        return send(response, 200, layout("stellar-trace", homePage(state(), recent())));
      }

      if (url.pathname !== "/trace") {
        return send(response, 404, layout("not found", notFoundPage("", state())));
      }

      const asked = (url.searchParams.get("tx") ?? "").trim().toLowerCase();
      if (!HASH.test(asked)) {
        // A malformed hash is answered without asking anything of the source:
        // there is nothing to look up, and saying so is faster and truer than
        // a round trip that was always going to fail.
        return send(response, 400, layout("not a hash", badHashPage(asked, state())));
      }

      const record = await source.getTransaction(asked);
      if (record.status === "NOT_FOUND") {
        return send(response, 404, layout("not found", notFoundPage(asked, state())));
      }

      const stored = store.eventsForTransaction(asked);
      const page = tracePage(decodeTransaction(record, asked), state(), {
        inIndex: stored.length > 0,
        events: stored.length,
      });
      return send(response, 200, layout(`${asked.slice(0, 12)}… · stellar-trace`, page));
    } catch (error) {
      // Even a failure says which transaction and why, rather than a blank 500.
      const message = error instanceof MetaError ? error.message : String(error);
      send(
        response,
        500,
        layout(
          "something went wrong",
          `<section><h1>Something went wrong</h1><p class="mono">${message
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")}</p></section>`,
        ),
      );
    }
  };
}

export function createProofView(options: ProofViewOptions) {
  return createServer(createRequestListener(options));
}

function send(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    // Nothing here is cacheable: the index moves, and a page that said
    // otherwise would show a stale range.
    "cache-control": "no-store",
  });
  response.end(body);
}
