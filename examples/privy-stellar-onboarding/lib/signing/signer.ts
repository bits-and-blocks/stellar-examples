import type { Transaction } from "@stellar/stellar-sdk";

/**
 * One account, and the ability to get a transaction signed for it.
 *
 * The interesting thing about this interface is where it is drawn, because the
 * two implementations behind it do not sit at the same level:
 *
 *   - **Privy** is a curve-level signer. It holds an Ed25519 key and will sign
 *     any 32 bytes you hand it. It knows nothing about Stellar: not what a
 *     transaction is, not what the network passphrase does to the hash, not
 *     what a `DecoratedSignature` is. Everything from "transaction" down to
 *     "32 bytes" and back up again is ours to do.
 *
 *   - **A wallet extension** through Stellar Wallets Kit is the opposite. You
 *     hand it a transaction as XDR, the user reads and approves it in
 *     Freighter or xBull, and a signed transaction comes back. It does the
 *     hashing, the hint, and the attachment itself, and it would not let us do
 *     any of it — the key never leaves the extension.
 *
 * So the interface is drawn at the highest of the two: transaction in, signed
 * transaction out. Drawn any lower — `signHash`, say — the Kit could not
 * implement it at all, and a mode toggle between two copy-pasted flows is not
 * an abstraction. Drawn here, the Privy implementation absorbs the whole
 * hash-sign-attach dance and the Kit implementation is a delegation.
 *
 * The third implementation is in `scripts/verify-contribution.mts`: a local
 * keypair, which is how the contribution path is tested against live testnet
 * without a browser or a wallet extension anywhere near it.
 */
export type Signer = {
  /** The account this signer signs for. */
  readonly address: string;

  /**
   * Returns a transaction carrying this signer's signature.
   *
   * **Submit the return value, not the argument.** Privy signs a hash and the
   * signature is attached to the transaction it was given, so the two are the
   * same object. A wallet extension is handed XDR and returns different XDR,
   * so they are not. Code that submits the argument works in one mode and
   * silently submits an unsigned transaction in the other.
   */
  signTransaction(tx: Transaction): Promise<Transaction>;
};

/**
 * A signer that could not sign, in terms the person at the keyboard can act on.
 *
 * Kept apart from `ContributionError`, which classifies what the *network*
 * refused. This is about the wallet: a request declined in the extension, an
 * account switched under us, a signature that is not the shape it must be.
 */
export class SigningError extends Error {
  readonly remedy: string;

  constructor(summary: string, remedy = "") {
    super(summary);
    this.name = "SigningError";
    this.remedy = remedy;
  }
}
