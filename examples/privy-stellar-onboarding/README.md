# privy-stellar-onboarding

Email login to a funded testnet contribution in one flow: a [Privy](https://www.privy.io) embedded wallet is created from an email address, then test USDC moves into a pool via the Stellar Asset Contract — with transfer results checked rather than assumed.

The point is to show that a user with no wallet, no extension, and no seed phrase can complete an on-chain contribution, and that the failure modes along the way are surfaced honestly.

> **Status: spec.** This example is written up but not built yet. The sections below describe the intended shape; setup commands land with the implementation.

## What it will demonstrate

1. **Email login → embedded wallet.** Privy creates the wallet; the Stellar address is displayed. No seed phrase is ever shown to the user.
2. **Funding.** The new address is funded with XLM via friendbot.
3. **Trustline.** A `changeTrust` operation to testnet USDC. Without it the wallet cannot receive the asset at all — this is the failure mode most onboarding demos quietly skip, so it gets explicit handling.
4. **Contribution.** A transfer through the Stellar Asset Contract into a pool contract address, supplied as config.
5. **Checked results.** Distinct, visible handling for missing trustline, insufficient balance, and submission failure, including at least one deliberate failing case.

An open question to resolve against Privy's Stellar docs before writing code: whether their support is first-class Stellar embedded wallets, or raw ed25519 signing where this app builds and submits the XDR itself with `@stellar/stellar-sdk`. The answer belongs in this README.

## Planned stack

Plain Next.js or Vite with TypeScript. No state library, no design system — this example proves an integration, not frontend taste.

## What it deliberately omits

- **Testnet only.** The network passphrase is pinned to testnet in code so it cannot be pointed at mainnet by accident.
- **No contract source.** The pool contract is consumed as an address from config; it is an interface this example calls, not code it ships.
- **No production auth, error reporting, or persistence.** Session handling is whatever Privy gives out of the box.

## Resources

- Privy — [privy.io](https://www.privy.io) · [docs](https://docs.privy.io)
- Stellar Wallets Kit — [stellarwalletskit.dev](https://stellarwalletskit.dev)
- Stellar Asset Contract — [developers.stellar.org](https://developers.stellar.org/docs/tokens/stellar-asset-contract)

## License

Apache 2.0 — see the [LICENSE](../../LICENSE) at the repository root.
