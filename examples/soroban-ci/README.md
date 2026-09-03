# soroban-ci

**Claim: a Soroban contract's CI should fail loudly when it is misconfigured, not go green by checking nothing.**

This example is a working GitHub Actions workflow that runs formatting, lints, unit tests and a release Wasm build against every Soroban contract in this repository. The file is [`workflows/contract.yml`](workflows/contract.yml).

It exists because the obvious version of this file was already here and had never once run.

## The failure that motivated it

The repository's general `ci.yml` discovers examples by scanning for manifests:

```bash
find examples -mindepth 2 -maxdepth 2 -name Cargo.toml -exec dirname {} \;
```

Every Rust example in this repo keeps its crate in a `contract/` subdirectory, so its `Cargo.toml` sits at depth 3. The scan returned `[]`. The job that consumed it was guarded by `if: needs.discover.outputs.rust != '[]'`, so it was skipped on every run since the day it was written, and skipped jobs are not failures. Two contracts went unbuilt and untested in CI while the badge stayed green.

Nothing about that is exotic. It is one wrong integer in a `find` invocation. What made it survive is that the failure mode of discovery is **silence**: a pattern matching nothing and a pattern matching everything look identical from the outside, and only one of them tells you.

So this workflow lists its contracts:

```yaml
    dir:
      - examples/soroban-attestation-gate/contract
      - examples/soroban-reproducible-build/contract
```

**The alternative that lost** was to fix the `find` depth and keep discovering. It is genuinely nicer: a new example is picked up with no edit, and a list is one more thing to forget. The cost of the list is exactly that, one line per new contract, paid at the moment you add one. The cost of discovery is that when it breaks it does so invisibly, and you find out from a bug in production rather than from CI. For a repository whose examples are read as reference, a wrong path that turns the job red is worth more than a right path that would have saved an edit.

If you prefer discovery, keep it and assert on the result:

```bash
[ "$(jq length <<< "$rust_dirs")" -gt 0 ] || { echo "::error::no contracts found"; exit 1; }
```

That is the version of the argument that lets you have both. What is not acceptable is discovery with no floor under it.

## What it checks, and why in that order

| Step | Catches |
| --- | --- |
| `cargo fmt --check` | Diff noise, before anyone reads a diff |
| `cargo clippy --all-targets --locked -- -D warnings` | Lints, including in test code |
| `cargo test --locked` | Behaviour, compiled for the **native** target |
| `cargo build --target wasm32v1-none --release --locked` | That it still builds for the target it deploys to |

Cheapest and most specific first, so the failure you read is the failure you have.

Two details worth lifting:

**`--locked`, everywhere.** `Cargo.lock` is committed. Without `--locked`, Cargo may resolve newer dependencies than the ones the contract was tested against, so CI would be testing something other than what you deploy. With it, dependency drift is a red build.

**`wasm32v1-none`, not `wasm32-unknown-unknown`.** The pinned image in [`soroban-reproducible-build/build.conf`](../soroban-reproducible-build/build.conf) builds `wasm32v1-none`, and that is the artifact that reaches testnet. CI compiling a different target proves less than it appears to.

Note that `cargo test` needs no Wasm target and no `stellar` CLI at all. Soroban unit tests compile natively, which is what lets `test.rs` link `ed25519-dalek` and use `std` while the contract itself is `#![no_std]`.

## Why this file exists twice

GitHub Actions only runs workflows from `.github/workflows/` at the repository root, so an example directory cannot contain a live one. The copy that runs is [`.github/workflows/soroban-contract.yml`](../../.github/workflows/soroban-contract.yml); the copy above is what ships as the example.

Two copies of anything drift. Rather than rely on nobody forgetting, `ci.yml` diffs them on every run and fails if they differ. The duplication is real; what is removed is the possibility of it going unnoticed.

## Using it in your own repository

Copy `workflows/contract.yml` to `.github/workflows/` and replace the `dir:` list with your own contract directories. If your crate is at the repository root rather than under `examples/`, use `- .` and adjust the `paths:` filters. Nothing else in the file is specific to this repository.

## What this deliberately omits

- **No deployment.** Building and verifying a deployment is a different claim with different secrets, and it is [soroban-reproducible-build](../soroban-reproducible-build)'s subject.
- **No coverage gate.** A percentage is easy to hit and easy to mislead with; the attestation-gate example argues its test quality through a refusal matrix instead.
- **No caching of the Wasm artifact between jobs.** Each matrix leg is independent so that one contract's failure says nothing about another's.
- **No `rust-toolchain.toml`.** Pinning the toolchain in-repo would fight the pinned container image that the reproducible-build example uses as its toolchain pin.
