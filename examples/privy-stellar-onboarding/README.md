# privy-stellar-onboarding

Email login to a funded testnet contribution in one flow: a [Privy](https://www.privy.io) embedded wallet is created from an email address, then test USDC moves into a pool via the Stellar Asset Contract — with transfer results checked rather than assumed.

The point is to show that a user with no wallet, no extension, and no seed phrase can complete an on-chain contribution, and that the failure modes along the way are surfaced honestly.

> **Status: spike complete, app not yet built.** The open question this README used to carry is answered below and verified against live testnet. The application lands next; setup commands arrive with it.

## What it will demonstrate

1. **Email login → embedded wallet.** Privy creates the wallet; the Stellar address is displayed. No seed phrase is ever shown to the user.
2. **Funding.** The new address is funded with XLM via friendbot.
3. **Trustline.** A `changeTrust` operation to testnet USDC. Without it the wallet cannot receive the asset at all — this is the failure mode most onboarding demos quietly skip, so it gets explicit handling.
4. **Contribution.** A transfer through the Stellar Asset Contract into a pool contract address, supplied as config.
5. **Checked results.** Distinct, visible handling for missing trustline, insufficient balance, and submission failure, including at least one deliberate failing case.

## Which shape Privy's Stellar support takes

This README previously asked whether Privy provides first-class Stellar embedded
wallets, or only raw ed25519 signing with this app building and submitting the
XDR itself.

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
in the browser, so this example will have no API routes, no backend, and no
`PRIVY_APP_SECRET`. The only environment variable is `NEXT_PUBLIC_PRIVY_APP_ID`,
which is a public identifier by design — Privy scopes it with a dashboard
allowed-origins list. "No secrets in history" is structural here, not a policy
anyone has to enforce.

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

That is the whole Privy-specific surface area. Everything else will be ordinary
`@stellar/stellar-sdk` usage that would look the same behind any signer — which
is also what makes a later swap to [Stellar Wallets
Kit](https://stellarwalletskit.dev) cheap: it would replace these lines and
nothing else.

**Tier 2 wallets do not appear in `useWallets()`.** That hook covers EVM only.
The Stellar wallet lives in `user.linkedAccounts`, discriminated by `chainType`.
This costs about twenty minutes to discover and is worth writing down.

### How this was verified

Two transactions on testnet, both accepted:

| What it proves | Signer | Transaction |
| --- | --- | --- |
| A Privy-held key produces a signature Horizon accepts | Privy embedded wallet | [`1fe8822…`](https://stellar.expert/explorer/testnet/tx/1fe8822065555a7c716ba7514908fa899d15a40593984aa7277b0e5811c84c4d) |
| The `DecoratedSignature` glue is correct independently of Privy | local stand-in keypair | [`e477097…`](https://stellar.expert/explorer/testnet/tx/e47709761bf1351e38c4ad5435963c9cca05561e4573b368d5f7ef82f1d3c0c5) |

The second row is the one that made debugging tractable: with the glue
confirmed against a local `Keypair` through the identical interface — 32-byte
hash in, 64-byte signature out — any failure in the real flow could only be
Privy or the app wiring, never the signature construction.

**A note on how this was verified, because the task asked for a standalone
script.** `useCreateWallet` and `useSignRawHash` are React hooks from
`@privy-io/react-auth/extended-chains`, so they are reachable only from the
browser. A Node script cannot call them without going through Privy's server
auth API, which would reintroduce the `PRIVY_APP_SECRET` this example
specifically does not need. The Privy-signed transaction above was therefore
produced from a minimal browser page rather than a CLI script. The substance of
the check is unchanged; the form is not what the task description assumed.

## Planned stack

Next.js with TypeScript. No state library, no design system — this example proves an integration, not frontend taste.

## What it deliberately omits

- **Mainnet.** Testnet only. The network passphrase and every endpoint URL will be literals in code rather than environment reads, so no `.env` file, build flag or deployment setting can point this at mainnet.
- **No contract source.** The pool contract is consumed as an address from config; it is an interface this example calls, not code it ships.
- **No backend.** No server, no database, no persistence — the chain is the only record.
- **No production auth, error reporting, or persistence.** Session handling is whatever Privy gives out of the box.

## Resources

- Privy — [privy.io](https://www.privy.io) · [docs](https://docs.privy.io) ·
  [chain support tiers](https://docs.privy.io/wallets/overview/chains) ·
  [tier 2 recipe](https://docs.privy.io/recipes/use-tier-2) ·
  [raw sign](https://docs.privy.io/wallets/using-wallets/other-chains/raw-sign) ·
  [client-side wallet creation](https://docs.privy.io/wallets/wallets/create/from-my-client)
- Stellar — [Stellar Asset Contract](https://developers.stellar.org/docs/tokens/stellar-asset-contract) ·
  [JS SDK](https://stellar.github.io/js-stellar-sdk/) ·
  [Soroban RPC](https://developers.stellar.org/docs/data/apis/rpc)
- [Stellar Wallets Kit](https://stellarwalletskit.dev) — the alternative signer

## License

Apache 2.0 — see the [LICENSE](../../LICENSE) at the repository root.
