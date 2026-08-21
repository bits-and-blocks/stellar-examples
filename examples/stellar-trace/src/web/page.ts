/**
 * The page, as HTML.
 *
 * Server-rendered strings and no client-side JavaScript, which is not
 * minimalism for its own sake: the thing being demonstrated is a state
 * progression read out of transaction meta, and every byte of framework
 * between the reader and that progression is a byte they have to trust. It
 * also means the page works with the network unplugged, which is the point of
 * the fixture it can be pointed at.
 *
 * The honesty rules live here rather than in the server, because they are
 * about what a reader is shown:
 *
 * - The indexed range is stated on every view, not hidden behind a tooltip.
 * - A transaction that cannot be fetched says which window it fell outside of,
 *   and never renders as an empty result or a spinner.
 * - A transaction that *can* be fetched but is outside the indexed range says
 *   so too, because "the indexer knows about this" and "this can still be read
 *   from the network" are different claims and the page makes both.
 */
import type { DecodedTransaction, EntryChange, Step, TraceEvent } from "../meta/decode.js";
import type { Gap } from "../db.js";

export type IndexState = {
  /** Where the indexer was told to start, and how far it has got. */
  startLedger: number | null;
  throughLedger: number | null;
  events: number;
  gaps: Gap[];
  /** Where the transactions come from: an RPC url, or a fixture directory. */
  source: { kind: "network" | "fixture"; name: string };
  /** The ledgers the source itself can still answer for. */
  window: { oldestLedger: number; latestLedger: number } | null;
};

export type RecentTransaction = {
  txHash: string;
  ledger: number;
  ledgerClosedAt: string;
  summaries: string[];
};

const escape = (value: unknown): string =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>${CSS}</style>
</head>
<body>
<header>
  <a class="wordmark" href="/">stellar-trace</a>
  <form action="/trace" method="get">
    <input name="tx" placeholder="paste a testnet transaction hash" spellcheck="false"
           autocomplete="off" pattern="[0-9a-fA-F]{64}" title="64 hexadecimal characters">
    <button type="submit">Trace</button>
  </form>
</header>
<main>
${body}
</main>
</body>
</html>
`;
}

/** The banner that appears on every view. Never collapsed, never a tooltip. */
export function rangeBanner(state: IndexState): string {
  const indexed =
    state.startLedger === null || state.throughLedger === null
      ? `<strong>nothing indexed yet.</strong> Run <code>npm run ingest</code> to fill the database.`
      : `Indexed <strong>ledgers ${state.startLedger}–${state.throughLedger}</strong>, ` +
        `${state.events.toLocaleString()} events.`;

  const source =
    state.source.kind === "fixture"
      ? `Reading a captured fixture, <code>${escape(state.source.name)}</code>. Nothing here reaches the network.`
      : `Reading <code>${escape(state.source.name)}</code>.`;

  const window = !state.window
    ? ""
    : state.source.kind === "fixture"
      ? `The capture covers ledgers ${state.window.oldestLedger}–${state.window.latestLedger}, ` +
        `and nothing outside it exists as far as this page is concerned.`
      : `That server answers for ledgers ${state.window.oldestLedger}–${state.window.latestLedger}; ` +
        `anything older is gone for good, from here and from anywhere else.`;

  const gaps = state.gaps.length
    ? `<p class="warn">This index has ${state.gaps.length} known gap${state.gaps.length === 1 ? "" : "s"}: ` +
      state.gaps
        .map((gap) => `ledgers ${gap.fromLedger}–${gap.toLedger} (${escape(gap.reason)})`)
        .join("; ") +
      `. Transfers in there were never seen, which is not the same as never having happened.</p>`
    : "";

  return `<section class="banner">
  <p>${indexed}</p>
  <p class="muted">${source} ${window}</p>
  ${gaps}
</section>`;
}

export function homePage(state: IndexState, recent: RecentTransaction[]): string {
  const list = recent.length
    ? `<table class="recent">
  <thead><tr><th>ledger</th><th>closed</th><th>transaction</th></tr></thead>
  <tbody>
${recent
  .map(
    (tx) => `    <tr>
      <td class="num">${tx.ledger}</td>
      <td class="muted">${escape(tx.ledgerClosedAt)}</td>
      <td>
        <a class="hash" href="/trace?tx=${escape(tx.txHash)}">${escape(tx.txHash)}</a>
        ${tx.summaries.map((line) => `<div class="summary">${escape(line)}</div>`).join("\n        ")}
      </td>
    </tr>`,
  )
  .join("\n")}
  </tbody>
</table>`
    : `<p class="muted">No transactions indexed yet, so there is nothing to suggest.</p>`;

  return `${rangeBanner(state)}
<section>
  <h1>What did this transaction do to the ledger?</h1>
  <p>
    Paste a testnet transaction hash and you get the state progression the
    network recorded for it: every ledger entry the transaction touched, and
    what that entry held before and after. It is read out of the transaction's
    own meta, not looked up — there is no way to ask any Stellar RPC server
    what an account held last Tuesday.
  </p>
</section>
<section>
  <h2>In the index right now</h2>
  ${list}
</section>`;
}

/** A transaction the source cannot produce. Never a blank page. */
export function notFoundPage(hash: string, state: IndexState): string {
  const window = state.window;
  const reason = window
    ? `<p>
    The ${state.source.kind === "fixture" ? "fixture" : "server"} this page reads holds
    <strong>ledgers ${window.oldestLedger}–${window.latestLedger}</strong>. A transaction older than
    ledger ${window.oldestLedger} is not missing, it is outside that window: no RPC method
    returns it, here or anywhere. A newer one may not have been applied yet.
  </p>`
    : "";

  const indexed =
    state.startLedger === null
      ? ""
      : `<p class="muted">
    For what it is worth, this index starts at ledger ${state.startLedger}
    and runs to ${state.throughLedger}.
  </p>`;

  return `${rangeBanner(state)}
<section>
  <h1>No such transaction here</h1>
  <p class="hash break">${escape(hash)}</p>
  ${reason}
  ${indexed}
</section>`;
}

export function badHashPage(value: string, state: IndexState): string {
  return `${rangeBanner(state)}
<section>
  <h1>That is not a transaction hash</h1>
  <p class="hash break">${escape(value)}</p>
  <p>A Stellar transaction hash is 64 hexadecimal characters. Nothing was looked up.</p>
</section>`;
}

export function tracePage(
  tx: DecodedTransaction,
  state: IndexState,
  indexed: { inIndex: boolean; events: number },
): string {
  const facts = [
    tx.status + (tx.resultCode ? ` (${tx.resultCode})` : ""),
    tx.ledger === null ? null : `ledger ${tx.ledger}`,
    tx.createdAt,
    tx.feeBump ? "fee bump" : null,
    `meta v${tx.metaVersion}`,
  ].filter(Boolean) as string[];

  const provenance = indexed.inIndex
    ? `<p class="ok">This transaction is in the index — ` +
      `${indexed.events} matching event${indexed.events === 1 ? "" : "s"} stored here.</p>`
    : `<p class="warn">
    This transaction is <strong>outside the indexed range</strong>, which starts at ledger
    ${state.startLedger ?? "—"}${state.throughLedger === null ? "" : ` and runs to ${state.throughLedger}`}.
    The trace below is read from
    ${state.source.kind === "fixture" ? "the captured fixture" : "the network"} rather than from
    the index, which is why it can be shown at all — the index decides what this page can
    <em>suggest</em>, not what it can explain.
  </p>`;

  return `${rangeBanner(state)}
<section>
  <h1 class="hash break">${escape(tx.hash)}</h1>
  <p class="facts">${facts.map(escape).join(" · ")}</p>
  ${tx.source ? `<p class="muted">source <span class="mono">${escape(tx.source)}</span>${tx.feeCharged ? ` · fee ${escape(tx.feeCharged)} stroops` : ""}</p>` : ""}
  ${tx.returnValue ? `<p class="muted">returned <span class="mono">${escape(tx.returnValue)}</span></p>` : ""}
  ${provenance}
  ${
    tx.status === "SUCCESS"
      ? ""
      : `<p class="warn">This transaction did not succeed. Its operations changed nothing, so the
         only entries below are the ones the network changed anyway.</p>`
  }
</section>
${tx.steps.map(step).join("\n")}
${tx.steps.length === 0 ? `<section><p class="muted">The meta records no changes at all.</p></section>` : ""}`;
}

function step(value: Step): string {
  const title =
    value.phase.kind === "setup"
      ? "Fee and sequence number, before any operation ran"
      : value.phase.kind === "teardown"
        ? "After every operation"
        : `Operation ${value.phase.index} · ${escape(value.phase.operation)}`;

  const events = value.events.map(eventRow).join("\n");
  const changes = value.changes.map(changeRow).join("\n");
  const nothing =
    value.changes.length === 0
      ? `<p class="muted">No ledger entries changed in this step.</p>`
      : "";

  return `<section class="step">
  <h2>${title}</h2>
  ${events}
  ${nothing}
  ${changes}
</section>`;
}

function eventRow(event: TraceEvent): string {
  const from = event.contractId
    ? `<div class="muted mono small">from ${escape(event.contractId)}</div>`
    : "";

  if (!event.decoded) {
    // Undecoded is not a failure — most contracts have no decoder here — so it
    // is shown as what it is rather than apologised for.
    return `<div class="event">
    <div><span class="tag">event</span> <span class="mono">${escape(event.topics.join(" "))} = ${escape(event.value)}</span></div>
    ${from}
  </div>`;
  }

  const notes = event.decoded.notes
    .map((note) => `<div class="muted small">${escape(note)}</div>`)
    .join("\n    ");

  return `<div class="event">
    <div><span class="tag">${escape(event.decoded.kind)}</span> ${escape(event.decoded.summary)}</div>
    ${notes}
    ${from}
  </div>`;
}

const MARK: Record<EntryChange["kind"], string> = {
  created: "created",
  updated: "updated",
  removed: "removed",
};

function changeRow(change: EntryChange): string {
  const rows = change.changed
    .map((diff) => {
      if (diff.before === null) {
        return `<tr><th>${escape(diff.field)}</th><td colspan="2" class="mono">${escape(diff.after)}</td></tr>`;
      }
      if (diff.after === null) {
        return `<tr><th>${escape(diff.field)}</th><td class="mono was">${escape(diff.before)}</td><td class="muted">gone</td></tr>`;
      }
      return `<tr><th>${escape(diff.field)}</th><td class="mono was">${escape(diff.before)}</td><td class="mono now">${escape(diff.after)}</td></tr>`;
    })
    .join("\n      ");

  const empty = change.changed.length
    ? ""
    : `<p class="muted small">${
        change.identical
          ? "Touched, and written back byte for byte identical."
          : "Changed only in fields this tool does not render."
      }</p>`;

  return `<div class="entry ${change.kind}">
    <div class="entry-head">
      <span class="kind">${MARK[change.kind]}</span>
      <span class="label">${escape(change.entry.label)}</span>
    </div>
    ${empty}
    ${rows ? `<table class="diff"><tbody>\n      ${rows}\n    </tbody></table>` : ""}
  </div>`;
}

const CSS = `
:root {
  --bg: #fbfbfa; --fg: #1a1a1a; --muted: #6a6a6a; --line: #e2e2df;
  --card: #ffffff; --accent: #1f5fbf; --was: #a13d2d; --now: #1f6b3a; --warn: #7a5200;
  --warn-bg: #fdf6e3;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #16171a; --fg: #e8e8e6; --muted: #9a9a97; --line: #2c2e33;
    --card: #1c1e22; --accent: #7aa7f0; --was: #e08b7a; --now: #7dc99a; --warn: #e0c07a;
    --warn-bg: #2a2416;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--fg);
  font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
header {
  display: flex; gap: 1rem; align-items: center; flex-wrap: wrap;
  padding: 1rem 1.25rem; border-bottom: 1px solid var(--line); background: var(--card);
}
.wordmark { font-weight: 600; text-decoration: none; color: var(--fg); }
header form { display: flex; gap: .5rem; flex: 1 1 24rem; }
input {
  flex: 1; padding: .5rem .65rem; border: 1px solid var(--line); border-radius: 6px;
  background: var(--bg); color: var(--fg); font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
}
button {
  padding: .5rem .9rem; border: 1px solid var(--accent); border-radius: 6px;
  background: var(--accent); color: #fff; font-size: 14px; cursor: pointer;
}
main { max-width: 60rem; margin: 0 auto; padding: 1.25rem; }
section { margin: 0 0 1.5rem; }
h1 { font-size: 1.3rem; margin: 0 0 .5rem; }
h2 { font-size: 1rem; margin: 0 0 .6rem; }
p { margin: .4rem 0; }
code, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.muted { color: var(--muted); }
.small { font-size: 12px; }
.break { overflow-wrap: anywhere; }
.banner {
  border: 1px solid var(--line); border-left: 3px solid var(--accent);
  background: var(--card); padding: .75rem 1rem; border-radius: 6px;
}
.warn { color: var(--warn); background: var(--warn-bg); padding: .5rem .75rem; border-radius: 6px; }
.ok { color: var(--now); }
.facts { color: var(--muted); }
.hash { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; color: var(--accent); }
.step { border: 1px solid var(--line); border-radius: 6px; background: var(--card); padding: 1rem; }
.event { margin: .35rem 0 .75rem; }
.tag {
  display: inline-block; min-width: 5.5rem; padding: 0 .4rem; border-radius: 4px;
  background: var(--bg); border: 1px solid var(--line); font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.entry { border-top: 1px solid var(--line); padding: .6rem 0 .2rem; }
.entry-head { display: flex; gap: .6rem; align-items: baseline; flex-wrap: wrap; }
.kind { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
.label { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
table { border-collapse: collapse; width: 100%; }
.diff th {
  text-align: left; font-weight: 400; color: var(--muted); padding: .15rem .6rem .15rem 0;
  white-space: nowrap; vertical-align: top; font-size: 13px;
}
.diff td { padding: .15rem .6rem .15rem 0; overflow-wrap: anywhere; }
.was { color: var(--was); }
.now { color: var(--now); }
.recent th { text-align: left; font-size: 12px; color: var(--muted); font-weight: 400; padding: .3rem .6rem .3rem 0; }
.recent td { padding: .35rem .6rem .35rem 0; border-top: 1px solid var(--line); vertical-align: top; }
.num { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.summary { font-size: 13px; color: var(--muted); }
`;
