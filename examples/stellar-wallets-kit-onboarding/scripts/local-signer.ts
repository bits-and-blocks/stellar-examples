import {
  FeeBumpTransaction,
  Keypair,
  type Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { NETWORK_PASSPHRASE } from "../lib/stellar/network";
import { type Signer, SigningError } from "../lib/signing/signer";

/**
 * A `Signer` backed by a local keypair, for `verify-contribution.mts`.
 *
 * The Kit signer this app actually ships cannot run here: it needs a browser,
 * a DOM for the Kit's modal, an installed extension, and a person to press
 * approve. So the contribution path is exercised against a key this script
 * holds instead, and what that leaves untested is exactly the part a wallet is
 * responsible for.
 *
 * It is not a bare `tx.sign(kp)`, though, because the one hazard that *is*
 * testable without an extension is the shape of the return value. A wallet is
 * handed XDR and hands back different XDR, so `signTransaction` returns a
 * transaction that is not the one it was given — and calling code that submits
 * its argument instead would submit something unsigned. Round-tripping through
 * XDR here reproduces that, so the script would catch it.
 *
 * ## Why this is a `.ts` and not part of the `.mts`
 *
 * `verify-contribution.mts` is ESM and everything under `lib/` loads as CJS
 * under tsx, which means the two get separate copies of `stellar-sdk` and
 * separate `Transaction` classes. A signer written in the script would build
 * its `xdr` objects with the ESM copy and hand them to `lib/`, where an
 * `instanceof` check inside the SDK fails. This file is CJS, so everything it
 * touches stays on the same side of that split as the code it signs for.
 *
 * That is also why it takes a secret rather than a `Keypair`: a string crosses
 * the boundary safely and a class instance does not.
 */
export function localSigner(secret: string): Signer {
  const kp = Keypair.fromSecret(secret);

  return {
    address: kp.publicKey(),

    async signTransaction(tx: Transaction) {
      const returned = TransactionBuilder.fromXDR(
        tx.toXDR(),
        NETWORK_PASSPHRASE,
      );

      if (returned instanceof FeeBumpTransaction) {
        throw new SigningError(
          "A transaction round-tripped through XDR came back as a fee bump.",
          "This is a bug in the test harness rather than in the app.",
        );
      }

      returned.sign(kp);
      return returned;
    },
  };
}
