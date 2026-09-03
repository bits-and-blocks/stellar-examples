# stellar-sponsored-onboarding

**Requirements:** A donor reaches a funded, transacting Stellar account
without ever holding XLM. The sponsor pays every reserve and every fee. The
donor owns every entry and signs for all of it.

Two different problems stand between a new donor and their first transfer, and
they are solved by two different mechanisms. Conflating them is the reason
"gasless onboarding" demos tend to work right up until the donor tries to do
something.

| | |
| --- | --- |
| Reserves | Sponsored reserves, CAP-33 |
| Fees | Fee-bump transactions, CAP-15 |
| Network | testnet |
| Donor's XLM balance, start to finish | `0` |

## Reserves are not fees

**The base reserve is a balance requirement. The transaction fee is a payment.**
Sponsorship moves the first onto the sponsor. It does nothing at all about the
second.

So an account can be sponsored into existence, hold a USDC trustline it did not
pay for, hold a USDC balance, and still be unable to send a single transaction,
because 100 stroops is 100 stroops and the donor has none. That account looks
fully onboarded in a wallet and is inert. The fee-bump is what finishes the job,
and it is a separate envelope with a separate signer.

This example exists to make that boundary concrete: the sponsorship half, the
fee-bump half, and a verification step that proves the donor's XLM balance is
still exactly zero after a transfer has landed.

## The sponsorship sandwich

Sponsorship is a bracket around the operations that create ledger entries, and
both accounts have to be inside it:

| # | Operation | Source | Why |
| --- | --- | --- | --- |
| 1 | `BeginSponsoringFutureReserves`, sponsored id is the donor | sponsor | Opens the bracket. |
| 2 | `CreateAccount`, destination donor, starting balance `0` | sponsor | Legal only inside the bracket. |
| 3 | `ChangeTrust`, testnet USDC | donor | The trustline entry the donor will own. |
| 4 | `EndSponsoringFutureReserves` | donor | The donor's consent. Closes the bracket. |

**Both accounts sign the transaction, either may submit it.** The sandwich
exists precisely so that sponsorship cannot be imposed: the sponsor has to open
it and the donor has to close it, and a transaction missing either half is
invalid.

Two things here surprise people, and both are worth a test rather than a
sentence:

- **A starting balance of `0` is only valid inside the bracket.** Outside it,
  `CreateAccount` has to fund the new account to at least the base reserve.
- **The donor signs for an account that does not exist yet.** The keypair is
  real, the ledger entry is not, and the signature is checked against the
  account the same transaction is in the middle of creating.

Afterwards the reserve is visible on both sides: `num_sponsoring` on the
sponsor, `num_sponsored` on the donor, and the donor's minimum balance is
unchanged at zero.

## The fee-bump

The donor builds and signs an inner transaction. The sponsor wraps it:

- The outer envelope's fee source is the sponsor. The inner transaction's source
  is the donor.
- **The inner transaction must already be signed.** A fee-bump wraps a
  transaction, it does not re-sign one, which is the whole reason the donor's
  authorization survives the wrapping intact.
- The outer fee has to cover one more operation than the inner transaction
  contains, and be at least the inner fee. A fee-bump has an effective operation
  count of the inner count plus one, and it is charged accordingly.

This also settles the Soroban question. Contract calls cost resource fees, and
resource fees are transaction fees, so the fee-bump covers them. Sponsorship
does not and never could: it is a classic ledger entry mechanism, and Soroban
contract state is rented, not reserved. A donor calling a contract is paid for
by the outer envelope, not by the sponsorship.

## The exit, which is the sponsor's alone

`RevokeSponsorship` transfers a sponsored entry to a new sponsor or hands it
back to the account that owns it. **The donor is not a party to it.** Revocation
is unilateral by design.

That has a consequence this example has to state rather than skip: if the
sponsor revokes and the donor cannot cover the reserve itself, the revocation
fails, and the donor's entries stay sponsored. So the sponsor cannot strand the
donor, but neither can it walk away from the reserve at will. Both directions
get a test.

## The failure cases are the deliverable

Every sponsorship write-up shows the sandwich. The four below are where a real
integration actually breaks, and each gets a distinct, readable failure rather
than a raw transaction result code:

| Case | What the reader should see |
| --- | --- |
| Sponsor cannot cover the reserves it is taking on | Which entry it ran out on, and the balance it needed. |
| `EndSponsoringFutureReserves` unsigned by the donor | Named as a missing consent, not as a generic bad auth. |
| Fee-bump fee below the inner count plus one | The arithmetic, with both numbers. |
| Revocation against a donor holding nothing | The revocation refused, and the reason it is refused. |

At least one has to be reachable on demand, so a reviewer can watch it fail
honestly.

## Verification

The claim is "the donor never holds XLM", so the run ends by proving it rather
than asserting it. After the transfer lands, print and assert:

- The donor's XLM balance is exactly `0`.
- The donor holds a USDC trustline, and a USDC balance that moved.
- `num_sponsored` on the donor equals the entries the sponsor took on.
- `num_sponsoring` on the sponsor matches.

## Run it

```bash
cd examples/stellar-sponsored-onboarding
cp .env.example .env
npm install
npm run onboard   # sponsor, sandwich, fee-bumped transfer, then the assertions
npm run verify    # the assertions alone, against an existing donor address
```

Scripts and printed output rather than a page, deliberately. The interesting
part of this example is the shape of a transaction, and a button hides it. The
cost of that choice is that there is no live demo link for this one, unlike its
two siblings.

## Where this sits

[privy-stellar-onboarding](../privy-stellar-onboarding) and
[stellar-wallets-kit-onboarding](../stellar-wallets-kit-onboarding) answer the
question of *who signs*: a custodied embedded key, or a wallet the user already
has. This one answers *who pays*, and it composes with either. The donor here
can be a Privy wallet or a Freighter user without changing a line of the
sponsorship.

## What this example deliberately omits

- **No mainnet.** Testnet passphrase pinned in code.
- **No sponsor key management.** The sponsor is a testnet keypair from `.env`.
  A real sponsor is a funded, monitored, rate-limited account with an operational
  story behind it, and that story is not a Stellar problem.
- **No abuse controls.** Anything that funds strangers gets drained by
  strangers. Who is allowed to be sponsored is an application question.
- **No claimable balances, offers, data entries or extra signers**, all of which
  are sponsorable. One account and one trustline show the mechanism; the fifth
  entry type teaches nothing the first two did not.

## What this does not prove

- **That the donor is independent.** They hold their keys and own their entries,
  and they rely on the sponsor for every fee. Stop paying and the account is
  still theirs and still cannot move.
- **That the sponsor is solvent.** `num_sponsoring` grows with every donor, and
  the reserve is locked, not spent. A sponsor that onboards without watching
  that number is accruing a liability it can only settle by revoking.

## Resources

- [Sponsored reserves](https://developers.stellar.org/docs/build/guides/transactions/sponsored-reserves),
  the sandwich, the sponsorable entry types, and revocation
- [CAP-0033](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0033.md),
  the protocol change itself, for `numSponsoring` and `numSponsored` semantics
- [Fee-bump transactions](https://developers.stellar.org/docs/build/guides/transactions/fee-bump-transactions)
  and [CAP-0015](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0015.md)
- [Base reserves and minimum balance](https://developers.stellar.org/docs/learn/fundamentals/lumens)
- [`@stellar/stellar-sdk`](https://stellar.github.io/js-stellar-sdk/),
  `TransactionBuilder.buildFeeBumpTransaction` and the sponsorship operations
