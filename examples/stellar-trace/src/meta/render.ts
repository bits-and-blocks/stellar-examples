/**
 * The decoded transaction, as text.
 *
 * Nothing here touches XDR — everything arrives already described — so the
 * only judgement in this file is about what a reader needs first: the entries
 * whose value moved, with the value they moved from and to, and enough context
 * to see which step moved them.
 */
import type { DecodedTransaction, EntryChange, Step, TraceEvent } from "./decode.js";

const KIND_MARK: Record<EntryChange["kind"], string> = {
  created: "+",
  updated: "~",
  removed: "-",
};

export type RenderOptions = {
  /** Show every field of every entry, not only the fields that changed. */
  full?: boolean;
};

export function renderTransaction(
  tx: DecodedTransaction,
  options: RenderOptions = {},
): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(`transaction ${tx.hash}`);
  lines.push(
    `  ${tx.status}${tx.resultCode ? ` (${tx.resultCode})` : ""}` +
      `${tx.ledger === null ? "" : ` · ledger ${tx.ledger}`}` +
      `${tx.createdAt ? ` · ${tx.createdAt}` : ""}`,
  );
  const details = [
    tx.source ? `source ${tx.source}` : null,
    tx.feeCharged ? `fee ${tx.feeCharged} stroops` : null,
    tx.feeBump ? "fee bump" : null,
    `meta v${tx.metaVersion}`,
  ].filter(Boolean);
  lines.push(`  ${details.join(" · ")}`);
  if (tx.returnValue) lines.push(`  returned ${tx.returnValue}`);

  if (tx.status !== "SUCCESS") {
    lines.push("");
    lines.push(
      `  This transaction did not succeed. Its operations changed nothing, so`,
    );
    lines.push(
      `  the only entries below are the ones the network changed anyway: the`,
    );
    lines.push(`  fee, and the source account's sequence number.`);
  }

  for (const step of tx.steps) {
    lines.push("");
    lines.push(renderPhase(step));
    for (const event of step.events) lines.push(...renderEvent(event));
    if (step.changes.length === 0 && step.events.length > 0) {
      lines.push("    (no ledger entries changed in this step)");
    }
    for (const change of step.changes) lines.push(...renderChange(change, options));
  }

  if (tx.steps.length === 0) {
    lines.push("");
    lines.push("  the meta records no changes at all");
  }

  lines.push("");
  return lines.join("\n");
}

const renderPhase = (step: Step): string => {
  switch (step.phase.kind) {
    case "setup":
      return "fee and sequence number, before any operation ran";
    case "teardown":
      return "after every operation";
    default:
      return `operation ${step.phase.index} · ${step.phase.operation}`;
  }
};

const renderEvent = (event: TraceEvent): string[] => [
  `  event  ${event.topics.join(" ")}  =  ${event.value}` +
    (event.contractId ? `\n         from ${event.contractId}` : ""),
];

function renderChange(change: EntryChange, options: RenderOptions): string[] {
  const lines: string[] = [];
  lines.push(`  ${KIND_MARK[change.kind]} ${change.entry.label}  (${change.kind})`);

  const fields = options.full
    ? Object.keys({ ...change.before, ...change.after }).map((field) => ({
        field,
        before: change.before?.[field] ?? null,
        after: change.after?.[field] ?? null,
      }))
    : change.changed;

  for (const diff of fields) {
    if (diff.before === null) {
      lines.push(`      ${diff.field}: ${diff.after}`);
    } else if (diff.after === null) {
      lines.push(`      ${diff.field}: ${diff.before}  (gone)`);
    } else {
      lines.push(`      ${diff.field}: ${diff.before}  ->  ${diff.after}${delta(diff.before, diff.after)}`);
    }
  }

  if (fields.length === 0) {
    lines.push(
      change.identical
        ? "      (touched, and written back byte for byte identical)"
        : "      (changed only in fields this tool does not render)",
    );
  }
  return lines;
}

/**
 * `(-10.0000000)` after a balance line.
 *
 * Both sides are already formatted, so the raw integer in parentheses — which
 * `formatAmount` puts there for exactly this reason — is what gets subtracted.
 * A field without one is left alone rather than guessed at.
 */
function delta(before: string, after: string): string {
  const raw = /\((-?\d+)\)$/;
  const was = raw.exec(before);
  const now = raw.exec(after);
  if (!was?.[1] || !now?.[1]) return "";
  const difference = BigInt(now[1]) - BigInt(was[1]);
  if (difference === 0n) return "";
  return `   ${difference > 0n ? "+" : "-"}${(difference < 0n ? -difference : difference).toString()}`;
}
