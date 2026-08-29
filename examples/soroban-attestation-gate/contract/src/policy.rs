// SPDX-License-Identifier: Apache-2.0

//! The allocation split: a pure function of an amount, with no storage and no
//! env state beyond the `&Env` a `Map` needs.
//!
//! It is a fixed demo policy compiled into the contract. Where allocation
//! policy properly lives, in a separate governed contract that the pool treats
//! as untrusted, is the subject of the sibling three-contract skeleton example.

use soroban_sdk::{Env, Map};

use crate::types::{Category, Error};

/// Basis points per bucket. Must sum to [`BPS_TOTAL`].
pub const BPS_DIRECT: i128 = 7_000;
pub const BPS_OPERATIONS: i128 = 2_000;
pub const BPS_RESERVE: i128 = 1_000;
pub const BPS_TOTAL: i128 = 10_000;

// `Direct` takes the remainder rather than its own floor-division, so its basis
// points are never read at runtime. They are declared anyway, and checked here
// at compile time, because a policy whose shares do not add up should not build.
const _: () = assert!(BPS_DIRECT + BPS_OPERATIONS + BPS_RESERVE == BPS_TOTAL);

/// Split `amount` across the three buckets.
///
/// Integer division truncates, so computing all three parts by floor-division
/// would usually sum to slightly *less* than `amount`. Instead the two smaller
/// buckets are floor-divided and `Direct` takes the remainder, which makes the
/// total exact by construction rather than by luck.
///
/// The sum is then asserted anyway. That assert is unreachable if this function
/// is right. It stays because "unreachable" is a claim about today's code.
pub fn split(env: &Env, amount: i128) -> Result<Map<Category, i128>, Error> {
    if amount <= 0 {
        return Err(Error::InvalidAmount);
    }

    let operations = bps(amount, BPS_OPERATIONS)?;
    let reserve = bps(amount, BPS_RESERVE)?;
    let direct = amount
        .checked_sub(operations)
        .and_then(|rest| rest.checked_sub(reserve))
        .ok_or(Error::Overflow)?;

    let mut parts = Map::new(env);
    parts.set(Category::Direct, direct);
    parts.set(Category::Operations, operations);
    parts.set(Category::Reserve, reserve);

    let mut sum: i128 = 0;
    for part in parts.values().iter() {
        sum = sum.checked_add(part).ok_or(Error::Overflow)?;
    }
    if sum != amount {
        return Err(Error::SplitMismatch);
    }

    Ok(parts)
}

/// `amount * bps / 10_000`, with the multiply checked.
///
/// `amount * 10_000` overflows `i128` only at absurd values, but "absurd" is
/// not a security boundary, so it returns an error rather than wrapping. The
/// release profile sets `overflow-checks = true` as the backstop for the
/// arithmetic that forgets to be explicit.
fn bps(amount: i128, bps: i128) -> Result<i128, Error> {
    amount
        .checked_mul(bps)
        .map(|scaled| scaled / BPS_TOTAL)
        .ok_or(Error::Overflow)
}
