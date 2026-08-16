# Task backlog

Twelve tasks across three independent tracks. Each is sized at **1–2 days**. Every task has a branch already cut; pick one, and work only on that branch.

## How to pick

- **Tracks A, B, C are independent.** Any number of people can work on different tracks at the same time with no coordination.
- **Within a track, tasks are sequential.** B5 renders what B2 produces; C2 builds on C1's app.
- **Cut your branch fresh from its predecessor when you start it**, not from where it currently sits. All twelve branches were created off `main` at the same commit, so a within-track branch is stale the moment its predecessor merges:

  ```bash
  git checkout trace/tx-meta-decode
  git rebase trace/ingest-loop   # or: git reset --hard trace/ingest-loop, if you haven't started
  ```

- **Start with A1, B1, or C0.** Those are the three track heads.

## Ground rules for every task

- **Testnet only.** Network passphrase pinned in code. No mainnet secret key ever appears in this repo.
- **One example per directory**, self-contained, own lockfile, own README. Nothing shared but the license and CI.
- **A task is done when someone else can run it** from the README without asking you a question.
- CI discovers examples automatically — adding a `package.json` or `Cargo.toml` under `examples/<name>/` puts it in the build matrix.

---

# Track A — `soroban-reproducible-build`

Proves a deployed contract's Wasm was built from the source it claims. Needs nothing from our own contract work. Two tasks, highest signal per hour of anything in this backlog.

The thing to understand before starting: **[SEP-0058](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0058.md)** is a live draft standard (v0.6.0, updated July 2026) covering exactly this. It defines metadata embedded in the contract's `contractmetav0` section — `bldimg` (container image pinned by digest), `bldopt`, `bldarg`, `source_sha256`, `source_uri` — plus the verifier workflow. Build to that vocabulary. Conformance to a draft SEP is the point of this track, not a bonus.

### A1 — Deploy a subject contract and assert the hash in CI

**Branch:** `repro/deploy-and-hash-check` · **Depends on:** nothing

Deploy a small contract to testnet from a digest-pinned `stellar/stellar-cli` container. Add a CI job that rebuilds from source in the same pinned image and asserts the resulting Wasm hash equals the hash in the deployed contract's `contract_code` ledger entry.

**Deploy the subject yourself.** Do not try to reproduce someone else's deployed contract — reproducing `stellar/soroban-examples` means guessing the toolchain that built it, and that is how this becomes a three-day task instead of a one-day task. We control the subject, so we control the toolchain.

**In scope:** one contract, one pinned image digest, one CI job, a README explaining what the job proves.
**Out of scope:** SEP-58 metadata (that's A2), verifying arbitrary third-party contracts, mainnet.

**Done when:** CI is green on a PR, and changing one byte of the contract source turns it red.

**Resources**
- [Stellar CLI manual](https://developers.stellar.org/docs/tools/cli/stellar-cli) · [contract lifecycle cookbook](https://developers.stellar.org/docs/tools/cli/cookbook/contract-lifecycle)
- [Contract source verification using Docker without attestation](https://github.com/orgs/stellar/discussions/1923) — the design discussion behind SEP-58
- [`stellar/soroban-examples`](https://github.com/stellar/soroban-examples) — fine as a *source* to copy a contract from; just deploy it ourselves
- [getLedgerEntries](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getLedgerEntries) — how to read the deployed `contract_code` entry

### A2 — SEP-58 metadata and a general verifier

**Branch:** `repro/sep58-meta-verifier` · **Depends on:** A1

Add the SEP-58 `--meta` fields at build time, then write `verify.sh` that takes *any* contract ID, reads its build metadata off-chain, replays the recorded Docker invocation against the recorded source archive, and compares hashes.

The verifier must handle the negative cases gracefully: contract has no build meta, source archive doesn't match `source_sha256`, rebuild produces a different hash. Each gets a distinct, readable message. A verifier that only prints "OK" on our own contract proves nothing.

**In scope:** `--meta` in the build, `verify.sh`, the three failure paths, README documenting which SEP-58 version we target.
**Out of scope:** a hosted verification service, a UI, attestation/signing schemes.

**Done when:** `./verify.sh <contract-id>` passes on ours, and returns a clear "no build metadata" on a contract that lacks it.

**Resources**
- [SEP-0058](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0058.md) — read this first, it is the spec for the whole task
- [Add meta during `stellar contract build` (stellar-cli#1605)](https://github.com/stellar/stellar-cli/issues/1605) — `--meta key=val` usage and intent
- [Contract source validation SEP discussion](https://github.com/orgs/stellar/discussions/1573)

---

# Track B — `stellar-trace`

An indexer over ledger events plus a proof view: paste a transaction hash, see the reconstructed state progression with the ledger entry behind each step. Built against Stellar Asset Contract transfer events on testnet now, repointed at our own contract's events later.

Longest track and the critical path. Six tasks.

**Three constraints that shape the whole design — read before writing code:**

1. **RPC retains ~7 days of events** (120,960 ledgers by default), and `getEvents` scans at most 10,000 ledgers per request. There is no historical event backfill from RPC. Our own database *is* the history. The UI must be honest about its start ledger rather than implying it can reach arbitrary history.
2. **Events are not ledger entries.** `getLedgerEntries` returns *current* state only — there is no historical ledger-entry fetch. "The ledger entry behind each step" comes from decoding `resultMetaXdr` on `getTransaction`, which carries before/after `LedgerEntryChanges`. That is the real artifact and the more impressive one.
3. **CAP-67 changed event shapes** in Protocol 23, and classic operations now emit token events too. Write against current docs, not older examples. Also check whether the RPC endpoint we point at has `EMIT_CLASSIC_EVENTS` enabled — don't assume.

### B1 — Ingest loop

**Branch:** `trace/ingest-loop` · **Depends on:** nothing

Poll `getEvents` from a configured start ledger, persist a cursor, write raw events into SQLite. Respect the 10,000-ledger scan cap by paging. Store events raw and undecoded — decoding is B3's job, and keeping the raw bytes means a decoder bug never costs us a re-ingest.

**In scope:** the loop, cursor persistence, paging, a `--start-ledger` flag, structured logs.
**Out of scope:** decoding, any UI, any DB other than SQLite.

**Done when:** kill it mid-run and restart — no gap, no duplicates.

**Resources**
- [Ingest events published from a contract](https://developers.stellar.org/docs/build/guides/events/ingest) — the closest thing to an official walkthrough
- [getEvents](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getEvents) · [RPC: now with infinite scroll](https://stellar.org/blog/developers/rpc-now-with-infinite-scroll) — paging and the scan cap
- [Reconciling Stellar events](https://stellar.org/blog/developers/reconciling-stellar-events) — the gotchas we'd otherwise hit ourselves

### B2 — Transaction meta to ledger entry diffs

**Branch:** `trace/tx-meta-decode` · **Depends on:** B1 (loosely — can start in parallel, it reads a different endpoint)

CLI: `trace <tx-hash>` fetches the transaction, decodes `resultMetaXdr`, and prints the `LedgerEntryChanges` — entry key, before state, after state — for each step.

**Do this early even though it's second.** It is the claim most likely to overreach, so we want to know it holds while there's still room to reframe. If historical entry state turns out not to be reachable the way we expect, that changes what the proof view can promise, and it's much cheaper to learn now than after the UI is built.

**In scope:** hash to decoded state diff, on the CLI, for SAC transfers.
**Out of scope:** UI, storage, non-SAC contracts.

**Done when:** a real testnet SAC transfer prints both balance entries changing, before and after values legible.

**Resources**
- [getTransaction](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getTransaction) — `resultMetaXdr` lives here
- [RPC data formats](https://developers.stellar.org/docs/data/apis/rpc/api-reference/structure/data-format) — request JSON output instead of base64 XDR while developing, it's far easier to read
- [`@stellar/stellar-sdk` docs](https://stellar.github.io/js-stellar-sdk/) — XDR decoding

### B3 — Decoder registry

**Branch:** `trace/decoder-registry` · **Depends on:** B1

A registry keyed on `(contract_id, topic[0])` mapping to a decoder function. Register SAC `transfer`, `mint`, and `burn` as the first entries.

This is the task that makes the eventual repoint cheap. **If SAC topic shapes get hardcoded into the ingest or query path, swapping to our own contract's events later is a rewrite, not a config change.** Adding a decoder must touch the registry and nothing else. Enforce that with the B6 stub later.

**In scope:** registry, SAC decoders, XDR fixtures checked into the repo, unit tests.
**Out of scope:** decoders for contracts we don't yet have.

**Done when:** tests pass against checked-in fixtures, and adding a decoder requires touching no file outside the registry.

**Resources**
- [CAP-0067](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0067.md) — authoritative event format; the transfer topic order is `from`, then `to`, with the asset in an optional 4th topic
- [Token Transfer Processor](https://developers.stellar.org/docs/data/indexers/build-your-own/processors/token-transfer-processor) — SDF's own Go implementation of these exact semantics ([source](https://github.com/stellar/go-stellar-sdk/tree/main/processors/token_transfer)). It's Go and we're not, but it's the reference for *what the events mean*
- [Classic ops emit transfer/mint/burn/clawback events](https://github.com/orgs/stellar/discussions/1553)
- [Token-event helper request (js-stellar-sdk#1554)](https://github.com/stellar/js-stellar-sdk/issues/1554) — note the JS SDK has no helper yet, so we hand-roll this

### B4 — Fixture capture and offline replay

**Branch:** `trace/fixture-replay` · **Depends on:** B1, B2

A script that snapshots a real testnet ledger range — events and the matching transaction meta — into JSON committed to the repo, and a flag that runs the entire stack against those fixtures with no network.

**This is what makes the demo trustworthy.** Someone opens the link at an arbitrary hour. If the page needs live testnet plus a running indexer, a bad day shows them an error. One day of work removes that entire class of risk.

**In scope:** capture script, fixture files, `--offline` (or equivalent) wiring through ingest and trace.
**Out of scope:** mocking RPC at the HTTP layer — capture real responses instead.

**Done when:** `npm run demo` renders a full trace with the network unplugged.

### B5 — Proof view

**Branch:** `trace/proof-view` · **Depends on:** B2, B3, B4

The page. Paste a transaction hash, get the reconstructed state progression, each step showing the ledger entry behind it. Mostly rendering what B2 already produces.

Be explicit in the UI about the indexer's start ledger and the ~7-day RPC window. A hash outside our range gets an honest "outside the indexed range, which starts at ledger N", never a blank result or a spinner.

**In scope:** one page, paste-a-hash, rendered progression, honest empty and out-of-range states.
**Out of scope:** auth, search, pagination, charts, design system.

**Done when:** someone with only the URL and a testnet transaction hash gets a rendered trace.

### B6 — Repoint stub

**Branch:** `trace/repoint-stub` · **Depends on:** B3 · **~0.5 day**

Register a decoder for a non-SAC contract event and document the repoint. The point is the diff: it should touch only the registry. If it touches anything else, that's a B3 bug worth fixing now rather than discovering it under time pressure later.

**Done when:** the second decoder lands in a diff confined to the registry, and the README explains the swap in a paragraph.

---

# Track C — `privy-stellar-onboarding`

Email login to a funded testnet contribution in one flow. **The directory currently contains a README and no code** — `examples/privy-stellar-onboarding/` is a spec. Building the app is the work here; the second wallet mode is a small addition at the end.

**The open question in that README is now answered** — see C0. Read it before starting anything in this track, because it determines the shape of C1 through C3.

### C0 — Confirm Privy's Stellar support and write it up

**Branch:** `privy/spike-stellar-support` · **Depends on:** nothing · **~0.5 day**

Privy classifies Stellar as a **Tier 2 chain: wallet abstractions and curve-level signing, not a native Stellar API.** Concretely:

- Privy creates and custodies an Ed25519 key and gives us the Stellar address.
- **We build the transaction ourselves** with `@stellar/stellar-sdk`.
- We hash it, call Privy's **`rawSign`** on that hash — raw sign signs the provided hash directly with no extra byte manipulation — and get back a signature.
- We attach the signature ourselves as a `DecoratedSignature` (with the correct key hint) and submit.

This task is to confirm that end to end with a throwaway script and write the answer into the example's README, replacing the open question that's currently sitting there.

**The fiddly part is signature attachment.** Building a `DecoratedSignature` by hand with the right hint is where this usually goes wrong. Verify with `Keypair.fromPublicKey(address).verify(hash, signature)` before submitting anything to the network — Privy's own example does exactly that.

**Done when:** a script signs a testnet transaction via Privy `rawSign` and the network accepts it, and the README's open question is replaced by the answer with links.

**Resources**
- [Privy Tier 2 chains recipe](https://docs.privy.io/recipes/use-tier-2) — the Stellar section; this is the primary source
- [Privy chain support tiers](https://docs.privy.io/wallets/overview/chains) · [embedded wallets overview](https://docs.privy.io/wallets/overview/embedded)
- [`@stellar/stellar-sdk`](https://stellar.github.io/js-stellar-sdk/) — `Keypair`, `TransactionBuilder`, `DecoratedSignature`

### C1 — Email login, wallet, funding

**Branch:** `privy/login-fund` · **Depends on:** C0

Next.js app: email login creates the Privy embedded wallet, we display the Stellar address, friendbot funds it with XLM. No seed phrase is ever shown.

**In scope:** the app skeleton, Privy auth, address display, friendbot funding, a README that actually runs.
**Out of scope:** trustlines and transfers (C2), the second wallet mode (C3), production auth, persistence, design.

**Done when:** a fresh email address reaches a funded testnet account in the browser, with the address visible.

**Resources**
- [Privy docs](https://docs.privy.io) · [Tier 2 recipe](https://docs.privy.io/recipes/use-tier-2)
- [Testnet and friendbot](https://developers.stellar.org/docs/learn/fundamentals/networks)

### C2 — Trustline and SAC transfer with checked results

**Branch:** `privy/trustline-transfer` · **Depends on:** C1

A `changeTrust` to testnet USDC, then a transfer into the pool contract address via the Stellar Asset Contract. Distinct, visible handling for missing trustline, insufficient balance, and submission failure.

**The failure cases are the deliverable, not a nice-to-have.** Every onboarding demo shows the happy path; the missing trustline is the exact failure most of them quietly skip. At least one failing case must be reachable on demand so a reviewer can watch it fail honestly.

**In scope:** trustline, SAC transfer, three distinct error states, one deliberately triggerable failure.
**Out of scope:** contract source — the pool is an address from config, an interface we call, not code we ship.

**Done when:** all three failure paths are reachable on demand, and the happy path lands a transfer on testnet.

**Resources**
- [Stellar Asset Contract](https://developers.stellar.org/docs/tokens/stellar-asset-contract) · [token interface](https://developers.stellar.org/docs/tokens/token-interface)
- [Anatomy of an asset](https://developers.stellar.org/docs/tokens/anatomy-of-an-asset) — trustline semantics

### C3 — Signer interface and Stellar Wallets Kit

**Branch:** `privy/signer-wallets-kit` · **Depends on:** C2

Extract a `Signer` interface, keep Privy as one implementation, add Stellar Wallets Kit as the second, then split the two apart into `examples/privy-stellar-onboarding` and `examples/stellar-wallets-kit-onboarding`.

**The interface is the artifact, and the two sides sit at different levels — that's the whole design problem.** Privy is "give me a hash, get a signature back." Wallets Kit is "give me an XDR, the user approves in Freighter/xBull, get a signed XDR back." So the interface has to be `signTransaction(tx) → signedTx`: the Privy implementation does hash extraction, `rawSign`, and signature attachment internally; the Kit implementation delegates wholesale. Getting that boundary right is what makes this worth doing — a toggle between two copy-pasted code paths is not.

**Why they were split rather than left as one app on an env var.** The env var was the right shape while the interface was being found — it forced both implementations through the same page and proved the boundary held. As a published example it is the wrong shape: each example is meant to be copied out whole, and a reader after one integration had to mentally delete the other, install an SDK they had no use for, and read a README half of which did not apply. Each directory is now the whole answer to one question, and each README links the other and states the difference in a table.

**In scope:** the interface, both implementations, two self-contained examples, a README each.
**Out of scope:** a wallet picker UI beyond what the Kit ships, WalletConnect configuration, sharing code between the two directories — the repo's rule is that examples stand alone.

**Done when:** the same contribution flow completes in both examples, each builds and lints with only the SDK it uses, and `verify:contribution` passes in both.

**Resources**
- [Stellar Wallets Kit](https://stellarwalletskit.dev/) · [GitHub](https://github.com/Creit-Tech/Stellar-Wallets-Kit) · [npm](https://www.npmjs.com/package/@creit.tech/stellar-wallets-kit)
- [Wallet integration overview](https://developers.stellar.org/docs/tools/developer-tools/wallets)
