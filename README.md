# stellar-examples

Runnable Stellar demos and integration examples.

Each example is a self-contained project. Clone the repo and run one, or copy a single directory out and use it as a starting point. Nothing is shared between examples except the license and CI.

## Examples

| Example | What it demonstrates | Stack | Demo | Status |
| --- | --- | --- | --- | --- |
| [soroban-reproducible-build](examples/soroban-reproducible-build) | Proves a deployed contract's Wasm was built from the source it claims, with SEP-58 build metadata embedded at build time, plus a verifier that takes any contract id, replays the recorded build, and refuses the cases it should. | Rust, `soroban-sdk`, Docker, SEP-58, `@stellar/stellar-sdk` | [Video](https://github.com/user-attachments/assets/f82e5cd2-3b02-4d83-b2d8-64b5fdaccc51) | Working |
| [privy-stellar-onboarding](examples/privy-stellar-onboarding) | Email login to a funded testnet contribution in one flow: a Privy embedded wallet, then test USDC into a pool via the Stellar Asset Contract, with transfer results checked rather than assumed. | Next.js, TypeScript, Privy, `@stellar/stellar-sdk` | [Live](https://privy-stellar-onboarding.vercel.app/) | Working |
| [stellar-wallets-kit-onboarding](examples/stellar-wallets-kit-onboarding) | The same walkthrough for a wallet the user already has: Freighter or xBull via Stellar Wallets Kit, with the returned signature checked against the transaction, the account and the network before it is submitted. | Next.js, TypeScript, Stellar Wallets Kit, `@stellar/stellar-sdk` | [Live](https://stellar-wallets-kit-onboarding.vercel.app/) | Working |
| [stellar-trace](examples/stellar-trace) | Paste a testnet transaction hash and see the state progression the network recorded for it, every ledger entry it touched, before and after, backed by a resumable `getEvents` indexer, a decoder registry that checks the asset an event claims, and a committed capture of testnet the whole thing runs from with no network at all. | TypeScript, Node, SQLite, `node:http`, `@stellar/stellar-sdk` | [Live](https://stellar-trace-app.vercel.app/) | Building |
| [soroban-ci](examples/soroban-ci) | Formatting, lints, unit tests and a release Wasm build for every Soroban contract here, listing its targets rather than discovering them, after a `find` that silently matched nothing left both contracts unbuilt in CI. | GitHub Actions, Rust, `cargo`, `clippy` | None | Building |
| [soroban-attestation-gate](examples/soroban-attestation-gate) | Funds leave a pool only against a quorum-signed attestation, with recipient, asset, category, amount, sequence, expiry ledger, pool and network id all inside the XDR the authority keys sign, so an approval cannot be replayed, redirected, or reused across assets, deployments or networks. | Rust, `soroban-sdk`, ed25519, Stellar Asset Contract | None yet | Building |

Status legend: **Spec**, written up, not yet built · **Building** · **Working**, runs against testnet

## Running an example

```bash
git clone https://github.com/bits-and-blocks/stellar-examples.git
cd stellar-examples/examples/<example-name>
# then follow that example's README
```

Every example targets testnet only. Network passphrases are pinned to testnet in code so an example cannot accidentally be pointed at mainnet, and no example should ever ask for a mainnet secret key.

## License

Apache 2.0, see [LICENSE](LICENSE).
