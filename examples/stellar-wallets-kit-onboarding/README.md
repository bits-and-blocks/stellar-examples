# stellar-wallets-kit-onboarding

From a wallet the user already has to a funded testnet contribution in one
flow: connect Freighter or xBull through Stellar Wallets Kit, add a USDC
trustline, and send USDC to a pool through the Stellar Asset Contract, with
the key never leaving the extension.

https://stellar-wallets-kit-onboarding.vercel.app/

The same flow, driven by an email address and a custodied embedded wallet
instead, is the sibling example
[`privy-stellar-onboarding`](../privy-stellar-onboarding). The two are worth
reading against each other: see [The other half of this
pair](#the-other-half-of-this-pair).

**Testnet only.** No real money is involved, and no mainnet configuration path
exists; see [Testnet only](#testnet-only).

---

## Requirements

- Node.js 20+
- [Freighter](https://freighter.app) or [xBull](https://xbull.app) installed and
  **switched to Test Net**

No app ID, no API key, no account with anybody. There is nothing to sign up for.

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:3000 and connect your wallet. There is no `.env.local`
step: every variable has a working default, and none of them concerns the
wallet.

The extension must be on **Test Net**. The app checks the wallet's network at
connect time and stops there if it is on Public, rather than asking you to
approve a transaction your wallet cannot make sense of.

The page walks through seven steps and each one tells you what it did:

| # | Step | What happens |
| --- | --- | --- |
| 1 | Your connected wallet | Already done by the time you arrive; the extension brought its own account |
| 2 | Get some faucet XLM | Friendbot funds the account |
| 3 | Check that signing works | An XLM payment to a fixed testnet address, to prove the signature is accepted |
| 4 | Switch on USDC | `changeTrust`, which reserves 0.5 XLM; the switch turns it back off (`limit: "0"`), releasing the reserve. A balance still held is burned to the issuer in the same transaction, since the protocol will not drop a trustline that holds anything |
| 5 | Claim some faucet USDC | Circle's [testnet faucet](https://faucet.circle.com), 20 USDC per 2 hours |
| 6 | Contribute | `transfer` on the Stellar Asset Contract |
| 7 | See what a failure looks like | Two deliberate failures, with and without preflight |

Every step from 2 onwards raises an approval prompt in the extension. That is
the point: the page builds the transaction, and the wallet is the only thing
that can turn it into a signed one.

## Configuration

All configuration is public by design: there is no server, no API route, and
no credential of any kind. Signing happens in the extension.

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_POOL_ADDRESS` | a testnet `G…` address | Where contributions go; accepts a `G…` or a pool contract's `C…` |
| `NEXT_PUBLIC_ASSET_CODE` | `USDC` | Override if Circle's faucet is flaky |
| `NEXT_PUBLIC_ASSET_ISSUER` | Circle's testnet issuer | Override alongside `ASSET_CODE` |

Network settings are deliberately absent from the environment. See
[Testnet only](#testnet-only).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build; takes no secrets and no configuration |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run verify:contribution` | Run the contribution path against live testnet |

---

## How it works

### The Kit is three calls and a modal

Stellar Wallets Kit implements [SEP-43](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0043.md),
the interface every Stellar browser wallet exposes, and puts one picker in
front of all of them. The entire integration is
[`lib/signing/wallets-kit.ts`](lib/signing/wallets-kit.ts):

```ts
await swk.authModal();                 // the picker; returns an address
await swk.getAddress();                // what a previous visit connected
await swk.signTransaction(xdr, { … }); // the approval prompt
```

Two mechanics are worth knowing before you write that file yourself.

**The import has to be dynamic.** The Kit registers the custom elements for its
modal as a side effect of being imported, which needs a DOM, and Next renders
client components on the server before they ever reach a browser. A top-level
`import` of the package breaks the build rather than the page. It is loaded on
first use instead, and initialised exactly once.

**Only the modules you register ship.** `defaultModules()` enables everything
the Kit supports, including WalletConnect, which needs configuration this
example does not have. Freighter and xBull are registered explicitly, and
nothing else is bundled.

There is also one packaging trap. `preact` appears in this project's
`package.json` and nothing here imports it: it is there because the Kit's modal
is built on Preact through `htm`, and npm hoists `htm` to the top of
`node_modules` while leaving `preact` nested under the Kit, so `htm/preact`
cannot resolve it and the build fails with `Can't resolve 'preact'`. Declaring
it hoists it too. Nothing else about it is load-bearing.

### Delegating is not trusting

The wallet is handed XDR and returns XDR. Nothing forces the second to have
anything to do with the first, and three of the ways that can go wrong are
invisible until Horizon rejects the result. `kitSigner` checks all three:

- **A different transaction.** The returned envelope's hash must equal the one
  that was sent. A fee-bump wrapper is refused for the same reason: this app
  does not build them, so one coming back is a wallet doing something that was
  never asked for.
- **A different account.** Freighter signs with whichever account is *active*,
  and that can be switched between connecting and approving. The signature is
  verified against the address the app is using, with
  `Keypair.fromPublicKey(address).verify(…)`.
- **A different network.** Checked once at connect time, because every hash
  here is built against the testnet passphrase. A wallet that will not say
  which network it is on is not treated as evidence of the wrong one.

A declined prompt is not in that list. It is the ordinary path, somebody
deciding not to approve something, and it is reported as such rather than as a
fault.

### The one thing that bites

`signTransaction` returns a **different transaction object** from the one it
was given:

```ts
const signed = await signer.signTransaction(tx);
await horizon.submitTransaction(signed);   // ✅
await horizon.submitTransaction(tx);       // ❌ unsigned, and it looks fine
```

The wallet never sees your `Transaction`; it sees a string. What comes back is
parsed into a new object, and the one you built is still unsigned. This is the
quiet version of the bug, because a signer that mutates in place (a local
`Keypair`, or a raw-hash service like Privy's) makes exactly the same code
work. `scripts/verify-contribution.mts` pins the property explicitly.

### The `Signer` interface

[`lib/signing/signer.ts`](lib/signing/signer.ts) is one method:

```ts
type Signer = {
  readonly address: string;
  signTransaction(tx: Transaction): Promise<Transaction>;
};
```

The level it is drawn at is set by what an extension can do. It will not hash
for you, and it will not let you hash for it, because the key never leaves.
So the interface is transaction in, signed transaction out, and nothing lower
is available. A curve-level signer can always be lifted to this shape; an
extension cannot be pushed down to a lower one.

Everything under `lib/stellar/` takes a `Signer` and has no idea what is behind
it, which is why the same code runs in the browser against Freighter and in a
script against a local key.

### The contribution flow

Holding an asset on Stellar is an explicit act, so contributing is four steps,
not one, and the app shows all four:

1. **Trustline.** `changeTrust` to the USDC issuer. Until this exists the wallet
   cannot receive the asset *at all*: the account has no place to put it.
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
arrival, and with a wallet in the loop it is worse than dead, because the user
approved something and got nothing for it.

**Keep `from` equal to the transaction source.** The SAC calls `require_auth` on
the sending address; when that is also the source account, the ordinary
transaction signature satisfies it. If the two diverge you must sign a
`SorobanAuthorizationEntry` separately, which not every wallet supports.

**Trustlines are asymmetric.** A `G…` recipient needs its own USDC trustline; a
`C…` contract does not, because contract balances live in contract storage.
`preflight` branches on the address prefix, so switching `NEXT_PUBLIC_POOL_ADDRESS`
between the two needs no code change.

### Failure modes

Simulation catches most of these, but only as an opaque host error. Reading
state directly means the user is told which account is short and by how much.
[`lib/stellar/errors.ts`](lib/stellar/errors.ts) models four outcomes:

| Outcome | Detected by | What the user is told |
| --- | --- | --- |
| `missing-trustline` | preflight, per account | which account, and that a `C…` address would not need one |
| `insufficient-balance` | preflight | held versus requested |
| `simulation-failed` | Soroban simulation | the host error, and that it cost no fee |
| `submission-failed` | send / poll | that signing worked and the network did not accept it |

`SigningError` is kept apart from all four. Those classify what the *network*
refused; a `SigningError` is about the wallet: a prompt declined, an account
switched underneath, a signature that is not the shape it must be.

Step 7 has two buttons that send the same impossible contribution (999999 USDC)
and differ only in whether preflight runs, so you can see both shapes of error.
Note that `skipPreflight` does not *induce* a failure; it removes an early
check, and a contribution that would have succeeded still succeeds without it.

## The other half of this pair

[`privy-stellar-onboarding`](../privy-stellar-onboarding) runs the identical
walkthrough against an embedded wallet created from an email address. The two
examples share their `lib/stellar/` and their UI almost exactly; what differs
is who holds the key.

| | This example | `privy-stellar-onboarding` |
| --- | --- | --- |
| Holds the key | The extension; nothing here ever sees it | Privy, custodied |
| Signing API accepts | A transaction, as XDR | 32 bytes |
| …and returns | Signed XDR, as a new transaction | 64 raw bytes, attached in place |
| Who approves | The user, in the extension, every time | Nobody; it signs on request |
| Configuration | None | A Privy app ID, and an allowed-origins list |
| Step 1 | Already done; the wallet brought an account | Create the embedded wallet |
| Onboarding cost to the user | Install an extension, fund an account | An email address |

Which one you want is a product question, not a technical one. This one asks
more of the user up front and gives them custody; the other asks for an email
address and takes custody on their behalf.

If you want *both* in one app, note that the interface to draw them behind is
this example's `Signer`, the higher of the two levels. Drawn at `signHash`,
the Kit could not implement it at all.

## Testnet only

The network passphrase, Horizon URL, Soroban RPC URL and Friendbot URL are
literals in [`lib/stellar/network.ts`](lib/stellar/network.ts). None is read
from the environment, so no `.env` file, build flag or deployment setting can
point this app at mainnet; changing networks requires editing that file.

The passphrase is load-bearing rather than cosmetic: it is mixed into the
payload that `Transaction.hash()` produces, so a transaction built here is only
ever valid on testnet. Submitted to mainnet it would be rejected as
`tx_bad_auth` rather than succeeding against real funds.

Your wallet's network is the one thing here that is not ours to pin, so it is
checked instead, at connect time, once, before anything asks for a signature.

## Project structure

```
app/                    Next.js App Router: one page, one providers file
components/             Presentational components, no styling system
lib/
  signing/
    signer.ts           The Signer interface
    wallets-kit.ts      Delegates to the extension, verifies the result
  wallet/
    session.ts          useSession(): what the page consumes
    kit-session.tsx     Connect, restore, disconnect
  stellar/
    network.ts          Testnet literals: the only network config
    assets.ts           USDC, SAC derivation, stroop conversion
    contribute.ts       preflight + transfer
    errors.ts           The four failure outcomes
    horizon.ts          Account and balance reads
  ui/                   Activity log, sent lists, local state
scripts/
  verify-contribution.mts
  local-signer.ts       A Signer with a local key, for the script above
```

## Verifying against live testnet

```bash
npm run verify:contribution
```

[`scripts/verify-contribution.mts`](scripts/verify-contribution.mts) runs the
real `contribute`, `addTrustline` and `preflight` against testnet, driven by a
local keypair rather than an extension: there is no headless Freighter, and no
way to script an approval prompt.

So what it covers is the contribution path, which is most of the app, plus the
one Kit-shaped property that survives without a wallet: `signTransaction`
returns a new transaction, and the argument is left unsigned. What it does not
cover is the wallet itself: the approval, and the three checks in `kitSigner`
that only a misbehaving extension could trigger.

```
✅ missing trustline (donor)
✅ missing trustline surfaces from Soroban when preflight is skipped
✅ changeTrust signed by the stand-in signer
✅ insufficient balance — you have 0, this would send 5
✅ missing trustline (recipient)
✅ SAC transfer accepted
✅ donor debited — balance 75.0000000
✅ pool credited — balance 25.0000000
✅ the signed transaction is a different object
✅ and the argument was left unsigned
```

It generates its own keypairs and needs no configuration. It uses a throwaway
issuer rather than Circle's USDC because the success case needs to mint itself
a supply and Circle's faucet is captcha-gated; the SAC is generated per-asset
by the protocol and is the same contract either way.

It is not part of CI: it spends real testnet ledger time and depends on
Friendbot being up, so a network hiccup would show as a broken build.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| The picker opens and lists nothing | Neither Freighter nor xBull is installed, or the extension is disabled for this site |
| Connecting is refused straight away | The extension is on Public; switch it to Test Net |
| "Your wallet signed with a different account" | The active account was switched in the extension after connecting. Switch back, or disconnect and reconnect |
| A prompt never appears | Some extensions open their approval in a popup the browser suppressed; check for a blocked-popup indicator |
| Friendbot funding fails | Friendbot rate-limits per address; wait, or use an already-funded account |
| Step 5 gives you nothing | Circle's faucet allows 20 USDC per address per 2 hours |
| A contribution fails with a trustline error | Step 4 was skipped, or the `G…` recipient has no trustline of its own |

## Not included

- **Mainnet.** Testnet only, enforced structurally.
- **A backend.** No server, no database. The activity log and sent lists survive
  a reload in `localStorage`, but nothing reads them as truth: the chain is the
  only record, and every entry links out to it.
- **Wallets beyond Freighter and xBull.** The Kit ships modules for many more,
  including WalletConnect, Ledger and Trezor. Registering them is a one-line
  change each; configuring WalletConnect is not, which is why the default set
  is not used.
- **Rust and contract deployment.** The pool contract is consumed as a
  configured address and treated as an interface.
- **A design system.** No component library, no state management library.
- **Multi-asset support.** One asset, one pool, one path through the app.
- **Soroban auth entries.** Every signature here is a transaction signature.
  Signing a `SorobanAuthorizationEntry` separately, which you need the moment
  the SAC's `from` is not the transaction source, is a different call, and not
  every wallet supports it.
- **Retry and resubmission logic** beyond surfacing the error. A production flow
  would handle `tx_bad_seq` and `TRY_AGAIN_LATER` with backoff.
- **A unit test suite.** The verification script hits live testnet and is the
  only test here; mocking Horizon and Soroban would test the mocks.

## Resources

- **Stellar Wallets Kit**: [docs](https://stellarwalletskit.dev) ·
  [GitHub](https://github.com/Creit-Tech/Stellar-Wallets-Kit) ·
  [npm](https://www.npmjs.com/package/@creit.tech/stellar-wallets-kit)
- [SEP-43](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0043.md):
  the wallet interface the Kit's modules implement, and the reason
  `signTransaction` takes the shape it does
- **Wallets**: [Freighter](https://freighter.app) · [xBull](https://xbull.app)
- **Stellar**: [Stellar Asset Contract](https://developers.stellar.org/docs/tokens/stellar-asset-contract) ·
  [JS SDK](https://stellar.github.io/js-stellar-sdk/) ·
  [Soroban RPC](https://developers.stellar.org/docs/data/apis/rpc)
