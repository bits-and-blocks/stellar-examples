/**
 * The ingest loop.
 *
 * Ask `getEvents` for a page, write the page and the cursor it returned in one
 * transaction, ask again from that cursor. That is the whole program. What
 * makes it worth spelling out is the two ways it can quietly go wrong.
 *
 * **An empty page does not mean "caught up".** `getEvents` scans at most
 * 10,000 ledgers per request and does not say so — it returns an empty
 * `events` array and a cursor sitting at the end of the window it managed to
 * scan. A loop that sleeps whenever a page comes back empty falls behind the
 * network by 10,000 ledgers per poll and never catches up. So the decision to
 * sleep is made by comparing the ledger inside the returned cursor with
 * `latestLedger`, never by counting events.
 *
 * **The cursor is the only honest record of progress.** Not the start ledger
 * plus a ledger count, not the highest ledger seen: those are guesses about
 * what the server scanned. The cursor is what the server says it scanned, it
 * is exclusive, and it advances even across ledgers that matched nothing.
 */
import type { TraceConfig } from "./config.js";
import type { Gap, TraceStore } from "./db.js";
import type { Logger } from "./log.js";
import { NETWORK_PASSPHRASE } from "./network.js";
import { EXIT } from "./exit.js";
import { RpcError, type EventSource, type RawEvent } from "./rpc.js";
import { cursorForLedger, ledgerOf } from "./toid.js";

/**
 * Where a fresh database should start: an absolute ledger, the ends of the
 * retention window, or a window of the last N ledgers.
 */
export type StartLedger = number | "latest" | "oldest" | { latestMinus: number };

export type IngestOptions = {
  config: TraceConfig;
  store: TraceStore;
  rpc: EventSource;
  log: Logger;
  /** Only consulted for a database with no cursor yet. */
  startLedger?: StartLedger;
  /** Stop once everything through this ledger is stored. */
  endLedger?: number;
  /** Stop on reaching the tip instead of polling. */
  once?: boolean;
  /** Continue past history that has already aged out, recording the gap. */
  acknowledgeGap?: boolean;
  signal?: AbortSignal;
};

export type IngestSummary = {
  pages: number;
  events: number;
  inserted: number;
  duplicates: number;
  cursor: string | null;
  throughLedger: number | null;
  stoppedBecause: "end-ledger" | "caught-up" | "signal";
};

/** Something that should stop the process, with an exit code the CLI uses. */
export class IngestError extends Error {
  constructor(message: string, readonly exitCode: number) {
    super(message);
    this.name = "IngestError";
  }
}

/**
 * `-32001 request exceeded processing limit threshold` — the server declining
 * a request it judged too expensive. Retrying it unchanged is asking the same
 * question, so the loop asks for less: a smaller page scans less and usually
 * gets through. It climbs back toward the configured size afterwards, so one
 * busy stretch does not slow the rest of the run down.
 */
const PAGE_LIMIT_REFUSED = -32001;
const MIN_PAGE_LIMIT = 100;

export { EXIT } from "./exit.js";

/**
 * Refuse to run against anything but testnet, and report the window we can see.
 *
 * The passphrase check is the one that matters: `rpcUrl` is configuration, and
 * this is what stops a mainnet URL in that file from filling the database with
 * mainnet events under a testnet-shaped example.
 */
export async function preflight(rpc: EventSource, log: Logger) {
  const [network, health] = await Promise.all([rpc.getNetwork(), rpc.getHealth()]);

  if (network.passphrase !== NETWORK_PASSPHRASE) {
    throw new IngestError(
      `the RPC server serves "${network.passphrase}", and this example is ` +
        `testnet only ("${NETWORK_PASSPHRASE}")`,
      EXIT.wrongNetwork,
    );
  }

  const retainedLedgers = health.latestLedger - health.oldestLedger;
  log.info("rpc", {
    protocol: network.protocolVersion,
    status: health.status,
    oldestLedger: health.oldestLedger,
    latestLedger: health.latestLedger,
    retainedLedgers,
    // Roughly, at five seconds a ledger. The number the UI has to be honest
    // about: there is no backfill behind it.
    retainedDays: Math.round((retainedLedgers * 5) / 8640) / 10,
  });

  return health;
}

export async function ingest(options: IngestOptions): Promise<IngestSummary> {
  const { config, store, rpc, log, signal } = options;
  const health = await preflight(rpc, log);

  let cursor = resumeOrBegin(options, health.oldestLedger, health.latestLedger);
  const summary: IngestSummary = {
    pages: 0,
    events: 0,
    inserted: 0,
    duplicates: 0,
    cursor: cursor.cursor,
    throughLedger: cursor.cursor ? ledgerOf(cursor.cursor) : null,
    stoppedBecause: "signal",
  };

  let announcedCaughtUp = false;
  let limit = config.pageLimit;

  while (!signal?.aborted) {
    let page;
    try {
      page = await rpc.getEvents({
        filters: config.filters,
        limit,
        ...(cursor.cursor
          ? { cursor: cursor.cursor }
          : { startLedger: cursor.startLedger }),
      });
    } catch (error) {
      // A request abandoned by the second interrupt. Nothing was committed,
      // so the database is still on the last cursor it stored.
      if (signal?.aborted) return { ...summary, stoppedBecause: "signal" };

      if (error instanceof RpcError && error.code === PAGE_LIMIT_REFUSED) {
        if (limit <= MIN_PAGE_LIMIT) throw error;
        limit = Math.max(MIN_PAGE_LIMIT, Math.floor(limit / 2));
        log.warn("the server refused that page size, asking for less", { limit });
        continue;
      }

      // The stored cursor has aged out from under us. Nothing can fetch those
      // ledgers now — not this program, not a different one — so the only
      // choices are to stop and say so, or to continue and record the hole.
      const window = error instanceof RpcError ? error.retentionWindow : null;
      if (!window) throw error;
      cursor = skipPastRetention(options, cursor, window.oldest);
      continue;
    }

    const cursorLedger = ledgerOf(page.cursor);
    const pageWasFull = page.events.length >= limit;
    limit = Math.min(config.pageLimit, limit * 2);
    const { events, cursor: storedCursor, storedLedger, reachedEnd } = truncateAtEnd(
      page.events,
      page.cursor,
      cursorLedger,
      pageWasFull,
      options.endLedger,
    );

    const written = store.commitPage(events, storedCursor, storedLedger);
    cursor = { cursor: storedCursor, startLedger: 0 };

    summary.pages += 1;
    summary.events += events.length;
    summary.inserted += written.inserted;
    summary.duplicates += written.duplicates;
    summary.cursor = storedCursor;
    summary.throughLedger = storedLedger;

    const behind = page.latestLedger - storedLedger;
    log.info("page", {
      events: events.length,
      inserted: written.inserted,
      ...(written.duplicates ? { duplicates: written.duplicates } : {}),
      throughLedger: storedLedger,
      latestLedger: page.latestLedger,
      behind: Math.max(0, behind),
    });

    if (reachedEnd) {
      summary.stoppedBecause = "end-ledger";
      return summary;
    }

    // A full page means the limit cut it short, not the scan window: there is
    // certainly more, whatever the ledger numbers say.
    const caughtUp = !pageWasFull && storedLedger >= page.latestLedger;
    if (!caughtUp) {
      announcedCaughtUp = false;
      continue;
    }

    if (options.once) {
      summary.stoppedBecause = "caught-up";
      return summary;
    }
    if (!announcedCaughtUp) {
      log.info("caught up with the network", { throughLedger: storedLedger });
      announcedCaughtUp = true;
    }
    await sleep(config.pollIntervalMs, signal);
  }

  summary.stoppedBecause = "signal";
  return summary;
}

type Resume = { cursor: string | null; startLedger: number };

/**
 * Decide where this run picks up, and refuse the cases where continuing would
 * silently produce a database with a hole in it.
 */
function resumeOrBegin(
  options: IngestOptions,
  oldestLedger: number,
  latestLedger: number,
): Resume {
  const { config, store, log } = options;
  const state = store.readState();

  if (state) {
    if (state.networkPassphrase !== NETWORK_PASSPHRASE) {
      throw new IngestError(
        `this database holds events from "${state.networkPassphrase}"`,
        EXIT.wrongNetwork,
      );
    }
    if (state.filterFingerprint !== config.fingerprint) {
      throw new IngestError(
        `this database was filled with a different filter set ` +
          `(${state.filterFingerprint}, now ${config.fingerprint}). Resuming ` +
          `from its cursor would leave everything the new filters match ` +
          `between ledger ${state.startLedger} and ` +
          `${state.cursorLedger ?? state.startLedger} missing, with nothing ` +
          `to show that it is. Ingest the new filters into a new --db.`,
        EXIT.filterMismatch,
      );
    }
    if (state.rpcUrl !== config.rpcUrl) {
      // Same network — preflight just checked — so a different provider is
      // only worth a mention.
      log.warn("resuming against a different rpc server", {
        was: state.rpcUrl,
        now: config.rpcUrl,
      });
    }

    if (state.cursor) {
      log.info("resuming", {
        cursor: state.cursor,
        throughLedger: state.cursorLedger ?? ledgerOf(state.cursor),
        stored: store.stats().events,
      });
      return { cursor: state.cursor, startLedger: state.startLedger };
    }

    log.info("resuming a database with no cursor yet", { startLedger: state.startLedger });
    return { cursor: null, startLedger: state.startLedger };
  }

  const requested = options.startLedger ?? "latest";
  const startLedger =
    requested === "latest"
      ? latestLedger
      : requested === "oldest"
        ? oldestLedger
        : typeof requested === "number"
          ? requested
          : latestLedger - requested.latestMinus;

  if (startLedger < oldestLedger || startLedger > latestLedger) {
    throw new IngestError(
      `--start-ledger ${startLedger} is outside what this RPC server still ` +
        `has: ${oldestLedger} to ${latestLedger}. There is no historical ` +
        `backfill for events, so ${oldestLedger} is the earliest ledger any ` +
        `indexer starting today can reach.`,
      EXIT.usage,
    );
  }

  store.begin({
    rpcUrl: config.rpcUrl,
    networkPassphrase: NETWORK_PASSPHRASE,
    filterFingerprint: config.fingerprint,
    startLedger,
  });
  log.info("starting a new database", { startLedger, filters: config.fingerprint });
  return { cursor: null, startLedger };
}

/**
 * Handle a cursor that has fallen out of the retention window.
 *
 * The events between where we stopped and what the server still has are gone.
 * Continuing is a legitimate choice — a demo left off overnight would rather
 * resume than refuse — but only if the hole is written down, because a proof
 * view over this database must not present "we never saw it" as "it did not
 * happen".
 */
function skipPastRetention(options: IngestOptions, cursor: Resume, oldest: number): Resume {
  const lost = cursor.cursor ? ledgerOf(cursor.cursor) + 1 : cursor.startLedger;
  const gap: Gap = {
    fromLedger: lost,
    toLedger: oldest - 1,
    reason: "aged out of the RPC retention window before ingest reached it",
  };

  if (!options.acknowledgeGap) {
    throw new IngestError(
      `ledgers ${gap.fromLedger} to ${gap.toLedger} aged out of the RPC ` +
        `server's retention window while this indexer was not running, and ` +
        `no RPC method can return them now. Re-run with --acknowledge-gap to ` +
        `continue from ledger ${oldest} and record the gap, or start a new ` +
        `database.`,
      EXIT.retentionGap,
    );
  }

  options.store.recordGap(gap);
  options.log.warn("skipping ledgers that aged out of retention", gap as unknown as Record<string, unknown>);
  return { cursor: null, startLedger: oldest };
}

/**
 * Apply `--end-ledger` to a page.
 *
 * A page can run past the requested end, since the server pages by records.
 * Dropping the overshoot and storing a cursor that means "everything through
 * the end ledger" keeps the invariant the restart guarantee rests on: the
 * stored cursor never claims more than the stored events deliver.
 */
function truncateAtEnd(
  events: RawEvent[],
  cursor: string,
  cursorLedger: number,
  pageWasFull: boolean,
  endLedger?: number,
) {
  if (endLedger === undefined || cursorLedger < endLedger) {
    return { events, cursor, storedLedger: cursorLedger, reachedEnd: false };
  }
  if (cursorLedger > endLedger) {
    const kept = events.filter((event) => event.ledger <= endLedger);
    return {
      events: kept,
      cursor: cursorForLedger(endLedger),
      storedLedger: endLedger,
      reachedEnd: true,
    };
  }
  // The cursor sits exactly on the end ledger. If the page was full it may
  // have been cut off part way through that ledger, so there is more of it to
  // come and this is not the end yet.
  return { events, cursor, storedLedger: cursorLedger, reachedEnd: !pageWasFull };
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(finish, ms);
    signal?.addEventListener("abort", finish, { once: true });
    function finish() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    }
  });
