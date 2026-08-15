# soroban-reproducible-build

Proves that a contract deployed on testnet was built from the source in this
directory — by rebuilding it in a container pinned to an immutable digest and
comparing the resulting Wasm hash to the bytes the network is actually running.

The subject contract is deployed by us, from this repo. That is the point.
Reproducing someone else's deployment means first guessing the toolchain that
produced it; controlling the deployment means controlling the toolchain, which
turns an open-ended archaeology problem into a one-command check.

| | |
| --- | --- |
| Contract | [`CBJFOB7VDLJV4GYWAO5CDTEKEV5RJG4P7SNSIFSNOYCRSQCMCQRR3YAZ`](https://stellar.expert/explorer/testnet/contract/CBJFOB7VDLJV4GYWAO5CDTEKEV5RJG4P7SNSIFSNOYCRSQCMCQRR3YAZ) |
| Network | testnet |
| Wasm hash | `4635aa0a0f7c126c37d725e8eff553f5633cbabbed3fa33e51a7a86ae89a65ec` |
| Built with | `stellar/stellar-cli:27.1.0-rust1.97.1-slim-trixie@sha256:a8a41b70…` |

## Run it

You need **Docker** and **Node 20+**. You do not need Rust, cargo, or the
Stellar CLI — if the host could contribute to the build, a passing check would
only tell you something about your own machine.

```bash
cd examples/soroban-reproducible-build
npm install
npm run verify
```

`verify` rebuilds the contract in the pinned container and then compares. A pass
looks like this:

```
rebuilt     4635aa0a0f7c126c37d725e8eff553f5633cbabbed3fa33e51a7a86ae89a65ec  (782 bytes)
on chain    4635aa0a0f7c126c37d725e8eff553f5633cbabbed3fa33e51a7a86ae89a65ec  (782 bytes)

✅ the deployed contract was built from this source
```

The first run takes about 90 seconds, nearly all of it compiling the Soroban SDK
inside the container. Later runs reuse `contract/target/`.

`npm run test:contract` runs the contract's unit tests in the same container.
Those cover behaviour, which is a separate question from provenance — a
perfectly reproducible build of a broken contract still reproduces.

## What the check does

1. **Rebuild.** `scripts/build.sh` runs `stellar contract build` inside the
   digest-pinned image and writes `out/reproducible_counter.wasm`.
2. **Read the network.** `scripts/check-deployed-hash.mjs` fetches the
   contract's *instance* ledger entry over RPC, which names the Wasm hash the
   contract executes, then fetches the `contract_code` entry holding the bytes
   themselves.
3. **Compare.** sha256 of the rebuild against the on-chain hash.

Step 2 fetches the code and not just the hash on purpose. The instance entry
alone would prove our hash matches *a hash recorded on chain*; hashing the
retrieved code proves that hash really is the hash of the code being executed.
The check also verifies the bytes directly, which is unreachable short of a
sha256 collision but costs one comparison.

## What CI proves, and what it doesn't

The [`Reproducible build`](../../.github/workflows/reproducible-build.yml)
workflow runs exactly the two commands above on every PR touching this
directory. Green means:

> the source at this commit, compiled in this specific container, produces
> byte-for-byte the Wasm that `CBJFOB…3YAZ` is running on testnet.

It does **not** prove:

- **that the contract does what the README says.** Reproducibility is about
  provenance, not behaviour. It tells you which source you should be auditing —
  it does not do the audit.
- **anything about a contract we didn't deploy.** There is no build metadata on
  chain yet, so nothing tells a third party which image to rebuild with. Making
  the check work against *any* contract is [A2](../../TASKS.md), which embeds
  [SEP-58](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0058.md)
  metadata (`bldimg`, `bldopt`, `source_sha256`, …) so the recipe travels with
  the contract instead of living in this README.
- **that the image itself is trustworthy.** The digest pins *which* bytes you
  run, not that Docker Hub's `stellar/stellar-cli` was built honestly. That is a
  different link in the chain, and attestation is out of scope here.

## Why each pin is there

Every knob lives in [`build.env`](build.env), read by both scripts and by CI.

- **Digest, not tag.** `stellar/stellar-cli:27.1.0` can be repushed; `sha256:a8a41b…`
  cannot. Because the image bundles the Rust toolchain (see `rust1.97.1` in the
  tag), one digest transitively pins rustc, cargo, the wasm target, and the
  system layer under them.
- **`--platform linux/amd64`.** That digest is a multi-arch index and resolves
  differently per host. Forcing one platform means an arm64 laptop and an amd64
  runner execute the identical image rather than two siblings.
- **No `rust-toolchain.toml`.** Adding one would make the container fetch a
  *different* toolchain than it ships, defeating the pin. The image is the
  toolchain pin, and there is deliberately only one.
- **`-w /work`.** Cargo records absolute paths, so the build happens at a fixed
  container path. Without it, your checkout directory leaks into the Wasm and
  two people get two hashes from identical source.
- **`--locked`.** A dependency publishing a new patch release cannot silently
  change the output; `contract/Cargo.lock` is committed and the build fails if
  it would move.

## Watch it fail

A check that only ever passes is decoration. Change one byte of the contract and
run it again:

```bash
sed -i 's/extend_ttl(50, 100)/extend_ttl(50, 101)/' contract/src/lib.rs
npm run verify   # ❌ rebuild does not reproduce the deployed contract
git checkout contract/src/lib.rs
```

The Wasm stays 782 bytes and the hash changes completely — which is the property
being relied on.

## Redeploying

CI never deploys; it only compares against `deployment.json`. You need to redeploy
in two situations:

- **You changed the contract on purpose.** The check will go red, correctly.
- **Testnet reset.** Roughly quarterly, testnet is wiped and every deployed
  contract with it. The check reports `contract … does not exist on testnet`
  rather than a hash mismatch, so the cause is obvious.

```bash
npm run build:wasm
npm run deploy   # writes deployment.json
git add deployment.json && git commit -m "chore: redeploy subject contract"
```

`deploy.sh` generates a throwaway testnet key into `.deployer-secret`
(gitignored) on first use and funds it with friendbot. The testnet passphrase is
hard-coded in `deploy.sh` and re-asserted by the checker, so no environment
variable can point this example at mainnet.

## Layout

```
build.env                      the pin — image digest, platform, package name
contract/                      the subject contract (Rust, soroban-sdk 27)
  Cargo.lock                   committed; the build runs --locked
scripts/
  _common.sh                   the single `docker run` wrapper both scripts use
  build.sh                     rebuild in the pinned container -> out/
  test.sh                      contract unit tests, same container
  deploy.sh                    one-time deploy -> deployment.json
  check-deployed-hash.mjs      the assertion, with a distinct message per failure
deployment.json                what is deployed, and what built it
```

`contract/` sits one level down so the repo's generic Rust matrix doesn't pick
it up. A second build using the runner's own toolchain would produce a different
artifact by a different route, and having two answers to "what are the bytes"
is exactly what this example is trying to eliminate.

## References

- [SEP-58](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0058.md) — the draft standard for contract build reproducibility
- [Contract source verification using Docker without attestation](https://github.com/orgs/stellar/discussions/1923) — the design discussion behind it
- [getLedgerEntries](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getLedgerEntries) — how the deployed bytes are read
- [Stellar CLI manual](https://developers.stellar.org/docs/tools/cli/stellar-cli)
