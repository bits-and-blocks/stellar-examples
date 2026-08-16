import type { Transaction } from "@stellar/stellar-sdk";

/**
 * One account, and the ability to get a transaction signed for it.
 *
 * Privy is a curve-level signer. It holds an Ed25519 key and will sign any 32
 * bytes you hand it, and it knows nothing about Stellar: not what a
 * transaction is, not what the network passphrase does to the hash, not what a
 * `DecoratedSignature` is. Everything from "transaction" down to "32 bytes"
 * and back up again is ours to do.
 *
 * This interface is drawn above all of that — transaction in, signed
 * transaction out — rather than at `signHash`, where Privy sits. Two reasons,
 * and only the first is about this example:
 *
 *   - Every caller in `lib/stellar/` wants a signed transaction. Drawn at
 *     `signHash`, each of them would repeat the hash-sign-attach dance, and
 *     the *sign after preparing* rule would be four opportunities to get it
 *     wrong instead of one.
 *
 *   - A wallet extension could not implement anything lower. Handed a
 *     transaction as XDR, it hashes, signs, attaches and returns signed XDR,
 *     and the key never leaves it. Drawn here, swapping one for the other is a
 *     different implementation of the same interface — which is exactly what
 *     the sibling `stellar-wallets-kit-onboarding` example is.
 *
 * The second implementation here is in `scripts/verify-contribution.mts`: the
 * real `privySigner`, handed a local keypair in place of Privy's service,
 * which is how the contribution path is tested against live testnet.
 */
export type Signer = {
  /** The account this signer signs for. */
  readonly address: string;

  /**
   * Returns a transaction carrying this signer's signature.
   *
   * **Submit the return value, not the argument.** Privy signs a hash and the
   * signature is attached to the transaction it was given, so here the two
   * happen to be the same object. That is not part of the contract, and a
   * signer that hands back different XDR — any wallet extension does — would
   * leave code that submits the argument submitting something unsigned.
   */
  signTransaction(tx: Transaction): Promise<Transaction>;
};

/**
 * A signer that could not sign, in terms the person at the keyboard can act on.
 *
 * Kept apart from `ContributionError`, which classifies what the *network*
 * refused. This is about the wallet: a signature that is not the shape it must
 * be, or a signing service that would not answer.
 */
export class SigningError extends Error {
  readonly remedy: string;

  constructor(summary: string, remedy = "") {
    super(summary);
    this.name = "SigningError";
    this.remedy = remedy;
  }
}
