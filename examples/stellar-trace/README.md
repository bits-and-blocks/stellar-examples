# stellar-trace

An indexer over Stellar contract events. It polls `getEvents` from a ledger you
choose, writes the events into SQLite **undecoded**, and keeps a cursor so that
killing it and starting it again produces the same database as never having
stopped.

This directory is the ingest half. Decoding events, reconstructing state from
transaction meta, and the proof view that renders it are later tasks in the
same track; nothing here knows what a `transfer` is, and that is deliberate —
see [Pointing it somewhere else](#pointing-it-somewhere-else).

| | |
| --- | --- |
| Network | testnet, pinned in [`src/network.ts`](src/network.ts) |
| Default subject | the XLM and testnet-USDC Stellar Asset Contracts |
| Storage | one SQLite file, raw base64 XDR |
| Verified against | `soroban-testnet.stellar.org`, protocol 27, August 2026 |

## Run it

You need **Node 20 or newer**. Nothing else — no Docker, no Rust, no Stellar
CLI, no key of any kind. This program only reads.

```bash
cd examples/stellar-trace
npm install
npm run ingest -- --start-ledger latest-3000 --once
```

```
  rpc  protocol=27 status=healthy oldestLedger=4124737 latestLedger=4245696 retainedLedgers=120959 retainedDays=7
  starting a new database  startLedger=4242696 filters=4628a7ee4d1bd698
  page  events=10000 inserted=10000 throughLedger=4245352 latestLedger=4245696 behind=344
  page  events=1002 inserted=1002 throughLedger=4245696 latestLedger=4245696 behind=0
  stopped  because=caught-up pages=2 inserted=11002 duplicates=0 throughLedger=4245696 storedEvents=11002 db=trace.db
```

That is 11,002 transfers, mints and burns from the last four hours of testnet,
in `trace.db`. Drop `--once` and it keeps polling; Ctrl-C once and it finishes
the page it is on and tells you where it stopped.

The same lines are JSON when stdout is not a terminal, so `npm run ingest |
jq -c 'select(.msg == "page")'` is a progress table and nothing needed a
`--verbose` flag.

## Three things that make this harder than it looks

Each of these was measured against testnet rather than read off a page. The
`curl` next to each one re-measures it, because the answers are properties of
the RPC server you are pointed at and can change under you.

### An empty page does not mean "caught up"

`getEvents` scans **at most 10,000 ledgers per request**, and it does not tell
you when it stops early. You get `"events": []` — the same answer a quiet
contract gives — and a cursor sitting at the end of the window it did scan.

An indexer that sleeps whenever a page comes back empty therefore falls
*further behind* on every poll, forever, without a single error. The loop here
decides by comparing the ledger inside the returned cursor with `latestLedger`,
and never by counting events:

```
  page  events=0 inserted=0 throughLedger=4134740 latestLedger=4245700 behind=110960
  page  events=0 inserted=0 throughLedger=4144739 latestLedger=4245700 behind=100961
  page  events=0 inserted=0 throughLedger=4154738 latestLedger=4245700 behind=90962
```

Empty pages, marching forward 9,999 ledgers each, catching up.

```bash
# Ask for 115,000 ledgers with a filter that matches nothing.
# The cursor comes back at start + 10,000, not at the end of the range.
curl -s https://soroban-testnet.stellar.org -H 'Content-Type: application/json' -d '{
  "jsonrpc":"2.0","id":1,"method":"getEvents","params":{
    "startLedger":4130000,"endLedger":4245000,
    "filters":[{"type":"contract","contractIds":["CDPBFXGUAX56XJYEK6F6EIEBCSNWFMO7CZAJGS5ZC4XL7PFNQEH6Z32L"]}],
    "pagination":{"limit":10000}}}' | jq .result.cursor
# "0017781164605439999-4294967295"  ->  ledger 4139999
```

The cursor is a [TOID](src/toid.ts) — 32 bits of ledger, 20 of transaction
order, 12 of operation order — so the ledger reads straight out of it.

### A topic filter matches the whole topic array, not a prefix

A one-segment matcher `["transfer"]` matches only events that have *exactly
one* topic. A Stellar Asset Contract transfer under CAP-67 has four —
`transfer`, `from`, `to`, and the asset — so the obvious filter matches nothing
at all, and "nothing at all" is indistinguishable from an idle contract.

Measured on the two SACs in the shipped config:

| Event | Topics | Matcher that works |
| --- | --- | --- |
| `transfer` | 4 | `["transfer", "*", "*", "*"]` |
| `mint` | 3 | `["mint", "*", "*"]` |
| `burn` | 3 | `["burn", "*", "*"]` |

```bash
# Same ledgers, same asset, three matcher lengths. Only one arity comes back.
RPC=https://soroban-testnet.stellar.org
START=$(( $(curl -s $RPC -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getLatestLedger"}' | jq .result.sequence) - 9000 ))

for n in 2 3 4; do
  segs='"AAAADwAAAAh0cmFuc2Zlcg=="'                       # base64 ScVal: transfer
  for _ in $(seq 2 $n); do segs="$segs,\"*\""; done
  found=$(curl -s $RPC -H 'Content-Type: application/json' -d "{
    \"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getEvents\",\"params\":{
      \"startLedger\":$START,
      \"filters\":[{\"type\":\"contract\",
        \"contractIds\":[\"CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC\"],
        \"topics\":[[$segs]]}],
      \"pagination\":{\"limit\":100}}}" | jq '.result.events | length')
  echo "$n segments -> $found events"
done
# 2 segments -> 0 events
# 3 segments -> 0 events
# 4 segments -> 100 events
```

The other limits the server enforces — five filters per request, five topic
matchers and five contract ids per filter, `limit` at most 10,000 — are checked
in [`src/filters.ts`](src/filters.ts) before the first request, so a bad config
fails on startup naming the limit instead of mid-run with `-32602`.

### There is no backfill, so this database *is* the history

RPC retains a rolling window — 120,960 ledgers, about seven days, on the
endpoint above — and no method returns events older than that. Not with a
different cursor, not with a different call. An indexer started today can
reach back to `oldestLedger` and no further.

Which is why the indexer refuses a `--start-ledger` outside that window rather
than starting quietly at a different ledger than you asked for:

```
x --start-ledger 4000000 is outside what this RPC server still has: 4124741 to
  4245700. There is no historical backfill for events, so 4124741 is the
  earliest ledger any indexer starting today can reach.
```

and why a cursor that ages out while the indexer is *stopped* is a distinct,
louder failure. Those ledgers are gone. Continuing needs `--acknowledge-gap`,
which records the range in an `ingest_gaps` row so that the proof view can say
"we never saw it" instead of showing a blank result that reads as "it never
happened".

## No gap, no duplicates

```bash
npm run check:restart
```

```
restart safety, testnet ledgers 4243664-4245664, 400 events per page

  reference run       19 pages, uninterrupted
  interrupted run     killed 5 times, finished on process 6

  ok       the range is not empty  7286 events
  ok       the kills landed mid-run  5 kills across 6 processes
  ok       no gap  7286 of 7286 events, in the same order
  ok       no duplicates  7286 distinct ids
  ok       the same cursor  0018234992324771839-4294967295
  ok       no gaps recorded
```

Two databases are filled from the same fixed range of testnet ledgers. One run
is left alone. The other is killed with **SIGKILL** — no cleanup, no flush,
nothing a shutdown handler could rescue — restarted, killed again a page later,
and so on until it finishes by itself. Then the two are compared id by id.

It holds because of one line in [`src/db.ts`](src/db.ts): the events in a
response and the cursor that response returned are written **in the same
transaction**. So the stored cursor is never ahead of the stored events, and a
kill can only land the database on a page boundary. Restarting re-requests from
the last committed cursor, and the RPC cursor is exclusive, so it continues
exactly where it left off.

The `id` primary key is the second line of defence rather than the first — it
absorbs an overlap if one ever arrives, which is also what makes changing
`--limit` between runs harmless.

## What is stored

| Column | Notes |
| --- | --- |
| `id` | `<toid>-<event index>`, primary key. The RPC's own dedupe key |
| `ledger`, `ledger_closed_at` | |
| `tx_hash`, `tx_index`, `op_index` | `tx_hash` is what the proof view will look up |
| `contract_id`, `type` | |
| `in_successful_contract_call` | |
| `topics_xdr` | JSON array of base64 `ScVal` — **not decoded** |
| `value_xdr` | base64 `ScVal` — **not decoded** |
| `raw` | the whole response object, verbatim |

Storing the XDR unread is the point. A decoder written next week can be wrong,
get fixed, and be re-run over these rows; a decoder bug costs a query, never a
re-ingest. And a re-ingest is not always available — the raw bytes are exactly
the thing the RPC server will not still have in seven days.

```bash
sqlite3 trace.db "SELECT ledger, tx_hash, contract_id FROM events ORDER BY ledger DESC LIMIT 3;"
```

Two more tables: `ingest_state` holds the cursor, the start ledger, the network
passphrase and a fingerprint of the filters that produced it, and `ingest_gaps`
holds ledger ranges this database is known never to have covered.

The fingerprint is what stops the subtlest failure of all. A cursor means
"everything matching *these* filters up to here is stored". Resume the same
database with a wider filter and everything the new filter would have matched
before the cursor is missing, permanently, with nothing to indicate it. So the
filters are hashed, stored, and checked:

```
x this database was filled with a different filter set (4628a7ee4d1bd698, now
  cd71c1436fb7afdd). Resuming from its cursor would leave everything the new
  filters match between ledger 4242696 and 4245696 missing, with nothing to
  show that it is. Ingest the new filters into a new --db.
```

## Pointing it somewhere else

[`trace.config.json`](trace.config.json) is the whole repointing surface:

```json
{
  "filters": [
    {
      "type": "contract",
      "contractIds": ["CDLZ…", "CBIE…"],
      "topics": [["transfer", "*", "*", "*"], ["mint", "*", "*"], ["burn", "*", "*"]]
    }
  ]
}
```

Topic segments are written as symbol names, as `"*"`, or as `"base64:<xdr>"`
for a topic that is not a symbol; they are encoded to base64 `ScVal` at the
edge, in [`src/filters.ts`](src/filters.ts). Nothing downstream — not the loop,
not the schema, not a query — knows a `transfer` from a `deposit`. Indexing a
different contract is an edit to that file and a fresh `--db`.

The two contract ids in the shipped config are the testnet Stellar Asset
Contracts for XLM and for [Circle's testnet
USDC](https://faucet.circle.com) — the same asset the onboarding examples in
this repo move — and a [test](test/filters.test.ts) derives both from the asset
and the network passphrase rather than trusting the literals, so a wrong-network
config could not silently point at a contract that happens to exist.

## Options

```
--db <path>              database file (default: trace.db)
--config <path>          filter config (default: trace.config.json)
--start-ledger <n>       where a fresh database starts: a ledger number,
                         "latest", "oldest", or "latest-<n>" (default: latest)
--end-ledger <n>         stop once everything through this ledger is stored
--once                   stop on reaching the tip instead of polling
--poll-interval <ms>     wait between polls once caught up (default: 5000)
--limit <n>              events per request, at most 10000
--acknowledge-gap        continue past ledgers that aged out of retention
--log <text|json>        default: text on a terminal, json otherwise
```

`--start-ledger` is consulted only when the database has no cursor yet, so
leaving it in a restart command is harmless — an existing database always
resumes from where it stopped.

| Exit | Meaning |
| --- | --- |
| `0` | reached `--end-ledger`, caught up under `--once`, or interrupted cleanly |
| `2` | usage or config error, including a start ledger outside retention |
| `3` | the RPC server is not testnet, or the database is not |
| `4` | history aged out while the indexer was stopped, and no `--acknowledge-gap` |
| `5` | the filters changed under an existing database |
| `1` | anything unexpected, with a stack |

## What this does not do

- **Decode anything.** Topics and values go in as base64 XDR and come out as
  base64 XDR. The decoder registry is the next task in this track.
- **Read transaction meta.** The before/after ledger entries behind a transfer
  come from `getTransaction`'s `resultMetaXdr`, a different endpoint and a
  different task.
- **Reach further back than the RPC window.** Nothing can, over RPC. An
  archival provider or a data lake is the answer to that question, and pointing
  `rpcUrl` at one is supported — the ingest would simply have more ledgers to
  walk.
- **Survive a testnet reset.** Roughly quarterly, testnet is wiped and ledger
  numbers restart. The stored cursor becomes meaningless; start a new database.
- **Anything but SQLite.** One file, one writer, no server to run before the
  example works.

## Layout

```
trace.config.json      the filters — the whole repointing surface
src/
  network.ts           testnet passphrase and the RPC's own limits, pinned
  filters.ts           the topic DSL, encoding, and the limit checks
  config.ts            loading and validating trace.config.json
  rpc.ts               getEvents/getHealth/getNetwork over JSON-RPC
  toid.ts              reading the ledger out of an event id or cursor
  db.ts                the schema, and the page/cursor transaction
  ingest.ts            ** the loop, and everything it refuses to do **
  bin/ingest.ts        the command line
scripts/
  check-restart.ts     kill it mid-run, restart, compare
test/                  unit tests, no network
```

## References

- [getEvents](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getEvents) — the endpoint, its pagination, and its limits
- [Ingest events published from a contract](https://developers.stellar.org/docs/build/guides/events/ingest)
- [CAP-0067](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0067.md) — the event shapes, including classic operations emitting `transfer`
- [Reconciling Stellar events](https://stellar.org/blog/developers/reconciling-stellar-events) — on the retention window and what lives outside it
- [RPC data formats](https://developers.stellar.org/docs/data/apis/rpc/api-reference/structure/data-format) — `xdrFormat: "json"`, which is far easier to read while exploring
