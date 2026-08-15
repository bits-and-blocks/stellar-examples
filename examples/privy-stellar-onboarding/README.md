# privy-stellar-onboarding

Email login to funded testnet contribution in one flow: Privy embedded wallet,
then test USDC into a pool via the Stellar Asset Contract with transfer results
checked. The commit history is the integration timer.

**Status: Phase 0 complete.** Scaffold, testnet-only network config, and green
CI. No wallet integration yet — see [Integration timer](#integration-timer).

## The claim this validates

> A first-time donor can go from an email address to a completed on-chain
> contribution without ever seeing a seed phrase, and a competent developer can
> wire that up in under a day.

The second half is the part that is easy to assert and hard to prove, so this
repo measures it. The commit history is the instrument: the elapsed time between
the commit titled `integration start` and the commit titled
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

That is the whole Privy-specific surface area. Everything else in this repo is
ordinary `@stellar/stellar-sdk` usage that would look the same behind any
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
pnpm install
cp .env.example .env.local   # fill in NEXT_PUBLIC_PRIVY_APP_ID
pnpm dev
```

CI runs `pnpm lint`, `pnpm typecheck` and `pnpm build` on every push and pull
request. The build takes no secrets.

## Integration timer

| | Commit | Timestamp |
| --- | --- | --- |
| Start | `integration start` | _pending Phase 1_ |
| End | `first signed testnet tx` | _pending Phase 1_ |
| **Elapsed** | | _pending Phase 1_ |

For the measurement to mean anything, the baseline has to be stated. Everything
committed before `integration start` is setup that is not specific to Privy: the
Next.js scaffold, CI, and this document. No chain or wallet dependency is
installed before the timer starts — `@privy-io/react-auth` and
`@stellar/stellar-sdk` both arrive in the `integration start` commit — so the
elapsed time covers the real work, including the signature glue above.

## Contribution transactions

_Pending Phase 2._ Successful contribution hashes will be listed here as
stellar.expert links.

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

Apache 2.0 — see [LICENSE](LICENSE).
