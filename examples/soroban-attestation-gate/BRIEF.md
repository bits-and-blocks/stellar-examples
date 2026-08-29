# Build brief — `attestation_gate`

Working document for the `soroban/attestation-gate` branch. **Delete before
merging to `main`** — the README is what ships.

Read [README.md](README.md) first: it states the claim, the eight bound fields
and the invariants. This file is the how — what to create, what the Soroban SDK
calls are, and the traps that are specific to this platform rather than to Rust.

---

## 1. Layout

```md
examples/soroban-attestation-gate/
├── README.md
├── BRIEF.md            ← this file, deleted before merge
├── .gitignore
├── contract/
│   ├── Cargo.toml
│   ├── Cargo.lock      ← committed
│   └── src/
│       ├── lib.rs      ← `#![no_std]`, the three entry points
│       ├── types.rs    ← Category, Attestation, DataKey, Error, events
│       ├── policy.rs   ← the fixed split, a pure function
│       ├── attest.rs   ← signature threshold check
│       └── test/       ← or test.rs; see §7
└── scripts/            ← build/deploy, copied from the sibling example; §9
```

The module split is a suggestion, but keep `policy.rs` separate whatever else you
do: the test matrix requires unit-testing the split function directly, not only
through `contribute`.

`Cargo.toml`: `soroban-sdk = "27.0.6"`, dev-dependency `soroban-sdk` with
`features = ["testutils"]` plus `ed25519-dalek = "2.2.0"` for signing in tests
and `proptest = "1"` for the split invariant (§7). Copy the `[profile.release]`
block from `../soroban-reproducible-build/contract/Cargo.toml` — it matters, see
trap 6. No `rust-toolchain.toml` (the pinned container image is the toolchain
pin).

The SDK major version tracks the protocol version: SDK 27 targets protocol 27.
Testnet upgrades ahead of mainnet, so `27.0.6` is right for this example, and it
matches the sibling reproducible-build pipeline you are reusing. Confirm with
RPC `getVersionInfo` before deploying rather than assuming.

`lib.rs` starts with `#![no_std]` — the standard library is not available in the
Wasm environment, and every type you reach for (`String`, `Vec`, `Map`,
`Symbol`) comes from `soroban_sdk` instead. Tests compile for the native target,
so a test module that needs std says `extern crate std;` at its top; `proptest`
in particular will not compile without it.

Every `.rs` file starts with `// SPDX-License-Identifier: Apache-2.0`.

---

## 2. Types

**`Category`** — a `#[contracttype]` unit enum, eight variants, the asnaf:
`Fuqara`, `Masakin`, `Amilin`, `Muallaf`, `Riqab`, `Gharimin`, `FiSabilillah`,
`IbnSabil`. It is used as a `Map` key, so it needs the traits `#[contracttype]`
gives you; add `Copy` yourself if you want it.

**`Attestation`** — a `#[contracttype]` struct. The eight fields from the README:
`recipient: Address`, `asset: Address`, `category: Category`, `amount: i128`,
`sequence: u64`, `expiry_ledger: u32`, `pool: Address`, `network_id: BytesN<32>`.

> The handoff spec says "all seven fields" and then lists eight. I read that as a
> miscount, not a design instruction, and the README commits to eight. The
> alternative reading — seven struct fields, with the network id mixed into the
> signed bytes rather than carried as a field — binds exactly as much, but a
> wrong-network attestation then fails as an opaque signature error instead of a
> named one. Your call; if you take the seven-field route, say so in the README
> and keep the distinct error.

**`DataKey`** — a `#[contracttype]` enum of storage keys: `Admin`, `Authority`,
`Threshold`, `Distributor`, `Asset`, `Buckets`, `DistributionSeq`. All in
**instance** storage (see trap 5).

**`Error`** — `#[contracterror] #[repr(u32)]`, explicit discriminants, one variant
per refusal. Distinct errors are the point: the test matrix asserts *which* one.
You will want at least: bad threshold, non-positive amount, split mismatch,
overflow, attestation/args mismatch, wrong pool, wrong network, wrong asset,
expired, sequence mismatch, unknown signer, threshold not met, insufficient
bucket, insolvent.

There is deliberately no already-initialized variant: the constructor (§3) makes
that state unreachable rather than guarded.

**Events** — `#[contractevent]` structs `Contribution` and `Disbursement`,
published with `.publish(&env)`. Mark the fields worth indexing with `#[topic]`
(contributor; recipient and category). `Disbursement` carries the **hash of the
attestation** — `env.crypto().sha256(&xdr_bytes)` — which is what lets an auditor
tie an on-chain payout to an off-chain approval without the approval being public.

Design these two for a reader who has only the event stream: the sibling
[soroban-event-indexer](../soroban-event-indexer) example rebuilds the whole
donor trace from them and nothing else.

---

## 3. Entry points

### `__constructor(admin, authority: Vec<BytesN<32>>, threshold: u32, distributor: Address, asset: Address)`

Not an `init` function. `__constructor` is a reserved name the SDK recognizes: it
runs atomically as part of deployment and can never be called again. Use it.

The difference is not stylistic. An `init` guarded by a stored flag has a window
between deploy and init in which anyone can call it and become the admin with
their own authority keys — a front-run that costs the pool everything. The
constructor closes the window by construction, and takes the double-init error
variant and its test with it. This is the same argument the split function makes
in §4: a state that cannot be represented beats a state that is checked.

Three ed25519 public keys, threshold 2, for the demo. Requirements:

- `admin.require_auth()`.
- Refuse `threshold == 0` or `threshold > authority.len()`. A threshold of zero
  is a pool anyone can drain; a threshold above the key count is a pool nobody
  can ever pay out of. Both are configuration mistakes worth naming, and both
  are still runtime checks — the constructor removes the *replay*, not the need
  to validate arguments.
- Initialize all eight buckets to zero, and `distribution_seq` to zero.

`admin` is stored and otherwise unused in this example — governance is the
skeleton's subject. That is deliberate; say so in a comment so it does not read
as an unfinished thought.

### `contribute(from: Address, amount: i128)`

- `from.require_auth()`; refuse `amount <= 0`.
- Pull the funds: `token::Client::new(&env, &asset).transfer(&from, &env.current_contract_address(), &amount)`.
- Split across the eight buckets with `policy::split`, and refuse unless the
  parts sum to exactly `amount`.
- Checked arithmetic on every add.
- Assert solvency, emit `Contribution`.

Order the transfer before the credit. The two orderings are equivalent for safety
here — a failed transfer traps and reverts the whole invocation either way — but a
bucket credited before the money arrives is a state that should never exist even
transiently, and the solvency assert is only meaningful once the balance moved.

### `distribute(recipient, category, amount, attestation, sigs: Vec<(u32, BytesN<64>)>)`

The check order from the README §"How a distribution goes through". Two details:

**Why `recipient`/`category`/`amount` appear twice** — once as arguments, once
inside the attestation — is a fair question. The redundancy makes the call site
readable at the RPC layer and gives a cheap early refusal. Check them for
equality against the attestation and refuse a mismatch with its own error.

**`sigs` is `(key index, signature)`**, not a signature per key slot. The index
selects from the `authority` vector. Requirements: an out-of-range index is an
error; the *same* index submitted twice counts **once** (so 2-of-3 cannot be
faked by repeating one signature); the count of distinct valid signers must reach
`threshold`.

State changes — decrement the bucket, increment `distribution_seq` — happen before
the outbound transfer. Then assert solvency, then emit.

### Views

Whatever the tests and a future indexer need: `buckets()`, `bucket(category)`,
`distribution_seq()`, and getters for the config. Keep them read-only.

---

## 4. The split

A pure function: `amount -> Map<Category, i128>`, no storage, no env state beyond
`&Env` for the `Map`.

Fixed basis points per category summing to 10 000. Integer division truncates, so
eight floor-divisions will usually sum to slightly *less* than `amount` — assign
the remainder to one designated bucket so the total is exact by construction.
Then assert the sum equals `amount` anyway and return an error if not. The assert
is unreachable if the function is right; it stays because "unreachable" is a
claim about today's code, and this one is worth re-checking on every call.

Use `checked_mul`/`checked_add` and return an overflow error rather than
panicking. `amount * 10_000` overflows `i128` at absurd values, but "absurd" is
not a security boundary.

---

## 5. SDK surface you will need

| What you want | What to call |
| --- | --- |
| This contract's own address | `env.current_contract_address()` |
| SHA-256 of the network passphrase | `env.ledger().network_id() -> BytesN<32>` |
| Current ledger number | `env.ledger().sequence() -> u32` |
| XDR bytes of a `#[contracttype]` value | `soroban_sdk::xdr::ToXdr` → `value.to_xdr(&env) -> Bytes` (consumes `self`; clone first) |
| Verify a signature | `env.crypto().ed25519_verify(&pubkey, &message, &sig)` — **traps on failure**, see trap 1 |
| Hash the payload for the event | `env.crypto().sha256(&bytes)` → `Hash<32>`, then `.to_bytes()` |
| Move an asset | `soroban_sdk::token::Client::new(&env, &asset)` → `.transfer(&from, &to, &amount)`, `.balance(&addr)` |
| Keep the contract alive | `env.storage().instance().extend_ttl(threshold, extend_to)` |
| Publish an event | `MyEvent { .. }.publish(&env)` |

Test-side:

| What you want | What to call |
| --- | --- |
| A test env | `Env::default()`, then `env.mock_all_auths()` |
| Deploy the contract | `env.register(AttestationGate, ContractArgs::__constructor(&admin, &authority, &threshold, &distributor, &asset))` — the constructor args are the second argument; `()` is for a contract that has none |
| A test SAC | `env.register_stellar_asset_contract_v2(admin)` → `.address()`, mint with `token::StellarAssetClient` |
| Assert a specific error | `client.try_distribute(..)` → `Err(Ok(Error::X))`; see trap 2 |
| Move the ledger forward | `env.ledger().set_sequence_number(n)` (`testutils::Ledger`) |
| Auth for one address only | `env.mock_auths(&[MockAuth { .. }])` — needed for the distributor test |
| Read emitted events | `env.events().all()`, compared against `MyEvent { .. }.to_xdr(&env, &contract_id)` — see trap 7 |
| Profile an invocation | `env.cost_estimate().resources()` |

---

## 6. Seven traps

1. **`ed25519_verify` does not return a bool — it traps.** There is no fallible
   variant. So you cannot "try each signature and count the good ones": one bad
   signature aborts the whole invocation. Decide the semantics and document them:
   the workable rule is that every signature submitted must be valid for the key
   at its index, and `threshold` is about how many *distinct* valid signers were
   supplied. A caller that includes a junk signature gets a failed transaction
   rather than a silently-ignored entry. Say this in the README's interface
   section — it is the one place the contract's behaviour is not what a reader
   would assume.

2. **Contract errors and host traps are different failures.** `try_foo` returns
   `Err(Ok(YourError))` for a `Result::Err` you returned, and
   `Err(Err(InvokeError::Abort))` for a host trap — a failed `ed25519_verify`, a
   failed `require_auth`, an arithmetic overflow. Half your test matrix asserts
   the first kind and half the second. Assert the precise variant either way; a
   bare `is_err()` will happily pass on the wrong failure.

3. **`mock_all_auths()` hides the auth tree.** When `contribute` calls
   `transfer(&from, ..)`, the SAC does its own `from.require_auth()` on that
   *sub-invocation*. In tests with `mock_all_auths` this is invisible; against a
   real network the contributor's transaction must carry an authorization entry
   covering the sub-invocation, which is what `simulateTransaction` builds for
   you. Worth knowing before the walkthrough script surprises you. For the
   "authority key cannot distribute" test, use `mock_auths` with a specific
   address rather than `mock_all_auths`, or the test proves nothing.

4. **The signer must produce byte-identical XDR.** The signature covers
   `to_xdr(attestation)`, so the off-chain signer and the contract have to agree
   exactly. In tests, build the same `Attestation` struct and call `to_xdr` on it
   rather than hand-rolling the bytes — that is the only way the test proves the
   contract's check rather than your reimplementation of it.

5. **Storage type and TTL.** Instance storage is one ledger entry holding
   everything, and it is what you want here: eight buckets and a small config,
   bounded forever. Extend the TTL on the state-changing entry points, or the
   contract is archived after a few weeks of inactivity and has to be restored
   before it will run. Persistent storage per bucket would work too but buys
   nothing and costs more.

6. **Rust release builds wrap on overflow.** `overflow-checks = true` in
   `[profile.release]` is not optional here — without it, a `+` that overflows in
   the deployed Wasm silently wraps, where the same code aborts in `cargo test`.
   Use `checked_*` explicitly as well; the profile setting is the backstop for
   the arithmetic you forget.

7. **`env.events().all()` and `env.auths()` show only the most recent
   invocation.** Both are reset by the next call into the contract. A test that
   contributes, then distributes, then asserts on the event stream is asserting
   on the disbursement alone — and it will pass, because the disbursement is
   there. The contribution assertion silently never ran. Assert immediately
   after the call you are testing, before making another. This is the one item
   here that fails by passing, which is why it is worth its own line.

---

## 7. Test matrix

The deliverable, as much as the contract. One `#[test]` per line, named for what
it refuses.

**Happy path:**

- [ ] valid 2-of-3 succeeds: recipient balance up, bucket down, `distribution_seq` incremented, `Disbursement` event correct
- [ ] `contribute` credits all eight buckets, emits `Contribution`, and the parts sum to the contributed amount

**Threshold and keys:**

- [ ] 1-of-3 fails
- [ ] a signature from a key outside the authority set fails
- [ ] the same signer submitted twice counts once, and so fails the threshold

**Payload binding** (re-sign the altered payload; the point is that the contract
refuses it, not that the signature breaks)

- [ ] altered `amount` fails
- [ ] altered `recipient` fails
- [ ] altered `category` fails
- [ ] altered `asset` fails

**Replay and freshness:**

- [ ] replay of a consumed sequence fails
- [ ] a sequence from the future fails
- [ ] an expired attestation fails (move the ledger past `expiry_ledger`)

**Domain separation:**

- [ ] an attestation naming a different contract address fails — register a second
      instance and aim one at the other
- [ ] an attestation with a different network id fails

**Authorization and balances:**

- [ ] distributing more than the bucket holds fails
- [ ] submission authorized by an authority key rather than the distributor fails

**Purity and invariants:**

- [ ] the split function, unit-tested directly, always sums to exactly the input
      — the "split-sum mismatch is unrepresentable" claim. This is a property,
      so state it as one rather than as a list of hand-picked amounts:

      ```rust
      proptest! {
          #[test]
          fn split_always_sums_to_input(amount in 1i128..=i128::MAX / 10_000) {
              let parts = policy::split(&env, amount).unwrap();
              prop_assert_eq!(parts.values().iter().sum::<i128>(), amount);
          }
      }
      ```

      The upper bound is where `amount * 10_000` stops fitting in `i128`; above
      it the function is expected to return the overflow error, which is worth a
      second, separate test. Needs `extern crate std;` in the test module (§1).
- [ ] solvency holds after a direct SAC transfer to the contract address: the
      surplus is visible in the balance, no bucket moved, and it cannot be
      distributed

Add the constructor's argument guards (threshold 0, threshold > key count) while
you are in there. There is no double-init test: `__constructor` cannot be called
twice, so the case is unrepresentable rather than merely refused.

---

## 8. Definition of done

- [ ] `cargo test` green, and green in CI — the root `ci.yml` rust matrix currently
      runs `cargo build` only, so add `cargo test --locked` to it (one line,
      repo-wide, and the sibling example's tests pass under it too)
- [ ] `distribute` profiled with `env.cost_estimate().resources()` and inside the
      mainnet budget. Test environments enforce the real CPU and memory limits by
      default, so this is mostly self-enforcing — but `distribute` is the densest
      invocation in the repo (XDR serialization, up to three `ed25519_verify`
      calls, a SHA-256, eight map operations and a token transfer), and it is the
      one place worth knowing the actual headroom rather than only that you are
      under. Record the number; the threshold is a knob a reader may turn up.
- [ ] built and deployed to testnet **through the sibling reproducible-build
      pipeline**, so the README carries the contract id, the Wasm hash and the
      SEP-58 verification command side by side
- [ ] README `TODO`s filled: the facts table, the interface section, the
      provenance command
- [ ] root `README.md` status row added and flipped to **Working** — which means
      someone else ran it end to end from a clean clone
- [ ] `BRIEF.md` deleted

**Deployment is blocked on Docker.** The pipeline builds only inside the pinned
container; the daemon is not running on this machine right now. Start Docker
Desktop before the deploy step. Everything up to it — contract, tests, README —
needs nothing but Rust.

---

## 9. The build pipeline

Copy from `../soroban-reproducible-build/`: `scripts/_common.sh`, `build.sh`,
`deploy.sh`, `make-source-archive.sh`, `test.sh`, and `build.conf`. They are
config-driven — `build.conf` is the only file that changes (package name, wasm
name, source prefix, archive path). Keep the same `BLDIMG` digest.

Do **not** copy `verify.sh` or the negative-fixture scripts. The verifier is the
sibling example's subject, it is general over any contract id, and a second copy
here would be a second implementation to drift. The README points at it instead.

---

## 10. Resources

- [Soroban SDK docs](https://docs.rs/soroban-sdk/27.0.6/soroban_sdk/) — the crate
  is already in your cargo cache; `cargo doc --open` in `contract/` is faster than
  the web
- [skills.stellar.org](https://skills.stellar.org) — SDF's AI-oriented guides;
  [smart-contracts](https://skills.stellar.org/skills/smart-contracts/SKILL.md)
  and its `testing.md` are the two that bear on this example. Installable as a
  Claude Code plugin: `/plugin marketplace add stellar/stellar-dev-skill` then
  `/plugin install stellar-dev@stellar-dev`
- [Authorization in Soroban](https://developers.stellar.org/docs/learn/fundamentals/contract-development/authorization) — read before trap 3 bites
- [Storage types and state archival](https://developers.stellar.org/docs/learn/fundamentals/contract-development/storage/state-archival)
- [`stellar/soroban-examples`](https://github.com/stellar/soroban-examples) —
  `atomic_swap` for the auth pattern, `token` for SAC interaction
- `../soroban-reproducible-build/` — the pipeline, and the house style for how an
  example's README argues its claim

One gap to flag: the handoff spec says to read `ARCHITECTURE.md` for the design
being demonstrated. There is no such file in this repo. If it lives elsewhere,
point me at it — the CipherPhi mapping in example 2 will need it.
