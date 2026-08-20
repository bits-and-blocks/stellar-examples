/**
 * A fixture, served as if it were an RPC server.
 *
 * This is not a mock of the HTTP layer, and not a transcript played back in
 * order. It is the captured *responses*, re-served by re-deriving the two
 * behaviours the ingest loop actually depends on: a cursor that is exclusive
 * and advances even across ledgers that matched nothing, and a scan that stops
 * after ten thousand ledgers whether or not it found anything. Everything else
 * — the events, their ids, their XDR, the transaction meta — is the bytes
 * testnet returned.
 *
 * Deriving the paging rather than replaying it is deliberate. A recorded
 * request/response transcript only answers the exact questions that were asked
 * when it was recorded, so changing `--limit` would make the fixture useless
 * and, worse, an offline run would stop exercising the paging logic that the
 * whole loop rests on. This way `--offline` runs the same loop over the same
 * decisions, and only the source of the bytes is different.
 *
 * The seams it plugs into — `EventSource` and `TransactionSource` — were
 * already there for the tests. Offline replay needed no new abstraction, which
 * is the sort of thing worth noticing about a design before trusting it.
 */
import { RPC_LIMITS } from "../network.js";
import { RpcError, type EventSource, type GetEventsResponse, type GetHealthResponse, type GetTransactionResponse, type TransactionSource } from "../rpc.js";
import { fingerprintFilters, type RpcFilter } from "../filters.js";
import { cursorForLedger, ledgerOf } from "../toid.js";
import { FixtureError, type Fixture } from "./fixtures.js";

export class OfflineRpc implements EventSource, TransactionSource {
  constructor(private readonly fixture: Fixture) {}

  async getNetwork(): Promise<{ passphrase: string; protocolVersion: number }> {
    return this.fixture.manifest.network;
  }

  /**
   * The window is the capture, not testnet.
   *
   * Reporting the real `latestLedger` the capture saw would leave the loop
   * permanently behind a tip that no fixture can reach, polling forever. The
   * honest answer offline is that this little universe ends where the capture
   * ended.
   */
  async getHealth(): Promise<GetHealthResponse> {
    const { range } = this.fixture.manifest;
    return {
      status: "healthy",
      oldestLedger: range.startLedger,
      latestLedger: range.endLedger,
      ledgerRetentionWindow: range.endLedger - range.startLedger + 1,
    };
  }

  async getTransaction(hash: string): Promise<GetTransactionResponse> {
    const { range } = this.fixture.manifest;
    const found = this.fixture.transactions[hash];
    if (found) return found;

    // Exactly what a server says about a hash it does not hold, so the "not
    // found, and here is the window" path is reachable offline too.
    return {
      status: "NOT_FOUND",
      txHash: hash,
      latestLedger: range.endLedger,
      oldestLedger: range.startLedger,
      latestLedgerCloseTime: "0",
      oldestLedgerCloseTime: "0",
    };
  }

  async getEvents(
    request: { filters: RpcFilter[]; limit?: number; startLedger?: number; cursor?: string },
  ): Promise<GetEventsResponse> {
    const { range, filters, filterFingerprint } = this.fixture.manifest;

    // The fixture holds the events one filter set matched. Serving it to a
    // different one would answer a question it never asked, and quietly.
    const asked = fingerprintFilters(request.filters);
    if (asked !== filterFingerprint) {
      throw new FixtureError(
        `this fixture was captured with a different filter set ` +
          `(${filterFingerprint}, asked for ${asked}). It holds only what those ` +
          `filters matched, so replaying it against yours would look like a ` +
          `quiet network rather than a mismatch. Capture again with the ` +
          `config you mean to use:\n\n` +
          `      npm run capture -- --config ${"<your config>"}\n\n` +
          `  captured filters: ${JSON.stringify(filters)}`,
      );
    }

    const limit = Math.min(request.limit ?? 100, RPC_LIMITS.pageLimit);
    const from = this.startOf(request, range);

    // The server scans a bounded window per request and reports where it
    // stopped through the cursor. Small fixtures never reach the cap, but the
    // loop's "an empty page is not caught up" logic is only exercised if the
    // rule is here too.
    const scanEnd = Math.min(range.endLedger, from.ledger + RPC_LIMITS.ledgerScan - 1);

    const events = this.fixture.events
      .filter((event) => event.ledger >= from.ledger && event.ledger <= scanEnd)
      .filter((event) => (from.after === null ? true : event.id > from.after))
      .slice(0, limit);

    const last = events[events.length - 1];
    return {
      events,
      cursor: last ? last.id : cursorForLedger(scanEnd),
      latestLedger: range.endLedger,
      oldestLedger: range.startLedger,
      latestLedgerCloseTime: "0",
      oldestLedgerCloseTime: "0",
    };
  }

  /** Where this request starts reading, from either a cursor or a ledger. */
  private startOf(
    request: { startLedger?: number; cursor?: string },
    range: { startLedger: number; endLedger: number },
  ): { ledger: number; after: string | null } {
    if (request.cursor) {
      const ledger = ledgerOf(request.cursor);
      if (ledger < range.startLedger - 1 || ledger > range.endLedger) {
        throw this.outsideRange(range);
      }
      return { ledger, after: request.cursor };
    }

    const ledger = request.startLedger ?? range.startLedger;
    if (ledger < range.startLedger || ledger > range.endLedger) {
      throw this.outsideRange(range);
    }
    return { ledger, after: null };
  }

  /**
   * The same refusal a real server gives, in the same words.
   *
   * Not imitation for its own sake: the ingest loop recognises this message to
   * tell "history aged out" apart from "bad request", and a replay that phrased
   * it differently would leave that path untested offline.
   */
  private outsideRange(range: { startLedger: number; endLedger: number }): RpcError {
    return new RpcError(
      -32600,
      `startLedger must be within the ledger range: ${range.startLedger} - ${range.endLedger}`,
    );
  }
}
