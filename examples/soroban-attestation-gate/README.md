# soroban-attestation-gate

**Requirements:** Funds leave a pooled Soroban contract only
against a signed eligibility attestation verified on chain, and that signature
cannot be replayed, redirected, or reused across assets, deployments, or
networks.

Anyone can pay into the pool. Nobody can pay out of it without a quorum of
authority keys having signed for *this* recipient, *this* asset, *this* category,
*this* amount, at *this* point in the pool's history, before *this* ledger, on
*this* deployment, on *this* network. Change any one of those eight and the
signature stops being a signature for what is being asked.

| | |
| --- | --- |
| Contract | `TODO: contract id, after deploy` |
| Network | testnet |
| Wasm hash | `TODO: after deploy` |
| Verify the deployment | `TODO: see “Provenance”` |

> Testnet is reset roughly quarterly and every contract on it is deleted. If the
> contract id above no longer resolves, that is why, and it is not evidence of
> anything having gone wrong. Redeploy with `./scripts/deploy.sh` and the id and
> Wasm hash here should be updated to match. The Wasm hash is the durable half of
> the claim: it is reproducible from this source at any time, with or without a
> live deployment to point at.

## The eight bound fields

The attestation is a `#[contracttype]` struct, XDR-serialized, and *those bytes*
are what the authority keys sign. Every field below is inside them.

| Field | What an attacker gets if it is not bound |
| --- | --- |
| `recipient` | A valid attestation, redirected to an address of their choosing. |
| `asset` | A signature approved for one token, spent in another. |
| `category` | A signature approved against one bucket, drawn from another. |
| `amount` | The number raised after the signing, before submission. |
| `sequence` | Replay. One approval, spent as many times as there is balance. |
| `expiry_ledger` | An approval that was granted once and never lapses. |
| `pool` | The same signature, valid against a second deployment of this same contract. |
| `network_id` | A testnet approval, replayed against mainnet. |

The last two are the ones that get left out in practice, and they are the two
that turn a contract-local bug into a cross-deployment one. `pool` is compared
against `env.current_contract_address()`; `network_id` against
`env.ledger().network_id()`, which is the SHA-256 of the network passphrase.

## How a distribution goes through

1. `distributor.require_auth()`. One address is allowed to *submit*. It cannot
   approve anything on its own; it holds no authority key.
2. The submitted `recipient`, `category` and `amount` are checked against the
   attestation. Disagreement is refused before any signature work.
3. `pool`, `network_id` and `asset` are checked for equality against what this
   deployment actually is. These are the "wrong door" refusals, and each gets its
   own error so the failure is legible rather than a bare signature mismatch.
4. `expiry_ledger` against `env.ledger().sequence()`, `sequence` against the
   pool's `distribution_seq`.
5. The attestation is XDR-serialized and at least `threshold` *distinct*
   authority keys must have signed those exact bytes.
6. The category bucket must hold the amount. It is decremented, then the transfer
   goes out: state before interaction.
7. Solvency is asserted, and a `Disbursement` event is emitted carrying the hash
   of the attestation that authorized it.

## Invariants

**Solvency.** The sum of the buckets never exceeds the pool's actual balance of
the approved asset. Asserted after every state change, not only at the end of
`distribute`. An invariant checked in one place is a comment.

Note the direction: `sum(buckets) <= balance`, not `==`. Anyone can transfer the
asset straight to the contract address without going through `contribute`, and
the contract cannot prevent it. Such a surplus is visible in the balance and is
*not* allocated to any bucket, so it can never be distributed. That is the
correct behaviour, and there is a test for it.

**Bounded storage.** Nothing here grows with usage. Three buckets, a fixed
authority set, one counter. Replay protection is a monotonic sequence rather than
a set of spent nonces, precisely so that a pool that has run for two years costs
the same to keep alive as one deployed yesterday.

The price of that choice, stated plainly: attestations are consumed strictly in
order. Two attestations signed for the same sequence are two claims on one slot.
Whichever lands first wins, and the other has to be re-signed. A funded build
with concurrent disbursements needs something else, and pays for it in state.

## The three buckets

`Category` is `Direct`, `Operations`, `Reserve`. The names and the count are
arbitrary: what the example demonstrates is that the signature binds *which*
bucket a payout is drawn from, and that binding is the same work at three buckets
as at thirty.

The split across them is a **fixed demo policy** compiled into the contract, in
basis points summing to 10 000 (7 000 / 2 000 / 1 000), with the rounding
remainder going to `Direct` so that a split always sums to exactly the
contributed amount. The three shares are checked against 10 000 at compile time,
so a policy whose shares do not add up does not build.

It is not configurable here. Where allocation policy properly lives, in a
separate governed contract that the pool treats as untrusted, is the subject of
the sibling
[soroban-three-contract-skeleton](../soroban-three-contract-skeleton) example.

## Run it

You need Rust 1.84 or later with the `wasm32v1-none` target. Docker only if you
want to reproduce the deployed bytes.

```bash
cd examples/soroban-attestation-gate/contract
cargo test
cargo build --release --target wasm32v1-none
```

The tests sign with `ed25519-dalek`, a third-party signer, over the same
`to_xdr(attestation)` bytes the contract verifies. That is deliberate: a test
that hand-rolled the bytes would prove the contract agrees with the test's
reimplementation rather than with a real signer.

**Current state of the test matrix.** The eight tests here are the happy path:
configuration lands, a contribution splits and credits every bucket, a
quorum-signed attestation moves money and advances the sequence, extra signatures
above the threshold are fine, the split always sums to its input, and a surplus
sent straight to the pool belongs to no bucket. The refusals are the other half
of this example's deliverable and are not written yet: below threshold, wrong
key, duplicate signer, four kinds of altered payload, replay, future sequence,
expiry, wrong pool, wrong network, wrong asset, overdrawn bucket, and submission
by an authority key rather than the distributor.

## Provenance

The Wasm on testnet is built through the pipeline in the sibling
[soroban-reproducible-build](../soroban-reproducible-build) example: a
digest-pinned `stellar/stellar-cli` container, with SEP-58 build metadata
recorded inside the Wasm. So the deployed bytes are checkable against this source
by anyone, without trusting this repo:

```bash
# TODO: real contract id after deploy
cd examples/soroban-reproducible-build && npm install
./scripts/verify.sh <contract-id> \
  --source-archive ../soroban-attestation-gate/sources/attestation-gate-0.1.0.tar
```

## Interface

Configuration is set once, in the contract's constructor, and runs as part of
deployment. There is no separate `init` call to front-run, and no way to
reconfigure a live pool. The authority keys, the threshold, the distributor and
the approved asset are what they were at deploy, or the contract is redeployed.

```rust
__constructor(
    admin: Address,
    authority: Vec<BytesN<32>>,   // ed25519 public keys
    threshold: u32,               // 0 < threshold <= authority.len()
    distributor: Address,         // the only address allowed to submit
    asset: Address,               // SEP-41 / SAC address, pinned for life
)

contribute(from: Address, amount: i128)

distribute(
    recipient: Address,
    category: Category,
    amount: i128,
    attestation: Attestation,
    sigs: Vec<SignerSig>,         // { index: u32, signature: BytesN<64> }
)
```

`sigs` carries a position in the `authority` vector alongside each signature,
rather than a signature per key slot. Two rules a reader would not assume:

- **Every signature submitted must be valid for the key at its index.**
  `ed25519_verify` traps on a bad signature and there is no fallible variant, so
  the contract cannot try each signature and count the good ones. A caller that
  includes a junk signature gets a failed transaction, not a silently ignored
  entry.
- **A repeated index counts once.** Otherwise 2-of-3 could be faked by submitting
  one key's signature twice.

Views, all read-only: `buckets()`, `bucket(category)`, `distribution_seq()`,
`admin()`, `authority()`, `threshold()`, `distributor()`, `asset()`.

`admin` is stored and otherwise unused. It exists so that the sibling skeleton
example has something to attach governance to; nothing in this contract reads it.

Events, both defined with `#[contractevent]`:

| Event | Topics | Data |
| --- | --- | --- |
| `Contribution` | `contributor` | `amount`, and the split as `direct` / `operations` / `reserve` |
| `Disbursement` | `recipient`, `category` | `amount`, `sequence`, `attestation_hash` |

`attestation_hash` is the SHA-256 of the XDR the authority keys signed. It ties
an on-chain payout to an off-chain approval without the approval itself ever
being public. `Contribution` carries the whole split so that a reader with only
the event stream can rebuild the bucket balances, which is what the sibling
[soroban-event-indexer](../soroban-event-indexer) example does.

Errors, one per refusal, so a failed transaction says which door was the wrong
one:

| | | | |
| --- | --- | --- | --- |
| `InvalidThreshold` = 1 | `InvalidAmount` = 2 | `SplitMismatch` = 3 | `Overflow` = 4 |
| `AttestationMismatch` = 5 | `WrongPool` = 6 | `WrongNetwork` = 7 | `WrongAsset` = 8 |
| `Expired` = 9 | `SequenceMismatch` = 10 | `UnknownSigner` = 11 | `ThresholdNotMet` = 12 |
| `InsufficientBucket` = 13 | `Insolvent` = 14 | | |

There is deliberately no `AlreadyInitialized`. Configuration happens in
`__constructor`, which cannot be called twice, so the state is unrepresentable
rather than guarded.

## What this example deliberately omits

Its simplicity is not the design's ceiling. Out of scope here, and named so it is
not mistaken for an oversight:

- **No policy contract.** The allocation split is compiled in. Governed,
  swappable policy is [soroban-three-contract-skeleton](../soroban-three-contract-skeleton).
- **No timelock.** The authority set and the distributor are fixed at deployment
  and cannot be changed afterwards. Pending-change delays are the skeleton's
  subject.
- **No multi-asset support.** One approved asset, pinned at deployment.
- **No pause, no upgrade, no admin withdrawal.**

Each belongs to the funded build.

## What this does not prove

- **That the attestation is true.** The contract proves that a quorum of the keys
  it was initialized with signed for this disbursement. Whether the recipient is
  actually eligible is a question about the authority's process, off chain, and
  no amount of on-chain verification answers it.
- **That the authority keys are held safely.** Threshold signing bounds the
  damage from one compromised key. It does not bound the damage from two.
- **That the distributor cannot grief.** It can decline to submit. It cannot move
  funds, redirect them, or change an amount, which is the boundary this example
  draws.
