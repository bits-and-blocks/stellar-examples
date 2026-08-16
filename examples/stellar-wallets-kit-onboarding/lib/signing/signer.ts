import type { Transaction } from "@stellar/stellar-sdk";

/**
 * One account, and the ability to get a transaction signed for it.
 *
 * The level this is drawn at is set by what a wallet extension can actually
 * do. You hand it a transaction as XDR, the user reads and approves it in
 * Freighter or xBull, and a signed transaction comes back. It does the
 * hashing, the hint and the attachment itself, and it would not let you do any
 * of it — the key never leaves the extension. So the interface is transaction
 * in, signed transaction out, and nothing lower is available to draw it at.
 *
 * That matters when the wallet is not the only signer you ever want. A
 * curve-level signer — a local `Keypair`, or a custodial service that signs 32
 * bytes on request, as in the sibling `privy-stellar-onboarding` example — can
 * always be lifted up to this shape by doing the hash-sign-attach dance
 * itself. The reverse is impossible. Drawn at `signHash`, an extension could
 * not implement this at all.
 *
 * There are two implementations here: `wallets-kit.ts`, which the app uses,
 * and a local keypair in `scripts/verify-contribution.mts`, which is how the
 * contribution path is tested against live testnet with no browser and no
 * extension anywhere near it.
 */
export type Signer = {
  /** The account this signer signs for. */
  readonly address: string;

  /**
   * Returns a transaction carrying this signer's signature.
   *
   * **Submit the return value, not the argument.** A wallet extension is
   * handed XDR and returns different XDR, so the transaction that comes back
   * is a different object from the one that went in. Code that submits the
   * argument submits an unsigned transaction — and it is a quiet bug, because
   * a signer that mutates in place (a local `Keypair`, a raw-hash service)
   * makes exactly the same code work.
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
