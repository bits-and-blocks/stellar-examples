/**
 * Event ids and cursors.
 *
 * Both are a TOID — 32 bits of ledger, then 20 bits of transaction order,
 * then 12 bits of operation order — followed by a dash and the index of the
 * event within its operation:
 *
 *     0018234000187334656-0000000002
 *
 * Reading the ledger back out of a cursor is not a curiosity. It is how the
 * loop knows where the server stopped scanning, which is the only way to tell
 * "there are no matching events yet" apart from "the 10,000-ledger scan cap
 * cut this request short". Both come back as an empty `events` array.
 *
 * A cursor for a range that matched nothing has every position bit set —
 * `0017781164605439999-4294967295`, meaning "through the end of ledger N" —
 * so the ledger is the only field worth trusting on a cursor.
 */
const LEDGER_SHIFT = 32n;
const TX_SHIFT = 12n;
const TX_MASK = (1n << 20n) - 1n;
const OP_MASK = (1n << 12n) - 1n;

export type EventPosition = {
  ledger: number;
  txIndex: number;
  opIndex: number;
  eventIndex: number;
};

export class ToidError extends Error {}

export function parseEventId(id: string): EventPosition {
  const [toidPart, eventPart, ...rest] = id.split("-");
  if (!toidPart || eventPart === undefined || rest.length > 0) {
    throw new ToidError(`"${id}" is not a <toid>-<event index> event id`);
  }
  if (!/^\d+$/.test(toidPart) || !/^\d+$/.test(eventPart)) {
    throw new ToidError(`"${id}" is not a <toid>-<event index> event id`);
  }
  const toid = BigInt(toidPart);
  return {
    ledger: Number(toid >> LEDGER_SHIFT),
    txIndex: Number((toid >> TX_SHIFT) & TX_MASK),
    opIndex: Number(toid & OP_MASK),
    eventIndex: Number(BigInt(eventPart)),
  };
}

/** The ledger a cursor or event id sits in. */
export const ledgerOf = (id: string): number => parseEventId(id).ledger;

/**
 * The cursor the server would return for "everything through ledger N".
 *
 * The TOID is zero-padded to 19 digits, which is how the server writes it —
 * cursors are compared as strings in places, so the padding is not cosmetic.
 */
export const cursorForLedger = (ledger: number): string => {
  const toid = (BigInt(ledger) << LEDGER_SHIFT) | (TX_MASK << TX_SHIFT) | OP_MASK;
  return `${toid.toString().padStart(19, "0")}-4294967295`;
};
