# privy-stellar-onboarding

Email login to funded testnet contribution in one flow: Privy embedded wallet,
then test USDC into a pool via the Stellar Asset Contract with transfer results
checked. The commit history is the integration timer.

**Status: wallet and signing working.** Email login to a signed, confirmed
testnet transaction from a Privy embedded wallet, with no seed phrase at any
point. Measured at **15 minutes 8 seconds** — see
[Integration timer](#integration-timer). The trustline and contribution flow
land next.

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

| Phase | What it proves | Transaction |
| --- | --- | --- |
| 1 | A Privy-held key produces a signature Horizon accepts | [`1fe8822…`](https://stellar.expert/explorer/testnet/tx/1fe8822065555a7c716ba7514908fa899d15a40593984aa7277b0e5811c84c4d) |

_Phase 2 contribution hashes will be added here._

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
