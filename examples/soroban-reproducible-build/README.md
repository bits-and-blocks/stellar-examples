# soroban-reproducible-build

Proves that a contract deployed on testnet was built from the source it claims —
by rebuilding it in a container pinned to an immutable digest and comparing the
resulting Wasm hash to the bytes the network is actually running.

The build records how it was made, in [SEP-58](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0058.md)
vocabulary, inside the Wasm itself. So the check does not depend on this repo:
`verify.sh` takes **any** contract id, reads the recipe off the chain, and
replays it. Point it at a contract we did not build and it either verifies it or
tells you exactly which link is missing.

**Targets SEP-58 v0.6.0** (Draft, updated 2026-07-15). Deviations are listed
under [Conformance](#conformance).

| | |
| --- | --- |
| Contract | [`CDPBFXGUAX56XJYEK6F6EIEBCSNWFMO7CZAJGS5ZC4XL7PFNQEH6Z32L`](https://stellar.expert/explorer/testnet/contract/CDPBFXGUAX56XJYEK6F6EIEBCSNWFMO7CZAJGS5ZC4XL7PFNQEH6Z32L) |
| Network | testnet |
| Wasm hash | `2f94f87a0a01af3eeaf720e87059529efc7c2ec964f9970aaa3288fee48e7390` |
| `bldimg` | `docker.io/stellar/stellar-cli@sha256:7040ab64…` |
| `source_sha256` | `3f0417b78aead1366ab4b6e4ddf32fee69cb884b4352eb7e99db21b53aab7dd3` |

## Run it

You need **Docker** and **Node 20+**. You do not need Rust, cargo, or the
Stellar CLI — if the host could contribute to the build, a passing check would
only tell you something about your own machine.

On Windows the scripts run under either Git Bash or WSL, whichever `bash`
resolves to in the shell you use — `npm run` from PowerShell lands in WSL, where
Node is on PATH as `node.exe` rather than `node`. Both are handled; you should
not have to care which one you are in.

```bash
cd examples/soroban-reproducible-build
npm install
npm run verify:sep58            # the general verifier, against our contract
```

```
recorded build metadata (SEP-58 v0.6.0)
  bldimg: docker.io/stellar/stellar-cli@sha256:7040ab64bb977006c2b7466fc5face9a…
  bldopt: --locked
  source_sha256: 3f0417b78aead1366ab4b6e4ddf32fee69cb884b4352eb7e99db21b53aab7dd3

source:    sources/reproducible-counter-0.1.0.tar (content-addressed match)
toolchain: 1.97.1-x86_64-unknown-linux-gnu
rebuilding...

deployed:  2f94f87a0a01af3eeaf720e87059529efc7c2ec964f9970aaa3288fee48e7390
rebuilt:   2f94f87a0a01af3eeaf720e87059529efc7c2ec964f9970aaa3288fee48e7390

✅ verified — CDPBFXGU… was built from the recorded source
```

Point it at anything:

```bash
./scripts/verify.sh <contract-id>
./scripts/verify.sh <contract-id> --source-archive ./some-source.tar
```

First run takes about 90 seconds, nearly all of it compiling the Soroban SDK
inside the container.

## What the verifier actually does

Everything below the first line is read from the network, not from this repo.

1. **Read the metadata.** `stellar contract info meta --contract-id …` returns
   the `contractmetav0` entries. The SEP-58 fields are pulled out and checked
   against the spec's format regexes; a malformed value is refused rather than
   repaired.
2. **Check the image against an allowlist.** Not optional paranoia — see
   [Trust](#what-this-does-not-prove).
3. **Fetch the deployed Wasm** and hash it.
4. **Obtain the source archive** named by `source_sha256`, and confirm the bytes
   hash to that value.
5. **Extract it**, requiring exactly one top-level directory, which becomes the
   `/source` mount.
6. **Replay the recorded build** — `bldarg` entries in order (defaulting to
   `contract build`), then `bldopt` entries, then every recorded field passed
   back through `--meta`.
7. **Compare** the rebuilt hash to the deployed hash.

Step 6's `--meta` replay is the subtle part. The metadata lives *inside* the
Wasm, so it is part of what gets hashed: rebuild without it and you get
different bytes even from identical source. The verifier replays the fields in
the order it read them, which reproduces the original section without either
side needing to agree on a canonical ordering.

## Watch it refuse

Two contracts are deployed on testnet *on purpose* to be defective, recorded in
[negative-fixtures.json](negative-fixtures.json). A verifier that only ever
prints ✅ against its author's own contract has demonstrated nothing.

```bash
bash scripts/check-negative-fixtures.sh
```

```
verify.sh must refuse:
  ok       no build metadata (exit 3)
  ok       source does not build to the deployed bytes (exit 9)
  ok       archive does not match source_sha256 (exit 7)
  ok       the honest contract still verifies (exit 0)
```

Each case gets its own message and its own exit code, because they mean
completely different things:

| Exit | Case | What it means |
| --- | --- | --- |
| `3` | **No build metadata** | The contract records no SEP-58 fields. Normal for anything built before the SEP — **not** evidence of wrongdoing, and the verifier says so. |
| `7` | **Archive doesn't match `source_sha256`** | The source you supplied isn't the source the contract names. Rebuilding it would answer a question nobody asked. |
| `9` | **Rebuild differs** | The archive *is* the recorded one, it built in the recorded image with the recorded flags, and the bytes still disagree. The contract's metadata does not describe how it was built. |
| `5` | `bldimg` not allowlisted | The contract names a build image this verifier hasn't vetted. |
| `6` | Source unobtainable | `source_uri` is unreachable, or content-addressed source isn't present locally. |
| `8` | The recorded build doesn't produce a Wasm | |

Exit `9` is the one worth dwelling on. The "lying" fixture was compiled from
*modified* source while recording the *honest* archive's hash. Its metadata is
perfectly well-formed, its archive hashes correctly, every earlier check passes
— and it is caught anyway, at the only step that can catch it. That is the
attack SEP-58 exists to detect, and it is reachable on demand:

```bash
./scripts/verify.sh CCEIPC6NMRJVUCV62SEBONLEIWOIAMMQEYHYS3TPOGB2IPPVUJAH4M34
```

## Conformance

Targeting **SEP-58 v0.6.0**. What we record:

| Field | Value | Notes |
| --- | --- | --- |
| `bldimg` | `docker.io/stellar/stellar-cli@sha256:7040ab64…` | Registry-qualified, single-arch |
| `bldopt` | `--locked` | |
| `bldarg` | *(absent)* | Verifiers apply the spec default, `contract` then `build` |
| `source_sha256` | `3f0417b7…` | |
| `source_uri` | *(absent)* | See below |

Two points where the spec is easy to get wrong, and A1 did:

- **`bldimg` must name a single-architecture digest**, not a multi-arch manifest
  list. A list digest resolves to a different concrete image depending on who
  pulls it, which is the exact ambiguity the pin exists to remove. Ours is the
  `linux/amd64` member of the `27.1.0-rust1.97.1-slim-trixie` list.
- **`bldimg` must include an explicit registry host.** The Docker-Hub shorthand
  `stellar/stellar-cli@sha256:…` is not conformant; `docker.io/stellar/…` is.

**No `source_uri`, by design.** SEP-58 §2 supports two modes, and we use the
content-addressed one: `source_sha256` alone, with the archive obtained out of
band. The alternative would be pointing at a durable release asset — the spec is
explicit that a forge's *on-the-fly* source archives don't qualify, since those
bytes can change. Our archive is committed at
[sources/](sources/), and `verify.sh` finds it by hash. The download path is
implemented and used for any contract that does record a `source_uri`.

**`RUSTUP_TOOLCHAIN` is resolved from the image and forced back in.** Otherwise
a `rust-toolchain.toml` in someone's source could make rustup swap toolchains
mid-build and quietly defeat the image pin. This matters more for the general
verifier than for our own contract, since we don't control what strangers commit.

## Reproducing the archive

SEP-58 requires the producer to be able to hand over the exact archive bytes
`source_sha256` names — either by keeping that file forever or regenerating it
identically. We regenerate:

```bash
npm run archive
```

That was fussier than expected. `git archive` stamps entries with the *current
time* when handed a tree, so two runs a second apart produce two different
hashes, and its `--mtime` flag isn't honoured by git 2.44. Host `tar` varies too
— GNU, bsdtar and Windows builds disagree on defaults. So the archive is built
by GNU tar *inside the pinned image*, with mtime, uid/gid, ordering and format
all fixed explicitly, from a `git ls-files` list so only tracked files are
included.

## What this does not prove

- **That the contract does what it says.** Reproducibility is provenance, not
  behaviour. It tells you which source to audit; it does not audit it. A
  perfectly reproducible build of a malicious contract reproduces perfectly.
- **That the build image is honest.** A digest pins *which bytes* the image is,
  not that those bytes behave. A hostile image can emit attacker-chosen Wasm
  from any source and make verification pass. This is why `verify.sh` ships an
  allowlist (`docker.io/stellar/stellar-cli@…`) and requires `--any-image` to
  step outside it — SEP-58 §Security Concerns is explicit that verifiers should
  not run arbitrary images.
- **That a green result came from an honest verifier.** Anyone can publish false
  positives. The spec's answer is to weigh results by verifier reputation and
  aggregate across independent ones.

## CI

[`reproducible-build.yml`](../../.github/workflows/reproducible-build.yml) runs
on every PR touching this directory, plus weekly:

1. rebuild in the pinned image
2. `check-deployed-hash.mjs` — our source vs our deployment, read straight from
   the `contract_code` ledger entry
3. `verify.sh` — the same conclusion reached the general way, from metadata alone
4. `check-negative-fixtures.sh` — the refusals
5. contract unit tests

Steps 2 and 3 overlap deliberately. Step 2 is what A1 built: a direct
ledger-entry comparison that needs no metadata and would survive SEP-58 changing
underneath us. Step 3 is the metadata-driven path a third party would use.

No Rust toolchain is installed on the runner. Everything that compiles happens
inside the pinned image, so a green run cannot be a statement about the runner.

## Redeploying

CI never deploys. You need to redeploy when the contract source changes on
purpose, or after a **testnet reset** (roughly quarterly, wipes every deployed
contract). A reset is reported as `could not read contract …` rather than a hash
mismatch, so the cause is unambiguous.

```bash
npm run archive        # regenerate the source archive + source_sha256
npm run build:wasm     # build, embedding the SEP-58 meta
npm run deploy         # deploy, write deployment.json
bash scripts/make-negative-fixtures.sh   # redeploy the fixtures too
```

`deploy.sh` generates a throwaway testnet key into `.deployer-secret`
(gitignored) on first use and funds it with friendbot. The testnet passphrase is
hard-coded and re-asserted by the checker, so no environment variable can point
this example at mainnet.

## Layout

```
build.conf                       the pin — bldimg, bldopt, archive naming
contract/                       the subject contract (Rust, soroban-sdk 27)
  Cargo.lock                    committed; the build runs --locked
sources/                        the SEP-58 source archive, found by hash
scripts/
  make-source-archive.sh        deterministic tar -> source_sha256
  build.sh                      build in the pinned image, embedding the meta
  deploy.sh                     one-time deploy -> deployment.json
  verify.sh                     ** the SEP-58 verifier, for any contract id **
  sep58-fields.mjs              parse + format-check the vocabulary
  check-deployed-hash.mjs       A1's direct ledger-entry comparison
  make-negative-fixtures.sh     deploy the deliberately broken contracts
  check-negative-fixtures.sh    assert the verifier refuses them
  test.sh                       contract unit tests, same container
deployment.json                 what is deployed, and what built it
negative-fixtures.json          the broken contracts, and how they should fail
```

`contract/` sits one level down so the repo's generic Rust matrix doesn't pick
it up. A second build using the runner's own toolchain would produce a different
artifact by a different route, and having two answers to "what are the bytes" is
what this example exists to eliminate.

## References

- [SEP-58 v0.6.0](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0058.md) — the vocabulary this example implements
- [SEP-55](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0055.md) — the attestation-based alternative; the two can coexist on one contract
- [SEP-46](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0046.md) — the `contractmetav0` section the fields live in
- [Contract source verification using Docker without attestation](https://github.com/orgs/stellar/discussions/1923) — the design discussion behind SEP-58
- [`--meta` in `stellar contract build`](https://github.com/stellar/stellar-cli/issues/1605)
