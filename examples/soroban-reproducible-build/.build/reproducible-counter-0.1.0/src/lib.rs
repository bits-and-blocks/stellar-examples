#![no_std]
use soroban_sdk::{contract, contractimpl, symbol_short, Env, Symbol};

const COUNTER: Symbol = symbol_short!("COUNTER");

/// The subject contract. Its behaviour is beside the point — what matters is
/// that the bytes we build from this source match the bytes on testnet. Keep it
/// small: every dependency added here is another thing the rebuild has to
/// reproduce byte for byte.
#[contract]
pub struct IncrementContract;

#[contractimpl]
impl IncrementContract {
    /// Increment the stored counter and return the new value.
    pub fn increment(env: Env) -> u32 {
        let count: u32 = env.storage().instance().get(&COUNTER).unwrap_or(0) + 1;
        env.storage().instance().set(&COUNTER, &count);
        env.storage().instance().extend_ttl(50, 100);
        count
    }

    /// Read the stored counter without modifying it.
    pub fn get(env: Env) -> u32 {
        env.storage().instance().get(&COUNTER).unwrap_or(0)
    }
}

mod test;
