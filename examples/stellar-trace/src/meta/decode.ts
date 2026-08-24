/**
 * `resultMetaXdr` to a state progression.
 *
 * This is the claim the whole track rests on, so it is worth being precise
 * about what is and is not available. **There is no historical ledger-entry
 * fetch.** `getLedgerEntries` answers with current state only, so "what did
 * this account's balance used to be" cannot be asked directly of any RPC
 * method. What can be asked is for a transaction, and the meta it carries
 * records, for every entry the transaction touched, the entry as it was and as
 * it became. Reconstructing state is therefore not a matter of looking it up;
 * it is a matter of reading what the transaction already told us.
 *
 * The encoding is easy to misread. A change list does not hold pairs — it
 * holds a flat sequence where an update appears as two entries, a
 * `LEDGER_ENTRY_STATE` carrying the old value followed by a
 * `LEDGER_ENTRY_UPDATED` carrying the new one. A removal is the same, with
 * `LEDGER_ENTRY_REMOVED` and only a key. A creation stands alone. Pairing them
 * back up by entry identity, rather than by adjacency, is most of this file.
 */
import { Address, TransactionBuilder, xdr } from "@stellar/stellar-sdk";

import { NETWORK_PASSPHRASE } from "../network.js";
import {
  describeEntry,
  describeKey,
  describeScVal,
  type EntryFields,
  type EntryIdentity,
} from "./entries.js";

export type ChangeKind = "created" | "updated" | "removed";

export type FieldDiff = { field: string; before: string | null; after: string | null };

export type EntryChange = {
  kind: ChangeKind;
  entry: EntryIdentity;
  before: EntryFields | null;
  after: EntryFields | null;
  /** Only the fields that differ. For a creation or removal, all of them. */
  changed: FieldDiff[];
  /**
   * The entry was written back byte for byte identical.
   *
   * Not a curiosity: the meta records an update for every entry the
   * transaction *touched*, and touching one and putting it back unchanged is
   * ordinary — a fee-bump's inner source account does exactly that. Without
   * this flag such an entry reads as "something changed that this tool cannot
   * show you", which is a bug report waiting to happen.
   */
  identical: boolean;
};

export type StepPhase =
  | { kind: "setup" }
  | { kind: "operation"; index: number; operation: string }
  | { kind: "teardown" };

export type TraceEvent = {
  /** `before_all_txs`, `after_all_txs`, or the operation that emitted it. */
  stage: string;
  contractId: string | null;
  type: string;
  topics: string[];
  value: string;
};

export type Step = {
  phase: StepPhase;
  events: TraceEvent[];
  changes: EntryChange[];
};

export type DecodedTransaction = {
  hash: string;
  status: string;
  ledger: number | null;
  createdAt: string | null;
  feeBump: boolean;
  metaVersion: number;
  source: string | null;
  feeCharged: string | null;
  resultCode: string | null;
  returnValue: string | null;
  steps: Step[];
};

/** The fields of a `getTransaction` response this decoder reads. */
export type TransactionRecord = {
  status: string;
  txHash?: string;
  ledger?: number;
  createdAt?: string | number;
  feeBump?: boolean;
  envelopeXdr?: string;
  resultXdr?: string;
  resultMetaXdr?: string;
};

export class MetaError extends Error {}

export function decodeTransaction(record: TransactionRecord, hash: string): DecodedTransaction {
  if (!record.resultMetaXdr) {
    throw new MetaError(
      `the RPC server returned no resultMetaXdr for ${hash}, so there is ` +
        `nothing to reconstruct state from`,
    );
  }

  const meta = xdr.TransactionMeta.fromXDR(record.resultMetaXdr, "base64");
  const version = Number(meta.switch());
  const envelope = describeEnvelope(record.envelopeXdr);
  const result = describeResult(record.resultXdr);

  return {
    hash,
    status: record.status,
    ledger: record.ledger ?? null,
    createdAt: normaliseTime(record.createdAt),
    feeBump: record.feeBump ?? false,
    metaVersion: version,
    source: envelope.source,
    feeCharged: result.feeCharged,
    resultCode: result.code,
    returnValue: readReturnValue(meta),
    steps: readSteps(meta, envelope.operations),
  };
}

/**
 * Split the meta into the phases a transaction actually happens in.
 *
 * The fee is taken and the sequence number bumped before any operation runs,
 * which is why the sender's balance appears to move twice in a payment: once
 * here, for the fee, and once inside the operation. Keeping the phases apart
 * is what makes that legible instead of looking like a double debit.
 */
function readSteps(meta: xdr.TransactionMeta, operations: string[]): Step[] {
  const version = Number(meta.switch());
  const steps: Step[] = [];

  const before: xdr.LedgerEntryChange[] = [];
  const after: xdr.LedgerEntryChange[] = [];
  let operationMetas: Array<{ changes: xdr.LedgerEntryChange[]; events: xdr.ContractEvent[] }> = [];
  const setupEvents: TraceEvent[] = [];
  const teardownEvents: TraceEvent[] = [];

  switch (version) {
    case 0:
      operationMetas = meta.operations().map((op) => ({ changes: op.changes(), events: [] }));
      break;
    case 1: {
      // v1 has a single `txChanges` list rather than a before and an after.
      const v1 = meta.v1();
      before.push(...v1.txChanges());
      operationMetas = v1.operations().map((op) => ({ changes: op.changes(), events: [] }));
      break;
    }
    case 2:
    case 3: {
      const inner = version === 2 ? meta.v2() : meta.v3();
      before.push(...inner.txChangesBefore());
      after.push(...inner.txChangesAfter());
      operationMetas = inner.operations().map((op) => ({ changes: op.changes(), events: [] }));
      break;
    }
    case 4: {
      const v4 = meta.v4();
      before.push(...v4.txChangesBefore());
      after.push(...v4.txChangesAfter());
      operationMetas = v4.operations().map((op) => ({
        changes: op.changes(),
        events: op.events(),
      }));
      for (const event of v4.events()) {
        const stage = event.stage().name.replace("transactionEventStage", "");
        const decoded = describeEvent(event.event(), stage);
        (stage.toLowerCase().startsWith("before") ? setupEvents : teardownEvents).push(decoded);
      }
      break;
    }
    default:
      throw new MetaError(`unsupported TransactionMeta version v${version}`);
  }

  const setup = pairChanges(before);
  if (setup.length > 0 || setupEvents.length > 0) {
    steps.push({ phase: { kind: "setup" }, events: setupEvents, changes: setup });
  }

  operationMetas.forEach((op, index) => {
    steps.push({
      phase: { kind: "operation", index, operation: operations[index] ?? "operation" },
      events: op.events.map((event) => describeEvent(event, `operation ${index}`)),
      changes: pairChanges(op.changes),
    });
  });

  const teardown = pairChanges(after);
  if (teardown.length > 0 || teardownEvents.length > 0) {
    steps.push({ phase: { kind: "teardown" }, events: teardownEvents, changes: teardown });
  }

  return steps;
}

/**
 * Fold a flat `LedgerEntryChanges` list into one record per entry touched.
 *
 * Matching is by entry identity rather than by position, because adjacency is
 * a convention of the encoder rather than a guarantee of the format, and
 * because a `state` with no partner would otherwise silently become somebody
 * else's "before".
 */
export function pairChanges(changes: xdr.LedgerEntryChange[]): EntryChange[] {
  const pending = new Map<string, xdr.LedgerEntry>();
  const paired: EntryChange[] = [];

  for (const change of changes) {
    switch (change.switch().name) {
      case "ledgerEntryState": {
        const entry = change.state();
        pending.set(describeKey(entry.data()).id, entry);
        break;
      }
      case "ledgerEntryCreated": {
        const entry = change.created();
        const identity = describeKey(entry.data());
        const after = describeEntry(entry);
        paired.push({
          kind: "created",
          entry: identity,
          before: null,
          after,
          changed: diffFields(null, after),
          identical: false,
        });
        break;
      }
      case "ledgerEntryUpdated": {
        const entry = change.updated();
        const identity = describeKey(entry.data());
        const previous = pending.get(identity.id) ?? null;
        pending.delete(identity.id);
        const before = previous ? describeEntry(previous) : null;
        const after = describeEntry(entry);
        paired.push({
          kind: "updated",
          entry: identity,
          before,
          after,
          changed: diffFields(before, after),
          identical:
            previous !== null && previous.toXDR("base64") === entry.toXDR("base64"),
        });
        break;
      }
      case "ledgerEntryRemoved": {
        const key = change.removed();
        const identity = describeKey(key);
        const previous = pending.get(identity.id) ?? null;
        pending.delete(identity.id);
        const before = previous ? describeEntry(previous) : null;
        paired.push({
          kind: "removed",
          entry: identity,
          before,
          after: null,
          changed: diffFields(before, null),
          identical: false,
        });
        break;
      }
      default:
        break;
    }
  }

  return paired;
}

function diffFields(before: EntryFields | null, after: EntryFields | null): FieldDiff[] {
  const names = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const diffs: FieldDiff[] = [];
  for (const field of names) {
    const was = before?.[field] ?? null;
    const now = after?.[field] ?? null;
    if (was === now) continue;
    diffs.push({ field, before: was, after: now });
  }
  return diffs;
}

function describeEvent(event: xdr.ContractEvent, stage: string): TraceEvent {
  const body = event.body().v0();
  const contractId = event.contractId();
  return {
    stage,
    contractId: contractId
      ? Address.contract(Buffer.from(contractId as unknown as Uint8Array)).toString()
      : null,
    type: event.type().name.replace("contractEventType", "").toLowerCase(),
    topics: body.topics().map((topic) => describeScVal(topic, 64)),
    value: describeScVal(body.data(), 96),
  };
}

function readReturnValue(meta: xdr.TransactionMeta): string | null {
  const version = Number(meta.switch());
  const soroban =
    version === 4 ? meta.v4().sorobanMeta() : version === 3 ? meta.v3().sorobanMeta() : null;
  const value = soroban?.returnValue();
  // Only an invocation returns anything; a classic operation has no Soroban
  // meta at all, and a v4 invocation can still carry a null return value.
  return value ? describeScVal(value) : null;
}

/**
 * The source account and the operation names, for labelling the steps.
 *
 * Parsed with the testnet passphrase pinned: the envelope is only being read
 * for its shape, but building a `Transaction` with the wrong network would
 * quietly produce the wrong hash for anything that later chose to check.
 */
function describeEnvelope(envelopeXdr?: string): { source: string | null; operations: string[] } {
  if (!envelopeXdr) return { source: null, operations: [] };
  try {
    const parsed = TransactionBuilder.fromXDR(envelopeXdr, NETWORK_PASSPHRASE);
    const inner = "innerTransaction" in parsed ? parsed.innerTransaction : parsed;
    return {
      source: inner.source,
      operations: inner.operations.map((operation) => operation.type),
    };
  } catch {
    return { source: null, operations: [] };
  }
}

function describeResult(resultXdr?: string): { feeCharged: string | null; code: string | null } {
  if (!resultXdr) return { feeCharged: null, code: null };
  try {
    const result = xdr.TransactionResult.fromXDR(resultXdr, "base64");
    return {
      feeCharged: result.feeCharged().toString(),
      code: result.result().switch().name.replace(/^tx/, ""),
    };
  } catch {
    return { feeCharged: null, code: null };
  }
}

const normaliseTime = (value?: string | number): string | null => {
  if (value === undefined) return null;
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return String(value);
  return new Date(seconds * 1000).toISOString();
};
