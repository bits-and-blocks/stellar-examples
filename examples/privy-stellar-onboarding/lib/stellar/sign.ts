import { Keypair, Transaction, xdr } from "@stellar/stellar-sdk";
import { Buffer } from "buffer";

/**
 * The entire Privy-specific surface area of this integration.
 *
 * Privy is a Tier 2 signer for Stellar: it holds the key and will sign an
 * arbitrary 32-byte hash along the ed25519 curve, but it knows nothing about
 * Stellar transactions. Stellar, in turn, wants signatures wrapped in a
 * `DecoratedSignature` — the raw 64 bytes plus a 4-byte hint identifying which
 * key produced them. This function is the adapter between the two.
 *
 * Two details matter and neither is obvious:
 *
 *   - `tx.hash()` is not a hash of the XDR. It hashes the *signature base*,
 *     which prepends the network passphrase. That is why a transaction built
 *     against testnet cannot be replayed on mainnet, and why this function
 *     needs no network argument.
 *
 *   - The hint is the last 4 bytes of the public key, not of the signature.
 *     Stellar uses it to match a signature against an account's signers
 *     without trying each one.
 *
 * Swapping Privy for another signer — Stellar Wallets Kit, say — means
 * replacing this file and nothing else.
 */

/** Shape of `signRawHash` from `@privy-io/react-auth/extended-chains`. */
export type RawHashSigner = (input: {
  address: string;
  chainType: "stellar";
  hash: `0x${string}`;
}) => Promise<{ signature: `0x${string}` }>;

/** Signs `tx` in place with the Privy-held key for `address`. */
export async function signWithPrivy(
  tx: Transaction,
  address: string,
  signRawHash: RawHashSigner,
): Promise<Transaction> {
  const { signature } = await signRawHash({
    address,
    chainType: "stellar",
    hash: `0x${tx.hash().toString("hex")}`,
  });

  const raw = Buffer.from(signature.slice(2), "hex");
  if (raw.length !== 64) {
    // An ed25519 signature is always 64 bytes. Anything else means Privy
    // returned something we do not understand, and submitting it would fail
    // opaquely at Horizon as `tx_bad_auth`. Fail here instead, where the cause
    // is visible.
    throw new Error(
      `Expected a 64-byte ed25519 signature from Privy, got ${raw.length} bytes.`,
    );
  }

  tx.addDecoratedSignature(
    new xdr.DecoratedSignature({
      hint: Keypair.fromPublicKey(address).signatureHint(),
      signature: raw,
    }),
  );

  return tx;
}
