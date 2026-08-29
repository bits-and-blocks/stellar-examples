// SPDX-License-Identifier: Apache-2.0

//! # attestation_gate
//!
//! Funds leave this pool only against a signed eligibility attestation verified
//! on chain, and that signature cannot be replayed, redirected, or reused
//! across assets, deployments, or networks.
//!
//! See `README.md` for the argument. This file is the three entry points.

#![no_std]

mod attest;
mod policy;
mod types;

#[cfg(test)]
mod test;

pub use types::{Attestation, Category, Contribution, Disbursement, Error, SignerSig};

use soroban_sdk::{contract, contractimpl, token, xdr::ToXdr, Address, BytesN, Env, Map, Vec};

use types::DataKey;

/// Bump the instance entry when it is within this many ledgers of expiry...
const TTL_THRESHOLD: u32 = 100_000;
/// ...back out to this many. ~30 days at five seconds a ledger. Without the
/// bump the contract is archived after a quiet spell and has to be restored
/// before it will run again.
const TTL_EXTEND_TO: u32 = 518_400;

#[contract]
pub struct AttestationGate;

#[contractimpl]
impl AttestationGate {
    /// Configure the pool, atomically, as part of deployment.
    ///
    /// `__constructor` is a reserved name the SDK recognizes; it runs once at
    /// deploy and can never be called again. That is not a style choice. An
    /// `init` guarded by a stored flag leaves a window between deploy and init
    /// in which anyone can call it and install their own authority keys, a
    /// front-run that costs the pool everything. The constructor closes the
    /// window by construction, and takes the double-init error variant and its
    /// test with it.
    ///
    /// The argument guards below are still runtime checks: the constructor
    /// removes the *replay*, not the need to validate what it is handed.
    pub fn __constructor(
        env: Env,
        admin: Address,
        authority: Vec<BytesN<32>>,
        threshold: u32,
        distributor: Address,
        asset: Address,
    ) -> Result<(), Error> {
        admin.require_auth();

        // Zero is a pool anyone can drain; above the key count is a pool nobody
        // can ever pay out of. Both are configuration mistakes worth naming.
        if threshold == 0 || threshold > authority.len() {
            return Err(Error::InvalidThreshold);
        }

        let storage = env.storage().instance();
        // `admin` is stored and otherwise unused in this example. Governance is
        // the sibling skeleton's subject, not this one's. This is deliberate,
        // not an unfinished thought.
        storage.set(&DataKey::Admin, &admin);
        storage.set(&DataKey::Authority, &authority);
        storage.set(&DataKey::Threshold, &threshold);
        storage.set(&DataKey::Distributor, &distributor);
        storage.set(&DataKey::Asset, &asset);
        storage.set(&DataKey::DistributionSeq, &0u64);

        let mut buckets: Map<Category, i128> = Map::new(&env);
        buckets.set(Category::Direct, 0);
        buckets.set(Category::Operations, 0);
        buckets.set(Category::Reserve, 0);
        storage.set(&DataKey::Buckets, &buckets);

        storage.extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
        Ok(())
    }

    /// Pay into the pool. Anyone may; no attestation is involved on the way in.
    pub fn contribute(env: Env, from: Address, amount: i128) -> Result<(), Error> {
        from.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let asset = Self::asset(env.clone());

        // Transfer before credit. The two orderings are equally safe here (a
        // failed transfer traps and reverts the whole invocation either way),
        // but a bucket credited before the money arrives is a state that should
        // never exist even transiently, and the solvency assert below is only
        // meaningful once the balance has actually moved.
        let pool = env.current_contract_address();
        token::Client::new(&env, &asset).transfer(&from, &pool, &amount);

        let parts = policy::split(&env, amount)?;
        let mut buckets = Self::buckets(env.clone());
        let mut credited: i128 = 0;
        for (category, part) in parts.iter() {
            let current = buckets.get(category).unwrap_or(0);
            buckets.set(category, current.checked_add(part).ok_or(Error::Overflow)?);
            credited = credited.checked_add(part).ok_or(Error::Overflow)?;
        }
        if credited != amount {
            return Err(Error::SplitMismatch);
        }

        let storage = env.storage().instance();
        storage.set(&DataKey::Buckets, &buckets);
        storage.extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);

        assert_solvent(&env)?;

        Contribution {
            contributor: from,
            amount,
            direct: parts.get(Category::Direct).unwrap_or(0),
            operations: parts.get(Category::Operations).unwrap_or(0),
            reserve: parts.get(Category::Reserve).unwrap_or(0),
        }
        .publish(&env);

        Ok(())
    }

    /// Pay out of the pool against a quorum-signed attestation.
    ///
    /// `recipient`, `category` and `amount` appear twice: once as arguments,
    /// once inside `attestation`. The redundancy makes the call legible at the
    /// RPC layer and gives a cheap early refusal; the two are checked for
    /// equality before any signature work happens.
    pub fn distribute(
        env: Env,
        recipient: Address,
        category: Category,
        amount: i128,
        attestation: Attestation,
        sigs: Vec<SignerSig>,
    ) -> Result<(), Error> {
        // 1. One address is allowed to *submit*. It holds no authority key and
        //    can approve nothing on its own.
        let distributor = Self::distributor(env.clone());
        distributor.require_auth();

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        // 2. Arguments against the attestation.
        if attestation.recipient != recipient
            || attestation.category != category
            || attestation.amount != amount
        {
            return Err(Error::AttestationMismatch);
        }

        // 3. The "wrong door" refusals, each with its own error, so a failure is
        //    legible rather than a bare signature mismatch.
        let pool = env.current_contract_address();
        if attestation.pool != pool {
            return Err(Error::WrongPool);
        }
        if attestation.network_id != env.ledger().network_id() {
            return Err(Error::WrongNetwork);
        }
        let asset = Self::asset(env.clone());
        if attestation.asset != asset {
            return Err(Error::WrongAsset);
        }

        // 4. Freshness and replay.
        if attestation.expiry_ledger <= env.ledger().sequence() {
            return Err(Error::Expired);
        }
        let sequence = Self::distribution_seq(env.clone());
        if attestation.sequence != sequence {
            return Err(Error::SequenceMismatch);
        }

        // 5. The quorum, over the exact bytes.
        let message = attestation.clone().to_xdr(&env);
        let authority = Self::authority(env.clone());
        let threshold = Self::threshold(env.clone());
        attest::verify_quorum(&env, &authority, threshold, &message, &sigs)?;

        // 6. State before interaction.
        let mut buckets = Self::buckets(env.clone());
        let balance = buckets.get(category).unwrap_or(0);
        if balance < amount {
            return Err(Error::InsufficientBucket);
        }
        buckets.set(category, balance - amount);

        let storage = env.storage().instance();
        storage.set(&DataKey::Buckets, &buckets);
        storage.set(
            &DataKey::DistributionSeq,
            &sequence.checked_add(1).ok_or(Error::Overflow)?,
        );
        storage.extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);

        token::Client::new(&env, &asset).transfer(&pool, &recipient, &amount);

        // 7. Solvency, then the event.
        assert_solvent(&env)?;

        Disbursement {
            recipient,
            category,
            amount,
            sequence,
            attestation_hash: env.crypto().sha256(&message).to_bytes(),
        }
        .publish(&env);

        Ok(())
    }

    // --- views -------------------------------------------------------------

    pub fn buckets(env: Env) -> Map<Category, i128> {
        env.storage()
            .instance()
            .get(&DataKey::Buckets)
            .unwrap_or_else(|| Map::new(&env))
    }

    pub fn bucket(env: Env, category: Category) -> i128 {
        Self::buckets(env).get(category).unwrap_or(0)
    }

    pub fn distribution_seq(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::DistributionSeq)
            .unwrap_or(0)
    }

    pub fn admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }

    pub fn authority(env: Env) -> Vec<BytesN<32>> {
        env.storage().instance().get(&DataKey::Authority).unwrap()
    }

    pub fn threshold(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::Threshold).unwrap()
    }

    pub fn distributor(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Distributor).unwrap()
    }

    pub fn asset(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Asset).unwrap()
    }
}

/// The pool's buckets never claim more than the pool actually holds.
///
/// Note the direction: `sum(buckets) <= balance`, not `==`. Anyone can transfer
/// the asset straight to this contract's address without going through
/// `contribute`, and the contract cannot prevent it. Such a surplus shows up in
/// the balance, belongs to no bucket, and therefore can never be distributed.
///
/// Called after every state change, not only at the end of `distribute`. An
/// invariant checked in one place is a comment.
fn assert_solvent(env: &Env) -> Result<(), Error> {
    let mut claimed: i128 = 0;
    for amount in AttestationGate::buckets(env.clone()).values().iter() {
        claimed = claimed.checked_add(amount).ok_or(Error::Overflow)?;
    }

    let asset = AttestationGate::asset(env.clone());
    let held = token::Client::new(env, &asset).balance(&env.current_contract_address());

    if claimed > held {
        return Err(Error::Insolvent);
    }
    Ok(())
}
