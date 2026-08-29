// SPDX-License-Identifier: Apache-2.0

use soroban_sdk::{contracterror, contractevent, contracttype, Address, BytesN};

/// The buckets a contribution is split across.
///
/// Three generic buckets, not a domain taxonomy. The count and the names are
/// arbitrary here. What the example demonstrates is that a signed attestation
/// binds *which* bucket a payout is drawn from, and that binding works the same
/// at three buckets as at thirty.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Category {
    Direct = 0,
    Operations = 1,
    Reserve = 2,
}

/// The off-chain approval. XDR-serialized, and *those bytes* are what the
/// authority keys sign, so every field below is bound by the signature.
///
/// | Field | What an attacker gets if it is not bound |
/// | --- | --- |
/// | `recipient` | A valid attestation, redirected. |
/// | `asset` | A signature approved for one token, spent in another. |
/// | `category` | A signature approved against one bucket, drawn from another. |
/// | `amount` | The number raised after signing, before submission. |
/// | `sequence` | Replay. |
/// | `expiry_ledger` | An approval that never lapses. |
/// | `pool` | The same signature, valid against a second deployment. |
/// | `network_id` | A testnet approval, replayed against mainnet. |
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Attestation {
    pub recipient: Address,
    pub asset: Address,
    pub category: Category,
    pub amount: i128,
    pub sequence: u64,
    pub expiry_ledger: u32,
    pub pool: Address,
    pub network_id: BytesN<32>,
}

/// One authority signature, carried as (position in the authority vector,
/// signature) rather than a signature per key slot. A named struct rather than
/// a tuple so the argument is legible in an RPC payload.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SignerSig {
    pub index: u32,
    pub signature: BytesN<64>,
}

/// Instance storage keys. Everything this contract stores is bounded and small,
/// so it all lives in one instance entry. See the README on bounded storage.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    Authority,
    Threshold,
    Distributor,
    Asset,
    Buckets,
    DistributionSeq,
}

/// One variant per refusal. Distinct errors are the point: a test asserts
/// *which* one, and an operator reading a failed transaction learns which door
/// was the wrong one rather than "signature check failed".
///
/// There is deliberately no `AlreadyInitialized`: configuration happens in
/// `__constructor`, which cannot be called twice, so the state is
/// unrepresentable rather than guarded.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// Threshold of zero (a pool anyone drains) or above the key count (a pool
    /// nobody can pay out of).
    InvalidThreshold = 1,
    /// Non-positive contribution or distribution amount.
    InvalidAmount = 2,
    /// The split did not sum to exactly the amount. Unreachable if `policy`
    /// is right; checked on every call anyway.
    SplitMismatch = 3,
    /// Checked arithmetic said no.
    Overflow = 4,
    /// The submitted arguments disagree with the attestation.
    AttestationMismatch = 5,
    /// The attestation names a different deployment of this contract.
    WrongPool = 6,
    /// The attestation was signed for a different network.
    WrongNetwork = 7,
    /// The attestation names an asset this pool does not hold.
    WrongAsset = 8,
    /// `expiry_ledger` is at or behind the current ledger.
    Expired = 9,
    /// Replay, or a sequence from the future.
    SequenceMismatch = 10,
    /// A signature index outside the authority vector.
    UnknownSigner = 11,
    /// Fewer than `threshold` distinct authority keys signed.
    ThresholdNotMet = 12,
    /// The category bucket does not hold the amount.
    InsufficientBucket = 13,
    /// The buckets claim more than the pool actually holds.
    Insolvent = 14,
}

/// Emitted by `contribute`. Carries the whole split so that a reader with only
/// the event stream can rebuild the bucket balances.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Contribution {
    #[topic]
    pub contributor: Address,
    pub amount: i128,
    pub direct: i128,
    pub operations: i128,
    pub reserve: i128,
}

/// Emitted by `distribute`.
///
/// `attestation_hash` is the SHA-256 of the XDR the authority keys signed. It
/// ties an on-chain payout to an off-chain approval without the approval itself
/// ever being public.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Disbursement {
    #[topic]
    pub recipient: Address,
    #[topic]
    pub category: Category,
    pub amount: i128,
    pub sequence: u64,
    pub attestation_hash: BytesN<32>,
}
