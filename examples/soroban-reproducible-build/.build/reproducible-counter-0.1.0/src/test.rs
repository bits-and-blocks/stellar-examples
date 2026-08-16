#![cfg(test)]

use super::{IncrementContract, IncrementContractClient};
use soroban_sdk::Env;

#[test]
fn increments_from_zero() {
    let env = Env::default();
    let id = env.register(IncrementContract, ());
    let client = IncrementContractClient::new(&env, &id);

    assert_eq!(client.get(), 0);
    assert_eq!(client.increment(), 1);
    assert_eq!(client.increment(), 2);
    assert_eq!(client.get(), 2);
}
