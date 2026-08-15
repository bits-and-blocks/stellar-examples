# privy-stellar-onboarding

Email login to funded testnet contribution in one flow: Privy embedded wallet,
then test USDC into a pool via the Stellar Asset Contract with transfer results
checked. The commit history is the integration timer.

**Status: working.** Email login to a USDC contribution through the Stellar
Asset Contract, with no seed phrase at any point. The Privy integration measured
**15 minutes 8 seconds** — see [Integration timer](#integration-timer). The
contribution path, including every failure mode, is verified against live
testnet by `npm run verify:contribution`.

## The claim this validates

> A first-time donor can go from an email address to a completed on-chain
> contribution without ever seeing a seed phrase, and a competent developer can
> wire that up in under a day.

The second half is the part that is easy to assert and hard to prove, so this
example measures it. The commit history is the instrument: the elapsed time
between the commit titled `integration start` and the commit titled
`first signed testnet tx` is the number. It is whatever it turns out to be.

## Which shape Privy's Stellar support takes

Phase 0 asked whether Privy provides first-class Stellar embedded wallets, or
only raw ed25519 signing with us building and submitting the XDR ourselves.

**The answer is neither, exactly. Stellar sits in Privy's Tier 2 tier, which
splits the two.** Privy handles the wallet; we handle the transaction.

| Privy provides | We build ourselves |
| --- | --- |
| Embedded wallet creation with `chainType: 'stellar'` | Transaction building (XDR) |
| Derived `G…` address, key management, recovery, export | Submission to Horizon / Soroban RPC |
| An ed25519 signature over an arbitrary 32-byte hash | Sequence numbers, fees, timebounds |
| Email/OAuth auth and session handling | All asset- and SAC-specific logic |

Privy's own tiering, for reference: Tier 3 (Ethereum, Solana, Tempo) is
end-to-end including transaction construction; **Tier 2 (Stellar, Cosmos, Sui,
Tron, Aptos, Ton, Bitcoin, and others) is wallet abstractions plus raw signing**;
Tier 1 is raw cryptography only.

So "raw ed25519 signing" undersells it — we never derive an address or touch a
key. "First-class embedded wallets" oversells it — Privy builds and submits
nothing. Both APIs we need are client-side:

```ts
import { useCreateWallet, useSignRawHash } from "@privy-io/react-auth/extended-chains";

const { wallet } = await createWallet({ chainType: "stellar" });
const { signature } = await signRawHash({ address, chainType: "stellar", hash });
```

### What follows from that

**No server, and therefore no secrets.** Wallet creation and signing both happen
in the browser, so this app has no API routes, no backend, and no
`PRIVY_APP_SECRET`. The only environment variable is `NEXT_PUBLIC_PRIVY_APP_ID`,
which is a public identifier by design — Privy scopes it with a dashboard
allowed-origins list. "No secrets in history" is structural here, not a policy
we have to enforce.

**The integration reduces to one piece of glue.** Privy returns a bare 64-byte
signature; Stellar wants a `DecoratedSignature` appended to the transaction:

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

That is the whole Privy-specific surface area. Everything else in this example
is ordinary `@stellar/stellar-sdk` usage that would look the same behind any
signer, which is also what makes the Phase 1 decision gate cheap: swapping to
Stellar Wallets Kit would replace these lines and nothing else.

## Testnet only

The network passphrase, Horizon URL, Soroban RPC URL and Friendbot URL are
literals in [`lib/stellar/network.ts`](lib/stellar/network.ts). None is read
from the environment, so no `.env` file, build flag or Vercel setting can point
a deployment at mainnet; changing networks requires editing that file.

The passphrase is load-bearing rather than cosmetic: it is mixed into the
payload that `Transaction.hash()` produces, so a transaction built here is only
ever valid on testnet. Submitted to mainnet it would be rejected as
`tx_bad_auth` rather than succeeding against real funds.

## Running it

```bash
npm install
cp .env.example .env.local   # fill in NEXT_PUBLIC_PRIVY_APP_ID
npm run dev
```

The repository's shared CI installs and builds every example under `examples/`
on each push and pull request, so this directory is covered by `npm install` and
`npm run build`. `npm run lint` and `npm run typecheck` are available locally.
The build takes no secrets.

## Integration timer

**15 minutes 8 seconds**, from the end of setup to a confirmed transaction on
testnet.

| | Evidence | Time (UTC) |
| --- | --- | --- |
| Start | commit [`c546ce2`](https://github.com/bits-and-blocks/privy-stellar-onboarding/commit/c546ce2), the last pre-integration commit | 2026-08-15 00:19:54 |
| End | ledger 4146515, [tx `1fe8822…`](https://stellar.expert/explorer/testnet/tx/1fe8822065555a7c716ba7514908fa899d15a40593984aa7277b0e5811c84c4d) | 2026-08-15 00:35:02 |

### Why these endpoints, and not two commit hashes

The brief called for commit-to-commit timing. The end marker here is a ledger
close time instead, for a reason worth stating: **a repository owner can set any
commit date they like, and the person reading this has no way to check.** A
ledger close time is not something this repo controls. Anyone can fetch it:

```bash
curl -s https://horizon-testnet.stellar.org/transactions/1fe8822065555a7c716ba7514908fa899d15a40593984aa7277b0e5811c84c4d \
  | grep created_at
```

The start marker is a commit, because "when did setup end" is a claim about the
work and the commit log is the right record for it. Using the *last
pre-integration* commit rather than a `integration start` marker also makes the
number a conservative upper bound: it counts the gap before work resumed as
integration time, so the real figure is lower.

`c546ce2` lives in
[bits-and-blocks/privy-stellar-onboarding](https://github.com/bits-and-blocks/privy-stellar-onboarding),
the standalone repository this example was developed in and migrated from. That
repo is archived and read-only. The link points there rather than at the
equivalent commit in this repo deliberately: migrating rewrote every hash, and a
frozen external repository is a better record of "when did setup end" than one
that is still being written to.

### What the 15 minutes does and does not include

**Inside the window:** installing `@privy-io/react-auth` and
`@stellar/stellar-sdk`, writing the signature glue, wiring email login, wallet
creation, Friendbot funding and payment submission, and getting a transaction
accepted by Horizon.

**Outside the window, in Phase 0:** working out that Stellar is Tier 2 and what
that implies — which is the part that would mislead a reader if it went
unmentioned. Knowing in advance that you need `useCreateWallet`, `useSignRawHash`
and a `DecoratedSignature` wrapper is most of the problem. That research is
written up above precisely so the next person starts where this timer started.

**Also outside the window:** the work was assisted by an AI coding agent. Take
the number as evidence that the integration is small and well-specified — one
adapter function and four hook calls — rather than as an estimate of how long it
takes a person typing unaided.

### Decision gate: passed

Phase 1 was a gate. If Privy's embedded wallet could not produce a signature
Horizon accepts, the plan was to stop, swap to Stellar Wallets Kit, and revise
the claim. It signed and Horizon accepted it, so the flow continues on Privy.

## The contribution flow

A donor must hold USDC before they can contribute it, and on Stellar holding an
asset is an explicit act. The flow is therefore four steps, not one, and the app
shows all four rather than hiding them:

1. **Trustline.** `changeTrust` to Circle's testnet USDC. Until this exists the
   wallet cannot receive the asset *at all* — not "the transfer fails", but the
   account has no place to put it. Costs 0.5 XLM held in reserve, not spent.
2. **Acquire USDC.** Circle's [testnet faucet](https://faucet.circle.com),
   20 USDC per address every 2 hours.
3. **Preflight.** Read the on-chain state and refuse early if it cannot work.
4. **Contribute.** `transfer` on the Stellar Asset Contract.

Circle's testnet USDC was checked rather than assumed: the issuer
`GBBD47IF…AQH3ZLLFLA5` publishes `home_domain: centre.io`, carries ~55k
trustlines, and **its SAC is already deployed** at `CBIELTK6…`, so contributions
need no deployment step. The SAC address is derived from the asset and network
passphrase rather than configured, so a wrong-network build would compute an
address that does not exist instead of quietly talking to the wrong contract.

### Three details that are easy to get wrong

**Sign after preparing, never before.** Simulation determines the footprint and
resource fees, and assembling those into the transaction produces a *different*
transaction with a different hash. A signature taken before
`assembleTransaction` is dead on arrival.

**`from` is the transaction source, so there is no auth entry to sign.** The SAC
calls `require_auth` on the sending address. When that address is also the
transaction's source account, the ordinary transaction signature satisfies it.
If the two ever diverge you must sign a `SorobanAuthorizationEntry` separately,
which is considerably harder with a raw-hash signer. Keeping them identical is
what makes this integration one signature rather than two mechanisms.

**Trustlines are asymmetric between the interim and final targets.** The interim
G-address recipient needs its own USDC trustline. The final pool contract, a
C-address, does not, because contract balances live in contract storage.
`preflight` branches on the address prefix, so swapping
`NEXT_PUBLIC_POOL_ADDRESS` from one to the other needs no code change.

### Failure modes are outcomes, not one error string

Simulation would catch most of these, but only as an opaque host error. Reading
the state directly means the donor is told which account is short and by how
much. [`lib/stellar/errors.ts`](lib/stellar/errors.ts) models four outcomes:

| Outcome | Detected by | What the donor is told |
| --- | --- | --- |
| `missing-trustline` | preflight, per account | which account, and that a C-address would not need one |
| `insufficient-balance` | preflight | held versus requested |
| `simulation-failed` | Soroban simulation | the host error, and that it cost no fee |
| `submission-failed` | send / poll | that signing worked and the network did not accept it |

The app has two buttons that deliberately fail. Both send the same impossible
contribution — 999999 USDC — and differ only in whether preflight runs.
**Too much, with the check** produces `insufficient-balance` with the held and
requested amounts. **Too much, no check** skips preflight, so the same mistake
arrives from Soroban as a host error instead.

Worth being precise about what `skipPreflight` does, because the first version
of this demo got it wrong: it does not induce a failure. It removes an early
check. A contribution that would have succeeded still succeeds without it — as
one of the transactions below demonstrates, having been sent through that path
by accident. Only when paired with a genuinely impossible contribution does it
show the ugly error it is meant to show.

## Verifying the contribution path

```bash
pnpm verify:contribution
```

[`scripts/verify-contribution.mts`](scripts/verify-contribution.mts) runs the
real `contribute`, `addTrustline` and `preflight` against live testnet, with a
local `Keypair` substituted for Privy through the identical interface. It
asserts every failure mode, then performs a real SAC transfer and checks both
balances moved:

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

It uses a throwaway issuer rather than Circle's USDC because the success case
needs the script to mint itself a supply and Circle's faucet is captcha-gated.
The SAC is generated per-asset by the protocol and is the same contract either
way. The script deploys that SAC itself with `createStellarAssetContract`, which
is the step Circle's USDC does not need and a fresh issuer does.

It is not part of CI: it spends real testnet ledger time and depends on
Friendbot being up, so a network hiccup would show as a broken build.

## Verifying the signature glue without Privy

[`lib/stellar/sign.ts`](lib/stellar/sign.ts) is the only component that can
silently produce an invalid transaction, so it was tested against real testnet
with a local `Keypair` substituted for Privy — same interface, 32-byte hash in
and 64-byte signature out. Horizon accepted the result
([tx `e477097…`](https://stellar.expert/explorer/testnet/tx/e47709761bf1351e38c4ad5435963c9cca05561e4573b368d5f7ef82f1d3c0c5)),
which isolates the `DecoratedSignature` construction, the hint derivation and
the signature-base hashing from anything Privy does.

That mattered for debugging order: with the glue independently confirmed, a
failure in the real flow could only be Privy or the app wiring.

## Transactions

Every transaction below was signed by a key held in a Privy embedded wallet,
created from an email address with no seed phrase shown at any point.

| Phase | What it proves | Signer | Transaction |
| --- | --- | --- | --- |
| 1 | A Privy-held key produces a signature Horizon accepts | Privy | [`1fe8822…`](https://stellar.expert/explorer/testnet/tx/1fe8822065555a7c716ba7514908fa899d15a40593984aa7277b0e5811c84c4d) |
| 1 | The `DecoratedSignature` glue is correct independently of Privy | stand-in | [`e477097…`](https://stellar.expert/explorer/testnet/tx/e47709761bf1351e38c4ad5435963c9cca05561e4573b368d5f7ef82f1d3c0c5) |
| 2 | A SAC `transfer` moves the asset and both balances change | stand-in | [`0aece5d…`](https://stellar.expert/explorer/testnet/tx/0aece5d4cc8e9ba92b2ee7790ebc3bd0763df7a2a2dc765b0829abcf8c2e09c5) |

The signer column is not decoration. Only the first row was signed by a Privy
embedded wallet; the other two used a local keypair through the identical
interface, to isolate the Stellar mechanics from Privy's signing service.

### Contributions

Real USDC into the pool through the Stellar Asset Contract, each signed by a
Privy embedded wallet created from an email address. 1 USDC each, from
`GCDAQBYC…` to the interim pool `GCVNURGF…`.

| Transaction | Ledger | Path |
| --- | --- | --- |
| [`3aafb4e…`](https://stellar.expert/explorer/testnet/tx/3aafb4e748643ac67513558bde67cc6bd6e69e6c3465da23f9aa88042d4dec0c) | 4146886 | normal |
| [`925ff0d…`](https://stellar.expert/explorer/testnet/tx/925ff0d9a1e7ab286333c66bbe146ad68245153c9e98b2e424d1e702dc87d5f8) | 4146890 | preflight skipped |
| [`72a58b7…`](https://stellar.expert/explorer/testnet/tx/72a58b756f32280754948594409dd7e2f269c250b49af459dc347116fddd869d) | 4146895 | normal |

The middle one succeeded while preflight was skipped, which is the correct
outcome and the reason the failure demo was rewritten: the donor held a
trustline and enough USDC, so there was nothing for preflight to catch.

## What this deliberately omits

- **Mainnet.** Testnet only, enforced structurally as described above.
- **A backend.** No server, no database, no persistence. Reload and the UI state
  is gone; the chain is the only record.
- **Rust and contract deployment.** The pool contract is consumed as a
  configured address and treated as an interface. It is built and deployed in
  the contract-side repos.
- **Design.** No component library, no state management, no styling system.
  Every pixel here is in service of making the integration legible.
- **Production auth concerns.** No session hardening, rate limiting, MFA policy,
  or account recovery flows beyond what Privy provides by default.
- **Multi-asset support.** One asset, one pool, one path through the app.
- **Retry and resubmission logic** beyond surfacing the error. A real donor flow
  would handle `tx_bad_seq` and `TRY_AGAIN_LATER` with backoff; this one reports
  them.
- **Removing a trustline, or reclaiming the 0.5 XLM reserve.** Adding one is
  the step donors get stuck on, so that is the step this demonstrates.
- **A unit test suite.** The verification scripts hit live testnet and are the
  only tests here. That is a deliberate trade: mocking Horizon and Soroban would
  test the mocks, and the failure modes worth proving are exactly the ones that
  only real network state produces.

## Resources

- Privy — [docs](https://docs.privy.io),
  [chain support tiers](https://docs.privy.io/wallets/overview/chains),
  [tier 2 recipe](https://docs.privy.io/recipes/use-tier-2),
  [raw sign](https://docs.privy.io/wallets/using-wallets/other-chains/raw-sign),
  [client-side wallet creation](https://docs.privy.io/wallets/wallets/create/from-my-client)
- Stellar — [Stellar Asset Contract](https://developers.stellar.org/docs/tokens/stellar-asset-contract),
  [JS SDK](https://stellar.github.io/js-stellar-sdk/),
  [Soroban RPC](https://developers.stellar.org/docs/data/apis/rpc)
- [Stellar Wallets Kit](https://stellarwalletskit.dev) — the fallback signer if
  the Phase 1 decision gate fails
- [Original brief](docs/brief.md)

## License

Apache 2.0 — see the [LICENSE](../../LICENSE) at the repository root.
