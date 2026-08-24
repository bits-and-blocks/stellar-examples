/**
 * The SQLite store.
 *
 * Two ideas do all the work here.
 *
 * **Events are stored raw.** The base64 XDR arrives from the server and is
 * written down unread, alongside the whole response object for that event.
 * Nothing in this file knows what a topic means. A decoder written later can
 * be wrong, get fixed, and be run again over the same rows — a decoder bug
 * costs a query, never a re-ingest, and the raw bytes are the thing the RPC
 * server will not still have in a week.
 *
 * **A page and its cursor commit together.** Every event in a response and the
 * cursor that response returned are written in one transaction, so the stored
 * cursor is never ahead of the stored events. Kill the process anywhere and
 * the database is at a page boundary: restarting re-requests from the last
 * committed cursor and continues. The `id` primary key makes the overlap that
 * a lost, uncommitted page produces a no-op rather than a duplicate.
 */
import Database from "better-sqlite3";

import type { RawEvent } from "./rpc.js";

/** Bumped when the schema changes in a way an older database cannot serve. */
const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id                             TEXT    PRIMARY KEY,
  ledger                         INTEGER NOT NULL,
  ledger_closed_at               TEXT    NOT NULL,
  tx_hash                        TEXT    NOT NULL,
  tx_index                       INTEGER NOT NULL,
  op_index                       INTEGER NOT NULL,
  contract_id                    TEXT,
  type                           TEXT    NOT NULL,
  in_successful_contract_call    INTEGER NOT NULL,
  -- base64 ScVal XDR, exactly as the server sent it: a JSON array of topics,
  -- and the event value.
  topics_xdr                     TEXT    NOT NULL,
  value_xdr                      TEXT    NOT NULL,
  -- The untouched response object, so a field this schema does not model yet
  -- is not lost to whoever needs it later.
  raw                            TEXT    NOT NULL,
  ingested_at                    TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS events_ledger_idx   ON events (ledger);
CREATE INDEX IF NOT EXISTS events_tx_hash_idx  ON events (tx_hash);
CREATE INDEX IF NOT EXISTS events_contract_idx ON events (contract_id);

CREATE TABLE IF NOT EXISTS ingest_state (
  id                  INTEGER PRIMARY KEY CHECK (id = 1),
  rpc_url             TEXT    NOT NULL,
  network_passphrase  TEXT    NOT NULL,
  filter_fingerprint  TEXT    NOT NULL,
  start_ledger        INTEGER NOT NULL,
  cursor              TEXT,
  cursor_ledger       INTEGER,
  updated_at          TEXT    NOT NULL
);

-- Ledger ranges this database is known never to have covered: the operator
-- restarted past them, or they aged out of the RPC's retention window before
-- the indexer got to them. Recorded so the proof view can say so out loud
-- instead of rendering an empty result that looks like "nothing happened".
CREATE TABLE IF NOT EXISTS ingest_gaps (
  from_ledger  INTEGER NOT NULL,
  to_ledger    INTEGER NOT NULL,
  reason       TEXT    NOT NULL,
  recorded_at  TEXT    NOT NULL,
  PRIMARY KEY (from_ledger, to_ledger)
);
`;

export type IngestState = {
  rpcUrl: string;
  networkPassphrase: string;
  filterFingerprint: string;
  startLedger: number;
  cursor: string | null;
  cursorLedger: number | null;
};

export type Gap = { fromLedger: number; toLedger: number; reason: string };

export class SchemaError extends Error {}

export class TraceStore {
  private constructor(private readonly db: Database.Database) {}

  static open(path: string): TraceStore {
    const db = new Database(path);
    // WAL so a reader (the trace CLI, later the proof view) is never blocked
    // by the writer. FULL because the claim this example makes is that a kill
    // at any moment leaves a resumable database, and NORMAL trades exactly
    // that away — one fsync per page of up to 10,000 events is not a cost.
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = FULL");

    const version = Number(db.pragma("user_version", { simple: true }) ?? 0);
    if (version > SCHEMA_VERSION) {
      db.close();
      throw new SchemaError(
        `${path} was written by a newer version of this indexer ` +
          `(schema ${version}, this build understands ${SCHEMA_VERSION})`,
      );
    }
    db.exec(SCHEMA);
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
    return new TraceStore(db);
  }

  readState(): IngestState | null {
    const row = this.db
      .prepare<[], Record<string, string | number | null>>(
        `SELECT rpc_url, network_passphrase, filter_fingerprint, start_ledger, cursor, cursor_ledger
           FROM ingest_state WHERE id = 1`,
      )
      .get();
    if (!row) return null;
    return {
      rpcUrl: String(row.rpc_url),
      networkPassphrase: String(row.network_passphrase),
      filterFingerprint: String(row.filter_fingerprint),
      startLedger: Number(row.start_ledger),
      cursor: row.cursor === null ? null : String(row.cursor),
      cursorLedger: row.cursor_ledger === null ? null : Number(row.cursor_ledger),
    };
  }

  /** Write the row a fresh database starts from. */
  begin(state: Omit<IngestState, "cursor" | "cursorLedger">): void {
    this.db
      .prepare(
        `INSERT INTO ingest_state
           (id, rpc_url, network_passphrase, filter_fingerprint, start_ledger, cursor, cursor_ledger, updated_at)
         VALUES (1, ?, ?, ?, ?, NULL, NULL, ?)`,
      )
      .run(
        state.rpcUrl,
        state.networkPassphrase,
        state.filterFingerprint,
        state.startLedger,
        new Date().toISOString(),
      );
  }

  /**
   * Store a page of events and the cursor that came back with it, atomically.
   *
   * Returns how many rows were new. A non-zero `duplicates` after a restart is
   * the expected shape of recovery — the last page was fetched but not
   * committed, so it arrives again — and not a problem to report.
   */
  commitPage(
    events: RawEvent[],
    cursor: string,
    cursorLedger: number,
  ): { inserted: number; duplicates: number } {
    const now = new Date().toISOString();
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO events
         (id, ledger, ledger_closed_at, tx_hash, tx_index, op_index, contract_id,
          type, in_successful_contract_call, topics_xdr, value_xdr, raw, ingested_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const saveCursor = this.db.prepare(
      `UPDATE ingest_state SET cursor = ?, cursor_ledger = ?, updated_at = ? WHERE id = 1`,
    );

    const write = this.db.transaction((page: RawEvent[]) => {
      let inserted = 0;
      for (const event of page) {
        const result = insert.run(
          event.id,
          event.ledger,
          event.ledgerClosedAt,
          event.txHash,
          event.transactionIndex,
          event.operationIndex,
          event.contractId ?? null,
          event.type,
          event.inSuccessfulContractCall === false ? 0 : 1,
          JSON.stringify(event.topic ?? []),
          event.value,
          JSON.stringify(event),
          now,
        );
        inserted += result.changes;
      }
      saveCursor.run(cursor, cursorLedger, now);
      return inserted;
    });

    const inserted = write(events);
    return { inserted, duplicates: events.length - inserted };
  }

  /**
   * Record a range of ledgers this database will never hold.
   *
   * Merged with any range it overlaps or abuts, because a gap is an interval
   * and two overlapping intervals are one hole, not two. Without this, an
   * indexer restarted twice against a retention window that has moved on both
   * times leaves three rows describing one gap with slightly different ends —
   * which reads as three separate incidents to anyone looking later.
   */
  recordGap(gap: Gap): void {
    const merge = this.db.transaction((next: Gap) => {
      const overlapping = this.db
        .prepare<[number, number], { from_ledger: number; to_ledger: number }>(
          `SELECT from_ledger, to_ledger FROM ingest_gaps
            WHERE from_ledger <= ? + 1 AND to_ledger >= ? - 1`,
        )
        .all(next.toLedger, next.fromLedger);

      const fromLedger = Math.min(next.fromLedger, ...overlapping.map((r) => r.from_ledger));
      const toLedger = Math.max(next.toLedger, ...overlapping.map((r) => r.to_ledger));

      for (const row of overlapping) {
        this.db
          .prepare(`DELETE FROM ingest_gaps WHERE from_ledger = ? AND to_ledger = ?`)
          .run(row.from_ledger, row.to_ledger);
      }
      this.db
        .prepare(
          `INSERT OR REPLACE INTO ingest_gaps (from_ledger, to_ledger, reason, recorded_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run(fromLedger, toLedger, next.reason, new Date().toISOString());
    });
    merge(gap);
  }

  gaps(): Gap[] {
    return this.db
      .prepare<[], { from_ledger: number; to_ledger: number; reason: string }>(
        `SELECT from_ledger, to_ledger, reason FROM ingest_gaps ORDER BY from_ledger`,
      )
      .all()
      .map((row) => ({
        fromLedger: row.from_ledger,
        toLedger: row.to_ledger,
        reason: row.reason,
      }));
  }

  stats(): { events: number; firstLedger: number | null; lastLedger: number | null } {
    const row = this.db
      .prepare<[], { events: number; first: number | null; last: number | null }>(
        `SELECT COUNT(*) AS events, MIN(ledger) AS first, MAX(ledger) AS last FROM events`,
      )
      .get();
    return {
      events: row?.events ?? 0,
      firstLedger: row?.first ?? null,
      lastLedger: row?.last ?? null,
    };
  }

  /**
   * The newest transactions stored, for finding one worth tracing.
   *
   * The only query in this file that exists for a person rather than for the
   * loop. Grouped by transaction rather than listed by event, because one
   * transaction routinely emits several matching events and a list of the same
   * hash four times over is not a list of choices.
   */
  recentTransactions(limit: number): Array<{
    txHash: string;
    ledger: number;
    ledgerClosedAt: string;
    events: number;
  }> {
    return this.db
      .prepare<[number], {
        tx_hash: string;
        ledger: number;
        ledger_closed_at: string;
        events: number;
      }>(
        `SELECT tx_hash,
                MAX(ledger)           AS ledger,
                MAX(ledger_closed_at) AS ledger_closed_at,
                COUNT(*)              AS events
           FROM events
          GROUP BY tx_hash
          ORDER BY ledger DESC
          LIMIT ?`,
      )
      .all(limit)
      .map((row) => ({
        txHash: row.tx_hash,
        ledger: row.ledger,
        ledgerClosedAt: row.ledger_closed_at,
        events: row.events,
      }));
  }

  /** Every stored event id, in ledger order. Used by the restart check. */
  eventIds(): string[] {
    return this.db
      .prepare<[], { id: string }>(`SELECT id FROM events ORDER BY id`)
      .all()
      .map((row) => row.id);
  }

  close(): void {
    this.db.close();
  }
}
