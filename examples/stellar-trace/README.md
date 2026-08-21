# stellar-trace

An indexer over Stellar contract events, and a reader for the state each one
moved.

**`ingest`** polls `getEvents` from a ledger you choose, writes the events into
SQLite **undecoded**, and keeps a cursor so that killing it and starting it
again produces the same database as never having stopped.

**`trace <tx-hash>`** takes one transaction and prints what it did to the
ledger — every entry it touched, and what that entry held before and after.

The two are joined by a transaction hash and nothing else: the indexer says
*that* a transfer happened, and the trace says what the ledger looked like on
either side of it. Neither knows what a `transfer` means — that lives in
[one directory of decoders](#teaching-it-what-the-events-mean), which is what
makes pointing this at another contract cheap.

Both run against a committed slice of testnet with **`npm run demo`**, which
needs no network and cannot use one.

| | |
| --- | --- |
| Network | testnet, pinned in [`src/network.ts`](src/network.ts) |
| Default subject | the XLM and testnet-USDC Stellar Asset Contracts |
| Storage | one SQLite file, raw base64 XDR |
| Transaction meta | `TransactionMeta` v4 (protocol 23+), decoded locally |
| Offline | `fixtures/testnet-slice`, whole responses as captured |
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
in `trace.db`. Drop `--once` and it keeps polling.

Ctrl-C once and it finishes the page in flight, then says where it stopped —
the tidy stop. Ctrl-C again and it abandons the request instead of waiting for
it. Neither is more correct than the other: both leave the database on a
committed cursor, and the next run resumes from it.

The same lines are JSON when stdout is not a terminal, so `npm run ingest |
jq -c 'select(.msg == "page")'` is a progress table and nothing needed a
`--verbose` flag.

## With the network unplugged

```bash
npm run demo
```

Ingests a committed slice of testnet into a fresh database, lists what it
holds, and traces one transaction down to the ledger entries it moved — all
from `fixtures/`, none of it from a server.

The interesting part is *how* it is offline. Each step is spawned with
[`scripts/no-network.ts`](scripts/no-network.ts) imported ahead of it, which
replaces `fetch` with something that throws. Everything this example could use
to reach the network goes through `fetch`, so a green demo is not evidence that
testnet happened to be up — it is evidence that nothing asked for it. Run the
online path under the same loader and it fails immediately, which is how that
guard is known to work.

```
1. Ingest the captured ledgers
$ src/bin/ingest.ts --offline --db demo.db --once --log text

  offline  fixtures=fixtures/testnet-slice
  rpc  protocol=27 status=healthy oldestLedger=4247683 latestLedger=4247802
  page  events=317 inserted=317 throughLedger=4247802 latestLedger=4247802 behind=0

2. What the database holds
  4247802   2026-08-20T21:30:36Z   8b47dd2751e689f978c5de1824d63abbe3fd086b4d2c6abe0af1ebefefd758d0
    transfer  109.9586000 USDC from CDX3W…U2RO to GAV6T…V3QT
    transfer  110.0318000 USDC from GAV6T…V3QT to CDX3W…U2RO

3. Trace one of them
  transfer  2.0000000 XLM from GB5FC…RLCH to GBTOR…JJZV
            emitted by native's Stellar Asset Contract, derived and matched
  ~ account GB5FC…RLCH  (updated)
      XLM balance: 10,606.4939200  ->  10,604.4939200   -20000000
  ~ account GBTOR…JJZV  (updated)
      XLM balance: 9,597.4914300  ->  9,599.4914300   +20000000
```

Both commands take `--offline` on their own, so the fixture is somewhere to
work from rather than only a demo:

```bash
npm run ingest -- --offline --db demo.db --once
npm run trace -- --offline <tx-hash>
```

### Capturing a new one

```bash
npm run capture -- --ledgers 200 --transactions 25
```

Whole `getEvents` responses, and the `getTransaction` results for the
transactions they name, written to `fixtures/testnet-slice/` exactly as the
server sent them. Nothing is decoded or reshaped on the way in, so a fixture is
evidence rather than a summary — and it keeps working long after its ledgers
have left the RPC's seven-day window, which is the whole reason the demo uses
one.

Recapture when the slice stops being interesting. Nothing breaks when you
don't.

### Why the paging is re-derived rather than replayed

A fixture holds real responses, but replay does not hand them back in the order
they were recorded. It re-derives the two behaviours the loop depends on — a
cursor that is exclusive and advances across ledgers that matched nothing, and
a scan that stops after 10,000 ledgers — and serves the captured events through
them.

That is a deliberate line. A recorded request-and-response transcript can only
answer the questions that were asked when it was recorded: change `--limit` and
it has nothing to say, and an offline run would stop exercising the cursor
logic that everything here rests on. [A test](test/offline.test.ts) ingests the
same fixture with a limit of 7, takes 46 pages to do what the capture did in
one, and ends with the same events in the database.

What replay does *not* do is invent anything. It refuses a ledger outside the
captured range in the same words the server uses, returns `NOT_FOUND` with that
range for a hash it does not hold, and refuses outright to serve a fixture
captured with different filters — because that would look like a quiet network
rather than a mismatch.

## Tracing one transaction

```bash
npm run trace -- 476eb1bb01e3342ed6acaa5228f4e4c27f231eb5917872d71c0012e0eeafde8f
```

```
transaction 476eb1bb01e3342ed6acaa5228f4e4c27f231eb5917872d71c0012e0eeafde8f
  SUCCESS (Success) · ledger 4245730 · 2026-08-20T18:37:34.000Z
  source GBRMGCKG7U2CX7LIWHP4SDSAO7OGXQDRTEJDBMPE27E5X4O73OV3RTUS · fee 100 stroops · meta v4

fee and sequence number, before any operation ran
  event  fee GBRMGCKG7U2CX7LIWHP4SDSAO7OGXQDRTEJDBMPE27E5X4O73OV3RTUS  =  100
         from CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC
  ~ account GBRMG…RTUS  (updated)
      sequence: 18235262907711489  ->  18235262907711490
      sequence bumped in ledger: 4245729  ->  4245730

operation 0 · payment
  event  transfer GBRMGCKG…RTUS GAV6PB6T…OU6O native  =  {amount: 92500000, to_muxed_id: "note 2"}
         from CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC
  ~ account GBRMG…RTUS  (updated)
      XLM balance: 9,981.9999800 (99819999800)  ->  9,972.7499800 (99727499800)   -92500000
  ~ account GAV6P…OU6O  (updated)
      XLM balance: 10,018.0000000 (100180000000)  ->  10,027.2500000 (100272500000)   +92500000
```

Both sides of a transfer, before and after, from a transaction hash. Add
`--full` for every field of every entry rather than only the ones that changed,
or `--json` for the same structure as data.

**That hash stops working about a week after this was written**, for the reason
the next section is about, and no README can promise otherwise. Any recent
testnet transfer works, and the indexer is one way to find one — this is the
only place the two commands meet:

```bash
npm run ingest -- --start-ledger latest-200 --once
npm run trace -- "$(sqlite3 -noheader trace.db   'SELECT tx_hash FROM events ORDER BY ledger DESC LIMIT 1;')"
```

### Where that state comes from, since it cannot be looked up

There is **no historical ledger-entry fetch**. `getLedgerEntries` answers with
current state only, so "what did this account hold last Tuesday" is not a
question any RPC method takes. It is easy to assume otherwise and design a
proof view around a call that does not exist.

What does exist is the transaction's own meta. `getTransaction` returns
`resultMetaXdr`, and inside it every entry the transaction touched appears
twice — as it was and as it became. So the state is not looked up, it is read
back out of the record the network already wrote. That record is also the more
convincing artifact: it is what the validators agreed on, not a later query
against a node's current view.

Three things about that encoding cost time if you meet them by surprise:

- **A change list is flat, not paired.** An update is two entries — a
  `LEDGER_ENTRY_STATE` carrying the old value, then a `LEDGER_ENTRY_UPDATED`
  carrying the new one. A removal is a `STATE` and a `REMOVED` holding only a
  key. A creation stands alone. [`decode.ts`](src/meta/decode.ts) pairs them by
  entry identity rather than by adjacency, so a `STATE` with no partner cannot
  quietly become the "before" of the next entry along.
- **The fee is not in there.** Look at the numbers above: the sender loses
  exactly the 9.25 XLM of the payment, not 9.25 plus the 100-stroop fee. Fee
  charging happens in its own phase, whose entry changes live in the *ledger
  close* meta rather than the transaction's. All the transaction meta carries is
  the CAP-67 `fee` event — and, for a Soroban transaction, a second one after
  the operations that is *negative*, refunding the resource fee that was
  reserved but not spent.
- **"Updated" does not mean "changed".** The meta records an update for every
  entry a transaction *touched*. A fee bump's inner source account is written
  back byte for byte identical, and the trace says so rather than implying that
  something changed which it could not show you.

Protocol 23 moved this to `TransactionMeta` **v4**, which is what testnet
returns today; v1 through v3 are still decoded, since an archival RPC can serve
older ledgers.

## Three things about `getEvents` that make ingest harder than it looks

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

One limit cannot be checked up front, because it depends on how busy the
server is rather than on the request: `-32001 request exceeded processing limit
threshold`, which a full 10,000-event page over a wide scan window does provoke
in practice. Retrying that unchanged is asking the same question, so the loop
halves the page size instead, and climbs back toward the configured size once
the server is answering again.

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

The window applies to transactions too, and on this endpoint it is the same
window: a `getTransaction` for a transaction at `oldestLedger + 50` still comes
back with its full meta, so anything the indexer holds can also be traced.
That is a property of how the server is configured rather than a guarantee —
`transactionRetentionWindow` is a separate setting from the event one, and a
provider is free to keep transactions for less time than events. Worth checking
against whichever endpoint you point at, since a proof view built on the
assumption would fail only for the oldest hashes.

## No gap, no duplicates

```bash
npm test              # the unit tests, no network
npm run check:restart # the real thing, against testnet
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

### Teaching it what the events mean

The config decides which events are *stored*. [`src/decoders/`](src/decoders/)
decides what they *say*, and it is the only place that knows:

```ts
// src/decoders/pool.ts
export const registerPoolDecoders = (registry: DecoderRegistry) =>
  registry.register(POOL_CONTRACT_ID, "deposit", (event) => ({
    kind: "deposit",
    summary: `${amount} into the pool`,
    fields: { … },
    notes: [],
  }));

// src/decoders/index.ts — the one line that turns it on
registerPoolDecoders(registry);
```

Two files, both inside that directory. Everything downstream — the trace
output, the recent list — consumes a `DecodedEvent` and never asks what kind
it is.

That claim is checked rather than promised. [A
test](test/registry.test.ts) strips the comments out of every source file
outside `src/decoders/` and asserts that none of them contains the words
`transfer`, `mint`, `burn`, `clawback` or `approve`. If a token's vocabulary
ever leaks into the ingest loop or a query, that test goes red and the repoint
stops being a one-directory change before anyone is relying on it.

Two decisions inside the registry are worth knowing about:

- **A contract id may be `*`.** The obvious key is exact — this contract, this
  event — and it works for a contract you deployed. It does not work at all for
  the Stellar Asset Contract, which is not *a* contract: there is one per
  asset, derived from the asset and the network passphrase, and testnet has
  thousands of them. So the SAC decoders register under `*`, and prove which
  contract they are looking at from the event itself. Exact keys are tried
  first, so a specific contract can always override the general reading.
- **A decoder may decline.** Any contract can emit an event named `transfer`
  that has nothing to do with the token interface, and two of the committed
  fixtures are exactly that — a one-topic `transfer` of a contract's own
  design, and a three-topic `mint` whose last topic is an address where the
  asset would be. Returning null hands the event back to be shown structurally.
  Decoding it anyway would put a confident wrong sentence on the screen.

### The asset is checked, not believed

A four-topic transfer names its asset in the last topic, and any contract can
put `USDC` there. The SAC's address is derived from the asset and the network
passphrase, so the claim is settled by deriving it and comparing:

```
  transfer  9.2500000 XLM from GBRMG…RTUS to GAV6P…OU6O
            emitted by native's Stellar Asset Contract, derived and matched
```

and when it does not match, the amount stops being formatted as a classic
asset too — seven decimal places is a fact about a SAC of a classic asset, and
once the contract is unidentified that fact is no longer in evidence:

```
  transfer  100000000000 XLM from GAIH3…ZNSR to GALE5…XAVO
            the emitting contract is not native's Stellar Asset Contract (that
            would be CDLZFC3…HGCYSC), so the asset name is this contract's
            claim rather than a fact
```

## Options

### `ingest`

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
--offline                read a captured fixture instead of the network
--fixtures <dir>         which fixture (default: fixtures/testnet-slice)
--log <text|json>        default: text on a terminal, json otherwise
```

`--start-ledger` is consulted only when the database has no cursor yet, so
leaving it in a restart command is harmless — an existing database always
resumes from where it stopped. Its default differs by mode: live, an indexer
started now should follow the network from now, so it is `latest`; offline, the
fixture is the whole world and there is no reason to start at the end of it, so
it is `oldest`.

### `capture` and `demo`

```
npm run demo                     the whole stack, offline, network unplugged

npm run capture -- [options]
  --ledgers <n>            how many ledgers to capture (default: 200)
  --transactions <n>       how many to fetch meta for (default: 25)
  --start-ledger <n>       where to start (default: back from the tip)
  --out <dir>              where to write (default: fixtures/testnet-slice)
  --name <name>            what to call it in the manifest
```

### `recent`

```
--db <path>              database file (default: trace.db)
--limit <n>              how many transactions (default: 10)
--hash-only              just the hashes, one per line
```

### `trace`

```
<tx-hash>                the transaction to read, 64 hex characters
--full                   every field of every entry, not only what changed
--json                   the decoded structure, for piping somewhere else
--offline                read a captured fixture instead of the network
--fixtures <dir>         which fixture (default: fixtures/testnet-slice)
--config <path>          where the RPC url comes from
```

### Exit codes, shared by both

| Exit | Meaning |
| --- | --- |
| `0` | done — reached `--end-ledger`, caught up under `--once`, or traced |
| `130` | interrupted |
| `2` | usage or config error, including a start ledger outside retention |
| `3` | the RPC server is not testnet, or the database is not |
| `4` | history aged out while the indexer was stopped, and no `--acknowledge-gap` |
| `5` | the filters changed under an existing database |
| `6` | no such transaction on this RPC server |
| `1` | anything unexpected, with a stack |

A hash the server has never heard of and a hash whose ledger has aged out are
the same `NOT_FOUND` on the wire, so `trace` prints the window alongside the
refusal and leaves the reader to tell which they are looking at:

```
x no transaction 00000000…00000000 on this RPC server.

  It holds ledgers 4125436 to 4246395. A transaction older than
  ledger 4125436 is not missing — it is outside the window, and no RPC
  method will return it. A newer one may not have been applied yet.
```

## What this does not do

- **Decode events it has no decoder for.** The registry covers the token
  interface. Everything else is shown structurally — topics and value, as they
  are — rather than guessed at. Adding a contract is
  [two files in one directory](#teaching-it-what-the-events-mean).
- **Decode on the way in.** Events are stored as the XDR they arrived as, and
  decoded on the way out, every time. A decoder fixed next week reads the rows
  ingested last week; a decoder that was wrong cost a query, not a re-ingest.
- **Store what it traces.** `trace` reads one transaction from RPC and prints
  it. It never touches the database, and running it twice asks the network
  twice.
- **Pretend a fixture is the network.** Offline, `latestLedger` is the end of
  the capture and nothing exists past it. That is what lets the loop reach
  "caught up" instead of chasing a tip it can never see, and it is why an
  offline database is honest about covering a small range.
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
  rpc.ts               getEvents/getTransaction/getHealth over JSON-RPC
  toid.ts              reading the ledger out of an event id or cursor
  db.ts                the schema, and the page/cursor transaction
  ingest.ts            ** the loop, and everything it refuses to do **
  exit.ts              exit codes, shared by both commands
  format.ts            stroops and addresses, for whoever has to show one
  decoders/
    registry.ts        ** (contract, topic[0]) -> a decoder. Knows no tokens **
    sac.ts             the token interface: transfer, mint, burn, clawback,
                       fee, approve — and the SAC derivation that checks them
    types.ts           what a decoder is handed and must return
    index.ts           the default registry: one line per decoder
  offline/
    fixtures.ts        what a captured slice looks like on disk
    replay.ts          ** a fixture, served as if it were an RPC server **
  meta/
    decode.ts          ** resultMetaXdr -> a state progression **
    entries.ts         ledger entries described in words and formatted
    render.ts          the decoded transaction as text
  bin/ingest.ts        the ingest command line
  bin/trace.ts         the trace command line
fixtures/
  testnet-slice/       a committed capture: whole responses, untouched
scripts/
  recent.ts            recent transactions, decoded out of the database
  capture.ts           record a slice of testnet into fixtures/
  demo.ts              the whole stack, offline
  no-network.ts        replaces fetch with a refusal, imported by the demo
  check-restart.ts     kill it mid-run, restart, compare
test/                  unit tests, no network — the loop runs against a
                       scripted server, and the decoder against real
                       transactions committed under test/fixtures
```

## References

- [getEvents](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getEvents) — the endpoint, its pagination, and its limits
- [getTransaction](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getTransaction) — where `resultMetaXdr` comes from
- [Ingest events published from a contract](https://developers.stellar.org/docs/build/guides/events/ingest)
- [CAP-0067](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0067.md) — the event shapes, including classic operations emitting `transfer`
- [Token interface](https://developers.stellar.org/docs/tokens/token-interface) · [Stellar Asset Contract](https://developers.stellar.org/docs/tokens/stellar-asset-contract) — what the decoders implement
- [Token Transfer Processor](https://developers.stellar.org/docs/data/indexers/build-your-own/processors/token-transfer-processor) — SDF's Go implementation of these same semantics, and the reference for what the events mean
- [Reconciling Stellar events](https://stellar.org/blog/developers/reconciling-stellar-events) — on the retention window and what lives outside it
- [RPC data formats](https://developers.stellar.org/docs/data/apis/rpc/api-reference/structure/data-format) — `xdrFormat: "json"`, which is far easier to read while exploring
