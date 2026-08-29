// SPDX-License-Identifier: Apache-2.0

//! Happy path tests.
//!
//! The refusals are the other half of this example's deliverable and are not
//! here yet. What these cover is that the pool works when everything is right:
//! configuration lands, a contribution splits and credits, and a quorum-signed
//! attestation moves money and advances the sequence.
//!
//! Two things worth knowing about the harness:
//!
//! * The signatures are produced by `ed25519-dalek`, a third-party signer, over
//!   `to_xdr(attestation)`. Building the same struct and serializing it is the
//!   only way the test proves the contract's check rather than a
//!   reimplementation of it.
//! * `env.events().all()` shows the most recent invocation only. Every event
//!   assertion below sits immediately after the call it is about, because a
//!   later call silently resets the stream and the assertion would pass on the
//!   wrong events.

#![cfg(test)]

extern crate std;

use ed25519_dalek::{Signer, SigningKey};
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    token,
    xdr::ToXdr,
    Address, BytesN, Env, Event, Vec,
};

use crate::{
    policy, Attestation, AttestationGate, AttestationGateArgs, AttestationGateClient, Category,
    Contribution, Disbursement, SignerSig,
};

/// Fixed seeds, so a failing test is reproducible.
const AUTHORITY_SEEDS: [[u8; 32]; 3] = [[11u8; 32], [22u8; 32], [33u8; 32]];
const THRESHOLD: u32 = 2;
const CONTRIBUTION: i128 = 1_000_000;
const START_LEDGER: u32 = 100;
const EXPIRY_LEDGER: u32 = 1_000;

struct Fixture {
    env: Env,
    gate_id: Address,
    asset: Address,
    contributor: Address,
    recipient: Address,
    admin: Address,
    distributor: Address,
    authority: Vec<BytesN<32>>,
    signers: std::vec::Vec<SigningKey>,
}

impl Fixture {
    fn client(&self) -> AttestationGateClient<'_> {
        AttestationGateClient::new(&self.env, &self.gate_id)
    }

    fn token(&self) -> token::Client<'_> {
        token::Client::new(&self.env, &self.asset)
    }

    /// An attestation that is valid for this deployment right now.
    fn attestation(&self, category: Category, amount: i128, sequence: u64) -> Attestation {
        Attestation {
            recipient: self.recipient.clone(),
            asset: self.asset.clone(),
            category,
            amount,
            sequence,
            expiry_ledger: EXPIRY_LEDGER,
            pool: self.gate_id.clone(),
            network_id: self.env.ledger().network_id(),
        }
    }

    /// Sign the attestation's XDR with the authority keys at `indexes`.
    fn sign(&self, attestation: &Attestation, indexes: &[u32]) -> Vec<SignerSig> {
        let message: std::vec::Vec<u8> = attestation.clone().to_xdr(&self.env).iter().collect();
        let mut sigs = Vec::new(&self.env);
        for index in indexes {
            let signature = self.signers[*index as usize].sign(&message);
            sigs.push_back(SignerSig {
                index: *index,
                signature: BytesN::from_array(&self.env, &signature.to_bytes()),
            });
        }
        sigs
    }

    /// SHA-256 of the exact bytes the keys signed, which is what the
    /// `Disbursement` event carries.
    fn attestation_hash(&self, attestation: &Attestation) -> BytesN<32> {
        let message = attestation.clone().to_xdr(&self.env);
        self.env.crypto().sha256(&message).to_bytes()
    }
}

fn setup() -> Fixture {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(START_LEDGER);

    let admin = Address::generate(&env);
    let distributor = Address::generate(&env);
    let contributor = Address::generate(&env);
    let recipient = Address::generate(&env);

    let sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
    let asset = sac.address();
    token::StellarAssetClient::new(&env, &asset).mint(&contributor, &(CONTRIBUTION * 10));

    let signers: std::vec::Vec<SigningKey> =
        AUTHORITY_SEEDS.iter().map(SigningKey::from_bytes).collect();
    let mut authority = Vec::new(&env);
    for signer in &signers {
        authority.push_back(BytesN::from_array(&env, &signer.verifying_key().to_bytes()));
    }

    let gate_id = env.register(
        AttestationGate,
        AttestationGateArgs::__constructor(&admin, &authority, &THRESHOLD, &distributor, &asset),
    );

    Fixture {
        env,
        gate_id,
        asset,
        contributor,
        recipient,
        admin,
        distributor,
        authority,
        signers,
    }
}

#[test]
fn constructor_stores_the_configuration() {
    let f = setup();
    let gate = f.client();

    assert_eq!(gate.admin(), f.admin);
    assert_eq!(gate.distributor(), f.distributor);
    assert_eq!(gate.asset(), f.asset);
    assert_eq!(gate.authority(), f.authority);
    assert_eq!(gate.threshold(), THRESHOLD);
    assert_eq!(gate.distribution_seq(), 0);

    // Three buckets, all at zero. Not absent: initialized.
    assert_eq!(gate.buckets().len(), 3);
    assert_eq!(gate.bucket(&Category::Direct), 0);
    assert_eq!(gate.bucket(&Category::Operations), 0);
    assert_eq!(gate.bucket(&Category::Reserve), 0);
}

#[test]
fn contribute_credits_every_bucket() {
    let f = setup();
    let gate = f.client();

    gate.contribute(&f.contributor, &CONTRIBUTION);

    // Before anything else. Every call into a contract resets the event
    // stream, and a view is a call: assert on the events of the invocation
    // under test first, or the assertion runs against someone else's.
    assert_eq!(
        f.env.events().all().filter_by_contract(&f.gate_id),
        std::vec![Contribution {
            contributor: f.contributor.clone(),
            amount: CONTRIBUTION,
            direct: 700_000,
            operations: 200_000,
            reserve: 100_000,
        }
        .to_xdr(&f.env, &f.gate_id)]
    );

    // 70 / 20 / 10 of 1_000_000, per the compiled-in demo policy.
    assert_eq!(gate.bucket(&Category::Direct), 700_000);
    assert_eq!(gate.bucket(&Category::Operations), 200_000);
    assert_eq!(gate.bucket(&Category::Reserve), 100_000);

    // The buckets account for every unit contributed, and the pool holds them.
    let claimed: i128 = gate.buckets().values().iter().sum();
    assert_eq!(claimed, CONTRIBUTION);
    assert_eq!(f.token().balance(&f.gate_id), CONTRIBUTION);
    assert_eq!(
        f.token().balance(&f.contributor),
        CONTRIBUTION * 10 - CONTRIBUTION
    );
}

#[test]
fn distribute_pays_out_against_a_valid_quorum() {
    let f = setup();
    let gate = f.client();
    gate.contribute(&f.contributor, &CONTRIBUTION);

    let payout: i128 = 250_000;
    let attestation = f.attestation(Category::Direct, payout, 0);
    let sigs = f.sign(&attestation, &[0, 1]);
    let expected = Disbursement {
        recipient: f.recipient.clone(),
        category: Category::Direct,
        amount: payout,
        sequence: 0,
        attestation_hash: f.attestation_hash(&attestation),
    }
    .to_xdr(&f.env, &f.gate_id);

    gate.distribute(
        &f.recipient,
        &Category::Direct,
        &payout,
        &attestation,
        &sigs,
    );

    // Immediately, and before any view call: see the note in
    // `contribute_credits_every_bucket`. The hash is built above for the same
    // reason, so that nothing runs between the call and the assertion.
    assert_eq!(
        f.env.events().all().filter_by_contract(&f.gate_id),
        std::vec![expected]
    );

    assert_eq!(f.token().balance(&f.recipient), payout);
    assert_eq!(f.token().balance(&f.gate_id), CONTRIBUTION - payout);
    assert_eq!(gate.bucket(&Category::Direct), 700_000 - payout);
    // Only the named bucket moved.
    assert_eq!(gate.bucket(&Category::Operations), 200_000);
    assert_eq!(gate.bucket(&Category::Reserve), 100_000);
    // The consumed sequence is spent, so the same attestation is now stale.
    assert_eq!(gate.distribution_seq(), 1);
}

#[test]
fn signatures_beyond_the_threshold_are_accepted() {
    let f = setup();
    let gate = f.client();
    gate.contribute(&f.contributor, &CONTRIBUTION);

    // 3-of-3 where 2 would do. The rule is "at least threshold distinct valid
    // signers", not "exactly threshold".
    let attestation = f.attestation(Category::Reserve, 50_000, 0);
    let sigs = f.sign(&attestation, &[0, 1, 2]);

    gate.distribute(
        &f.recipient,
        &Category::Reserve,
        &50_000,
        &attestation,
        &sigs,
    );

    assert_eq!(gate.bucket(&Category::Reserve), 50_000);
    assert_eq!(f.token().balance(&f.recipient), 50_000);
}

#[test]
fn consecutive_distributions_advance_the_sequence() {
    let f = setup();
    let gate = f.client();
    gate.contribute(&f.contributor, &CONTRIBUTION);

    for sequence in 0..3u64 {
        let attestation = f.attestation(Category::Operations, 10_000, sequence);
        let sigs = f.sign(&attestation, &[1, 2]);
        gate.distribute(
            &f.recipient,
            &Category::Operations,
            &10_000,
            &attestation,
            &sigs,
        );
        assert_eq!(gate.distribution_seq(), sequence + 1);
    }

    assert_eq!(gate.bucket(&Category::Operations), 200_000 - 30_000);
    assert_eq!(f.token().balance(&f.recipient), 30_000);
}

#[test]
fn a_second_contribution_accumulates() {
    let f = setup();
    let gate = f.client();

    gate.contribute(&f.contributor, &CONTRIBUTION);
    gate.contribute(&f.contributor, &CONTRIBUTION);

    assert_eq!(gate.bucket(&Category::Direct), 1_400_000);
    assert_eq!(gate.bucket(&Category::Operations), 400_000);
    assert_eq!(gate.bucket(&Category::Reserve), 200_000);
    assert_eq!(f.token().balance(&f.gate_id), CONTRIBUTION * 2);
}

#[test]
fn split_sums_to_the_input() {
    let env = Env::default();

    // Amounts chosen so the two floor-divided buckets leave a remainder that
    // the Direct bucket has to absorb. This is the hand-picked version of the
    // property the funded build should state with proptest.
    for amount in [1i128, 3, 7, 9_999, 10_000, 10_001, 123_456_789] {
        let parts = policy::split(&env, amount).unwrap();
        let sum: i128 = parts.values().iter().sum();
        assert_eq!(sum, amount, "split of {} did not sum to itself", amount);
        assert_eq!(parts.len(), 3);
    }
}

#[test]
fn a_surplus_sent_straight_to_the_pool_belongs_to_no_bucket() {
    let f = setup();
    let gate = f.client();
    gate.contribute(&f.contributor, &CONTRIBUTION);

    // Anyone can transfer the asset to the contract address without going
    // through `contribute`, and the contract cannot prevent it.
    f.token().transfer(&f.contributor, &f.gate_id, &500_000);

    // The surplus is visible in the balance and allocated to nothing, so it can
    // never be distributed. Solvency is `sum(buckets) <= balance`, not `==`.
    let claimed: i128 = gate.buckets().values().iter().sum();
    assert_eq!(claimed, CONTRIBUTION);
    assert_eq!(f.token().balance(&f.gate_id), CONTRIBUTION + 500_000);

    // And the pool still works.
    let attestation = f.attestation(Category::Direct, 700_000, 0);
    let sigs = f.sign(&attestation, &[0, 2]);
    gate.distribute(
        &f.recipient,
        &Category::Direct,
        &700_000,
        &attestation,
        &sigs,
    );
    assert_eq!(gate.bucket(&Category::Direct), 0);
}
