# privy-stellar-onboarding

Email login to a funded testnet contribution in one flow: create an embedded
Stellar wallet from an email address, add a USDC trustline, and send USDC to a
pool through the Stellar Asset Contract — with no seed phrase at any point.

The same flow also runs against a wallet the user already has (Freighter or
xBull, via Stellar Wallets Kit), selected with one environment variable.

**Testnet only.** No real money is involved, and no mainnet configuration path
exists — see [Testnet only](#testnet-only).

---

## Requirements

- Node.js 20+
- A [Privy app ID](https://dashboard.privy.io) — free, and public by design
- Or, for `wallets-kit` mode: [Freighter](https://freighter.app) or
  [xBull](https://xbull.app) installed and **switched to Test Net**

## Quick start

```bash
npm install
cp .env.example .env.local     # set NEXT_PUBLIC_PRIVY_APP_ID
npm run dev
```

Open http://localhost:3000. In the Privy dashboard, add `http://localhost:3000`
to your app's allowed origins, or login will be rejected.

The page walks through seven steps and each one tells you what it did:

| # | Step | What happens |
| --- | --- | --- |
| 1 | Create your Stellar wallet | Privy creates an embedded wallet, `chainType: "stellar"` |
| 2 | Get some test XLM | Friendbot funds the account |
| 3 | Check that signing works | A no-op payment, to prove the signature is accepted |
| 4 | Switch on USDC | `changeTrust` — reserves 0.5 XLM, refundable |
| 5 | Claim some test USDC | Circle's [testnet faucet](https://faucet.circle.com), 20 USDC per 2 hours |
| 6 | Contribute | `transfer` on the Stellar Asset Contract |
| 7 | See what a failure looks like | Two deliberate failures, with and without preflight |

### Running against a browser wallet instead

No Privy app ID is needed, and none is used:

```bash
NEXT_PUBLIC_WALLET_MODE=wallets-kit npm run dev
```

The extension must be on **Test Net** with a funded account. The app checks the
wallet's network at connect time and stops there if it is on Public, rather than
asking you to approve a transaction your wallet cannot make sense of.

## Configuration

All configuration is public by design — there is no server, no API route, and no
`PRIVY_APP_SECRET`. Wallet creation and signing both happen in the browser.

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_WALLET_MODE` | `privy` | `privy` or `wallets-kit` |
| `NEXT_PUBLIC_PRIVY_APP_ID` | — | Required in `privy` mode, unused in `wallets-kit` |
| `NEXT_PUBLIC_POOL_ADDRESS` | a testnet `G…` address | Where contributions go; accepts a `G…` or a pool contract's `C…` |
| `NEXT_PUBLIC_ASSET_CODE` | `USDC` | Override if Circle's faucet is flaky |
| `NEXT_PUBLIC_ASSET_ISSUER` | Circle's testnet issuer | Override alongside `ASSET_CODE` |

Network settings are deliberately absent from the environment. See
[Testnet only](#testnet-only).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build — takes no secrets, builds in either mode |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run verify:contribution` | Run the contribution path against live testnet |

---

## How it works

### One `Signer` interface, two implementations

Privy and Stellar Wallets Kit sit at different levels, so the interface is drawn
at the higher of the two — [`lib/signing/signer.ts`](lib/signing/signer.ts):

```ts
type Signer = {
  readonly address: string;
  signTransaction(tx: Transaction): Promise<Transaction>;
};
```

| | Privy | Stellar Wallets Kit |
| --- | --- | --- |
| Holds the key | Yes, custodied | No — it stays in the extension |
| Accepts | 32 bytes | A transaction, as XDR |
| Returns | 64 raw bytes | Signed XDR |
| Who approves | Nobody, it signs on request | The user, in the extension |

Drawn any lower (`signHash`, say) the Kit could not implement it at all.

> **The one thing that bites here:** Privy attaches the signature to the
> transaction you passed in, so the argument and the result are the same object.
> A wallet extension returns *different* XDR. Code that submits the argument
> instead of the return value works in Privy mode and silently submits an
> unsigned transaction in Kit mode. Always use the return value.

### The Privy glue

Stellar sits in Privy's **Tier 2** — Privy handles the wallet (creation, key
management, recovery, export) and you handle the transaction (XDR, submission,
sequence numbers, fees). Both APIs you need are client-side:

```ts
import { useCreateWallet, useSignRawHash } from "@privy-io/react-auth/extended-chains";

const { wallet } = await createWallet({ chainType: "stellar" });
```

Privy returns a bare 64-byte signature; Stellar wants a `DecoratedSignature`
appended to the transaction. That adapter is the entire Privy-specific surface
area of this app — [`lib/signing/privy.ts`](lib/signing/privy.ts):

```ts
const { signature } = await signRawHash({
  address,
  chainType: "stellar",
  hash: `0x${tx.hash().toString("hex")}`,
});

tx.signatures.push(
  new xdr.DecoratedSignature({
    hint: Keypair.fromPublicKey(address).signatureHint(), // last 4 bytes of pubkey
    signature: Buffer.from(signature.slice(2), "hex"),
  }),
);
```

Everything else is ordinary `@stellar/stellar-sdk` usage that would look the same
behind any signer.

### What the Kit implementation checks

Delegating is not trusting. [`lib/signing/wallets-kit.ts`](lib/signing/wallets-kit.ts)
verifies three things that are otherwise invisible until Horizon rejects the
result:

- **A different transaction.** The returned envelope's hash must equal the one
  that was sent. A fee-bump wrapper is refused for the same reason.
- **A different account.** Freighter signs with whichever account is *active*,
  and that can be switched between connecting and approving. The signature is
  verified against the address the app is using.
- **A different network.** Checked once at connect time, because every hash here
  is built against the testnet passphrase.

### Where the two modes differ

Only step 1. Privy creates a wallet on request; an extension arrives with an
account already. `Session.createWallet` is `null` in Kit mode and the step
renders as done, naming the wallet it connected with.

Everything after that is one code path with no branch on mode in it. The page
reads [`useSession()`](lib/wallet/session.ts) and never asks what is behind it.
Selection happens at build time — `NEXT_PUBLIC_` values are inlined, so exactly
one session provider is ever mounted and a Kit build needs no Privy app ID.

### The contribution flow

Holding an asset on Stellar is an explicit act, so contributing is four steps,
not one, and the app shows all four:

1. **Trustline.** `changeTrust` to the USDC issuer. Until this exists the wallet
   cannot receive the asset *at all* — the account has no place to put it.
   Costs 0.5 XLM held in reserve, not spent.
2. **Acquire USDC.** Circle's testnet faucet.
3. **Preflight.** Read on-chain state and refuse early if it cannot work.
4. **Contribute.** `transfer` on the Stellar Asset Contract.

The SAC address is *derived* from the asset and network passphrase rather than
configured, so a wrong-network build would compute an address that does not
exist instead of quietly talking to the wrong contract.

### Three details that are easy to get wrong

**Sign after preparing, never before.** Simulation determines the footprint and
resource fees, and assembling those produces a *different* transaction with a
different hash. A signature taken before `assembleTransaction` is dead on
arrival.

**Keep `from` equal to the transaction source.** The SAC calls `require_auth` on
the sending address; when that is also the source account, the ordinary
transaction signature satisfies it. If the two diverge you must sign a
`SorobanAuthorizationEntry` separately, which is considerably harder with a
raw-hash signer.

**Trustlines are asymmetric.** A `G…` recipient needs its own USDC trustline; a
`C…` contract does not, because contract balances live in contract storage.
`preflight` branches on the address prefix, so switching `NEXT_PUBLIC_POOL_ADDRESS`
between the two needs no code change.

### Failure modes

Simulation catches most of these, but only as an opaque host error. Reading state
directly means the user is told which account is short and by how much.
[`lib/stellar/errors.ts`](lib/stellar/errors.ts) models four outcomes:

| Outcome | Detected by | What the user is told |
| --- | --- | --- |
| `missing-trustline` | preflight, per account | which account, and that a `C…` address would not need one |
| `insufficient-balance` | preflight | held versus requested |
| `simulation-failed` | Soroban simulation | the host error, and that it cost no fee |
| `submission-failed` | send / poll | that signing worked and the network did not accept it |

Step 7 has two buttons that send the same impossible contribution (999999 USDC)
and differ only in whether preflight runs, so you can see both shapes of error.
Note that `skipPreflight` does not *induce* a failure — it removes an early
check, and a contribution that would have succeeded still succeeds without it.

## Testnet only

The network passphrase, Horizon URL, Soroban RPC URL and Friendbot URL are
literals in [`lib/stellar/network.ts`](lib/stellar/network.ts). None is read from
the environment, so no `.env` file, build flag or deployment setting can point
this app at mainnet — changing networks requires editing that file.

The passphrase is load-bearing rather than cosmetic: it is mixed into the payload
that `Transaction.hash()` produces, so a transaction built here is only ever
valid on testnet. Submitted to mainnet it would be rejected as `tx_bad_auth`
rather than succeeding against real funds.

## Project structure

```
app/                    Next.js App Router — one page, one providers file
components/             Presentational components, no styling system
lib/
  signing/
    signer.ts           The Signer interface
    privy.ts            Hash → DecoratedSignature adapter
    wallets-kit.ts      Delegates to the extension, verifies the result
  wallet/
    mode.ts             Reads NEXT_PUBLIC_WALLET_MODE
    session.ts          useSession() — what the page consumes
    privy-session.tsx   Privy provider
    kit-session.tsx     Wallets Kit provider
  stellar/
    network.ts          Testnet literals — the only network config
    assets.ts           USDC, SAC derivation, stroop conversion
    contribute.ts       preflight + transfer
    errors.ts           The four failure outcomes
    horizon.ts          Account and balance reads
  ui/                   Activity log, contribution list, local state
scripts/
  verify-contribution.mts
```

## Verifying against live testnet

```bash
npm run verify:contribution
```

[`scripts/verify-contribution.mts`](scripts/verify-contribution.mts) runs the
real `contribute`, `addTrustline` and `preflight` against testnet. It builds its
`Signer` from the shipped `privySigner`, handed a local `Keypair` in place of
Privy's service — so the hash extraction, the hint and the `DecoratedSignature`
attachment are all the real code, and only the custodian is substituted.

```
✅ missing trustline (donor)
✅ missing trustline surfaces from Soroban when preflight is skipped
✅ changeTrust signed by the stand-in signer
✅ insufficient balance — you have 0, this would send 5
✅ missing trustline (recipient)
✅ SAC transfer accepted
✅ donor debited — balance 75.0000000
✅ pool credited — balance 25.0000000
```

It generates its own keypairs and needs no configuration. It uses a throwaway
issuer rather than Circle's USDC because the success case needs to mint itself a
supply and Circle's faucet is captcha-gated; the SAC is generated per-asset by
the protocol and is the same contract either way.

It is not part of CI: it spends real testnet ledger time and depends on Friendbot
being up, so a network hiccup would show as a broken build.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Login fails or the Privy modal never returns | Your origin is not in the Privy dashboard's allowed-origins list |
| The page says the wallet mode is not recognised | `NEXT_PUBLIC_WALLET_MODE` is set to something other than `privy` or `wallets-kit` |
| Kit mode refuses to continue after connecting | The extension is on Public — switch it to Test Net |
| Friendbot funding fails | Friendbot rate-limits per address; wait, or use an already-funded account |
| Step 5 gives you nothing | Circle's faucet allows 20 USDC per address per 2 hours |
| A contribution fails with a trustline error | Step 4 was skipped, or the `G…` recipient has no trustline of its own |

## Not included

- **Mainnet.** Testnet only, enforced structurally.
- **A backend.** No server, no database. The activity log and contribution list
  survive a reload in `localStorage`, but nothing reads them as truth — the chain
  is the only record, and every entry links out to it.
- **Rust and contract deployment.** The pool contract is consumed as a configured
  address and treated as an interface.
- **A design system.** No component library, no state management library.
- **Multi-asset support.** One asset, one pool, one path through the app.
- **Both signers at once.** The mode is a build-time choice.
- **Retry and resubmission logic** beyond surfacing the error. A production flow
  would handle `tx_bad_seq` and `TRY_AGAIN_LATER` with backoff.
- **A unit test suite.** The verification script hits live testnet and is the
  only test here — mocking Horizon and Soroban would test the mocks.

## Resources

- **Privy** — [docs](https://docs.privy.io) ·
  [chain support tiers](https://docs.privy.io/wallets/overview/chains) ·
  [tier 2 recipe](https://docs.privy.io/recipes/use-tier-2) ·
  [raw sign](https://docs.privy.io/wallets/using-wallets/other-chains/raw-sign) ·
  [client-side wallet creation](https://docs.privy.io/wallets/wallets/create/from-my-client)
- **Stellar** — [Stellar Asset Contract](https://developers.stellar.org/docs/tokens/stellar-asset-contract) ·
  [JS SDK](https://stellar.github.io/js-stellar-sdk/) ·
  [Soroban RPC](https://developers.stellar.org/docs/data/apis/rpc)
- **Stellar Wallets Kit** — [docs](https://stellarwalletskit.dev) ·
  [GitHub](https://github.com/Creit-Tech/Stellar-Wallets-Kit) ·
  [npm](https://www.npmjs.com/package/@creit.tech/stellar-wallets-kit)
- [SEP-43](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0043.md)
  — the wallet interface the Kit's modules implement, and the reason
  `signTransaction` takes the shape it does

## License

Apache 2.0 — see the [LICENSE](../../LICENSE) at the repository root.
