# oracle-price-reader

**Requirements:** A price is only usable if you know how old it is, what
scale it is on, and which feed produced it. This reader subscribes to a live
oracle stream for XAU/USD and USDC/CHF and prints every tick with its source,
its exponent, and its publish timestamp, refusing to present a price that has
gone stale.

The interesting half is not the subscription. It is the three things a printed
price has to carry to be worth anything, and the fact that one of the two
requested pairs does not exist as a feed and has to be derived from two that do.

| | |
| --- | --- |
| Source | Pyth Hermes, public instance |
| Pairs | XAU/USD (direct), USDC/CHF (derived) |
| Network | none, this example does not touch Stellar |
| Credentials | `PYTH_API_KEY`, required since 26 August 2026 |

## Why Pyth Hermes

**Hermes, over server-sent events.** It carries metals and FX on the same
transport as crypto, its feed metadata is queryable without credentials, and a
parsed update arrives as JSON with the price, the exponent, the confidence
interval and the publish time already separated, which is exactly the set of
fields this example is about.

The three that lost, and why:

- **Chainlink.** No Stellar deployment, and its Data Feeds are on-chain
  contracts on EVM networks, so "subscribe and print" would mean polling an EVM
  RPC. Data Streams is the streaming product and needs a commercial credential
  before the first byte. Either way the reader would be teaching an EVM
  integration in a Stellar repository.
- **Pyth Lazer**, the Pro websocket at `wss://pyth-lazer-N.dourolabs.app`. A
  real websocket, numeric feed ids, sub-second channels. It loses on cost: a Pro
  key is mandatory, there are three redundant endpoints to manage, and the
  payload is a binary format aimed at on-chain verification. All of that is
  correct for production and all of it buries the point here.
- **Reflector**, the SEP-40 oracle native to Stellar. Free, on-chain, and the
  right answer the moment a Soroban contract is the thing reading the price.
  It loses here because this example is the off-chain half, and because its
  coverage of metals and FX is not what Pyth's is. It is the counterpart to
  this example, not a competitor to it.

**The cost of choosing Hermes, stated plainly.** Since the Pyth Core upgrade on
26 August 2026 every price endpoint requires an API key, including on the public
instance. Verified against the live service: `/v2/price_feeds` answers 200
without credentials, `/v2/updates/price/latest` and `/v2/updates/price/stream`
answer `401 unauthorized`. Register at Pyth Terminal for a key. The public
instance is also rate limited to 10 requests per 10 seconds per IP, which the
stream is fine with and a polling loop is not.

## USDC/CHF is not a feed

Pyth has no USDC/CHF. It has these:

| Symbol | Feed id | Asset type |
| --- | --- | --- |
| `Metal.XAU/USD` | `765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2` | Metal |
| `Crypto.USDC/USD` | `eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a` | Crypto |
| `FX.USD/CHF` | `0b1e3297e69f162877b577b0d6a47a0d63b2392bc8499e6540da4187a63e28f8` | FX |

So `USDC/CHF = (USDC/USD) x (USD/CHF)`, a cross computed from two independent
feeds, and everything that made a single price legible now has to be combined:

- **Two exponents.** Multiplying prices adds exponents. Combine them as
  integers and keep the result as a mantissa and an exponent. Converting each
  leg to a float first and multiplying is the version of this that looks right
  and drifts.
- **Two confidence intervals.** The cross is not more certain than its legs.
  Propagate rather than discard.
- **Two publish times, and only one of them matters.** The age of the cross is
  the age of its *older* leg. A derived pair printed with a single fresh
  timestamp is stating something false about the other half of itself.

Print the legs alongside the cross. A reader that shows only the product cannot
tell a moved gold price from a moved franc.

## Staleness is two states, not one

A staleness threshold on its own produces an alarm that fires every weekend,
and an alarm that fires every weekend gets muted.

**XAU/USD and USD/CHF close.** Metals and FX both follow a trading calendar,
and Pyth publishes it: each feed's metadata carries `market_hours.is_open`,
`next_open`, `next_close` and a full `schedule` string. USDC/USD, being crypto,
never closes. So the reader distinguishes:

| Status | Meaning |
| --- | --- |
| `OK` | Age within threshold. |
| `STALE` | The market is open and the price has not moved for longer than the threshold. Something is wrong. |
| `CLOSED` | The market is shut. The price is the last one before close, and the next open is known and printed. Nothing is wrong. |

There is a third way a price can be old while looking new: Pyth may carry a
price forward from an earlier update, so an envelope can be fresh while the
feed behind it has not published. The update carries its own feed-level
timestamp for exactly this reason, and the reader reports that one, not the
envelope's.

## Output

One line per pair per tick, carrying everything named in the requirement:

```
XAU/USD    4083.51500 USD  (raw 408351500 e-5, conf 0.42)  Metal.XAU/USD 765d2b..  2026-09-03T14:22:07Z  age 0.4s  OK
USDC/CHF   0.79412    CHF  (raw 79412 e-5, conf 0.00031)   derived        eaa020../0b1e32..  2026-09-03T14:22:05Z  age 2.1s  OK
  USDC/USD 0.99988  age 0.4s  OK
  USD/CHF  0.79422  age 2.1s  OK
```

Never print the scaled value alone. The raw mantissa and the exponent are what
the feed actually said, and a bug in the scaling is invisible without them.
The exponent is read from each update, never hardcoded: Pyth can and does change
a feed's exponent, and a constant in the source is a wrong answer waiting for
that day.

## Run it

```bash
cd examples/oracle-price-reader
cp .env.example .env    # then add your PYTH_API_KEY
npm install
npm start                       # stream all three feeds
npm start -- --stale-after 10s  # override the threshold
```

## What this example deliberately omits

- **No Stellar.** This reads an off-chain price stream and prints it. Nothing
  is signed, submitted, or stored. Putting a price on chain is a different
  problem with a different answer, and on Stellar that answer is a SEP-40
  oracle, not a transcription of this output.
- **No proof verification.** Hermes returns a signed binary payload alongside
  the parsed JSON, and this example reads the JSON. The parsed fields are
  convenience, and trusting them means trusting Hermes. That is the correct
  trade for a reader that prints to a terminal and the wrong one for a contract
  that moves money.
- **No aggregation across oracles.** One source, named on every line.
- **No alerting.** Status goes to stdout. Deciding who gets woken up is a
  property of an operation, not of a price.

## What this does not prove

- **That the price is correct.** It proves the price's age, its scale and its
  provenance are all visible, which is the part that is usually missing. It
  says nothing about whether the publishers agree with the market.
- **That the cross is safe.** A stalled or wrong USD/CHF leg produces a
  perfectly plausible USDC/CHF. Two feeds is two failure surfaces, and the
  derived line inherits both.

## Resources

- [Hermes](https://docs.pyth.network/price-feeds/core/how-pyth-works/hermes) and
  [API instances and providers](https://docs.pyth.network/price-feeds/core/api-instances-and-providers/hermes),
  including the rate limit and the node providers to move to for production
- [Preparing for the Pyth Core upgrade](https://docs.pyth.network/price-feeds/core/upgrade/preparing),
  the API key requirement and its date
- [Fetch price updates](https://docs.pyth.network/price-feeds/core/fetch-price-updates),
  the SSE stream endpoint and the shape of a parsed update
- [`@pythnetwork/hermes-client`](https://www.npmjs.com/package/@pythnetwork/hermes-client)
- [SEP-40](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0040.md),
  the price feed interface a Soroban contract would read instead
