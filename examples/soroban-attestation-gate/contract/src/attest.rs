// SPDX-License-Identifier: Apache-2.0

//! Signature threshold check.

use soroban_sdk::{Bytes, BytesN, Env, Vec};

use crate::types::{Error, SignerSig};

/// Require that at least `threshold` **distinct** authority keys signed
/// `message`.
///
/// Two rules a reader would not assume, both deliberate:
///
/// 1. **Every signature submitted must be valid.** `ed25519_verify` traps on a
///    bad signature (there is no fallible variant), so "try each and count the
///    good ones" is not available. A caller that includes a junk signature gets
///    a failed transaction, not a silently ignored entry.
/// 2. **A repeated index counts once.** Otherwise 2-of-3 could be faked by
///    submitting one signature twice.
pub fn verify_quorum(
    env: &Env,
    authority: &Vec<BytesN<32>>,
    threshold: u32,
    message: &Bytes,
    sigs: &Vec<SignerSig>,
) -> Result<(), Error> {
    let mut distinct: Vec<u32> = Vec::new(env);

    for sig in sigs.iter() {
        if sig.index >= authority.len() {
            return Err(Error::UnknownSigner);
        }
        let key = authority.get(sig.index).ok_or(Error::UnknownSigner)?;

        // Traps on failure. See rule 1 above.
        env.crypto().ed25519_verify(&key, message, &sig.signature);

        if !distinct.contains(sig.index) {
            distinct.push_back(sig.index);
        }
    }

    if distinct.len() < threshold {
        return Err(Error::ThresholdNotMet);
    }
    Ok(())
}
