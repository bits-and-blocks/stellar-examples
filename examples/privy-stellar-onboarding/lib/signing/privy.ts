import { Keypair, type Transaction, xdr } from "@stellar/stellar-sdk";
import { Buffer } from "buffer";
import { type Signer, SigningError } from "./signer";

/**
 * The entire Privy-specific surface area of this integration.
 *
 * Privy is a Tier 2 signer for Stellar: it holds the key and will sign an
 * arbitrary 32-byte hash along the ed25519 curve, but it knows nothing about
 * Stellar transactions. Stellar, in turn, wants signatures wrapped in a
 * `DecoratedSignature` — the raw 64 bytes plus a 4-byte hint identifying which
 * key produced them. This file is the adapter between the two.
 *
 * Two details matter and neither is obvious:
 *
 *   - `tx.hash()` is not a hash of the XDR. It hashes the *signature base*,
 *     which prepends the network passphrase. That is why a transaction built
 *     against testnet cannot be replayed on mainnet, and why this needs no
 *     network argument.
 *
 *   - The hint is the last 4 bytes of the public key, not of the signature.
 *     Stellar uses it to match a signature against an account's signers
 *     without trying each one.
 */

/** Shape of `signRawHash` from `@privy-io/react-auth/extended-chains`. */
export type RawHashSigner = (input: {
  address: string;
  chainType: "stellar";
  hash: `0x${string}`;
}) => Promise<{ signature: `0x${string}` }>;

/** A `Signer` backed by the Privy-held key for `address`. */
export function privySigner(
  address: string,
  signRawHash: RawHashSigner,
): Signer {
  return {
    address,

    async signTransaction(tx: Transaction) {
      const { signature } = await signRawHash({
        address,
        chainType: "stellar",
        hash: `0x${tx.hash().toString("hex")}`,
      });

      const raw = Buffer.from(signature.slice(2), "hex");
      if (raw.length !== 64) {
        // An ed25519 signature is always 64 bytes. Anything else means Privy
        // returned something we do not understand, and submitting it would
        // fail opaquely at Horizon as `tx_bad_auth`. Fail here instead, where
        // the cause is visible.
        throw new SigningError(
          `Privy returned a ${raw.length}-byte signature, and an ed25519 signature is always 64.`,
          "This is a bug in the integration rather than something you did. Nothing was submitted.",
        );
      }

      tx.addDecoratedSignature(
        new xdr.DecoratedSignature({
          hint: Keypair.fromPublicKey(address).signatureHint(),
          signature: raw,
        }),
      );

      // The same object it was handed, signed. The Kit implementation cannot
      // promise that, which is why the interface says to use the return value.
      return tx;
    },
  };
}
