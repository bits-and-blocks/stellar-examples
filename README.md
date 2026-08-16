# stellar-examples

Runnable Stellar demos and integration examples from [bits-and-blocks](https://github.com/bits-and-blocks).

Each example is a **self-contained project** — its own dependencies, its own README, its own lockfile. Clone the repo and run one, or copy a single directory out and use it as a starting point. Nothing is shared between examples except the license and CI.

> This is not [`stellar/soroban-examples`](https://github.com/stellar/soroban-examples), the Stellar Development Foundation's canonical Rust smart contract samples. Start there for contract primitives. This repo covers integration-level demos: wallets, onboarding, payments, and the surrounding application plumbing.

## Examples

| Example | What it demonstrates | Stack | Status |
| --- | --- | --- | --- |
| [soroban-reproducible-build](examples/soroban-reproducible-build) | Proves a deployed contract's Wasm was built from the source it claims — rebuilt in a digest-pinned container and compared against the `contract_code` ledger entry, asserted in CI. | Rust, `soroban-sdk`, Docker, `@stellar/stellar-sdk` | Working |
| [privy-stellar-onboarding](examples/privy-stellar-onboarding) | Email login to a funded testnet contribution in one flow — Privy embedded wallet, then test USDC into a pool via the Stellar Asset Contract, with transfer results checked rather than assumed. | Next.js, TypeScript, Privy, `@stellar/stellar-sdk` | Working |

Status legend: **Spec** — written up, not yet built · **Building** · **Working** — runs against testnet

## Running an example

```bash
git clone https://github.com/bits-and-blocks/stellar-examples.git
cd stellar-examples/examples/<example-name>
# then follow that example's README
```

Every example targets **testnet only**. Network passphrases are pinned to testnet in code so an example cannot accidentally be pointed at mainnet, and no example should ever ask for a mainnet secret key.

## License

Apache 2.0 — see [LICENSE](LICENSE). Individual examples may carry their own LICENSE file where they were imported from a standalone repo; those take precedence for that directory.
