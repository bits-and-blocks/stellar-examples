import { Asset, Networks } from "@stellar/stellar-sdk";
import { NETWORK_PASSPHRASE } from "./network";

/**
 * Circle's testnet USDC. Verified rather than assumed: this issuer publishes
 * `home_domain: centre.io` and carries ~55k trustlines on testnet, and its
 * Stellar Asset Contract is already deployed, so contributions do not need a
 * SAC deployment step first.
 *
 *   issuer      GBBD47IF…AQH3ZLLFLA5
 *   SAC         CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
 *   faucet      https://faucet.circle.com  (20 USDC per address per 2 hours)
 */
export const CIRCLE_TESTNET_USDC_ISSUER =
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

/**
 * Overridable so the brief's fallback is a config change rather than a code
 * change: if Circle's faucet is flaky, point these at a demo asset from a
 * throwaway issuer and everything downstream behaves identically, because the
 * SAC is generated per-asset by the protocol and does not vary. The automated
 * contribution tests use exactly that, which is why they can mint their own
 * supply and still exercise the real code path.
 */
export const USDC_ISSUER =
  process.env.NEXT_PUBLIC_ASSET_ISSUER ?? CIRCLE_TESTNET_USDC_ISSUER;

export const USDC_CODE = process.env.NEXT_PUBLIC_ASSET_CODE ?? "USDC";

export const USDC = new Asset(USDC_CODE, USDC_ISSUER);

/**
 * The SAC address is derived from the asset and the network passphrase, not
 * configured. Deriving it means a wrong-network build cannot silently talk to
 * the wrong contract — it would compute an address that does not exist.
 */
export const USDC_SAC_ID = USDC.contractId(NETWORK_PASSPHRASE as Networks);

/** Both classic Stellar and the SAC represent USDC with 7 decimal places. */
export const USDC_DECIMALS = 7;

/**
 * Where contributions go.
 *
 * Interim target: a plain G-address that already holds a USDC trustline, so
 * this phase does not block on the pool contract. Final target: the minimal
 * pool contract, a C-address, supplied through this same variable.
 *
 * The distinction matters for one reason only, handled in `preflight`: a
 * G-address recipient must hold a USDC trustline before it can receive the
 * asset, and a C-address recipient never needs one, because contract balances
 * live in contract storage rather than in a trustline.
 */
export const POOL_ADDRESS =
  process.env.NEXT_PUBLIC_POOL_ADDRESS ??
  "GCVNURGF7ZGJHWV5GLDET2NDEDOZFSWB3SQIA3EMGL2YWZZXJHIU3KQC";

export const isContractAddress = (address: string) => address.startsWith("C");

/**
 * Where the signing check in step 3 sends its 1 XLM.
 *
 * It used to pay the wallet itself, which left the balance untouched but also
 * made the step read as a trick rather than as a payment. Paying someone else
 * exercises the same signature over a transfer that actually moves, and on
 * testnet the XLM it moves is worth nothing.
 */
export const SIGNING_CHECK_PAYEE =
  "GDMDW3743F2HCWLXZ3UAS4QWVKNKXT4PWVG2BWATN3WFER3M7SB7MM3S";

/** Who that address belongs to, as the buttons and notes refer to them. */
export const SIGNING_CHECK_PAYEE_NAME = "Rayan";

/** "1.5" -> 15000000n. Rejects more precision than the asset can represent. */
export function toStroops(amount: string): bigint {
  const trimmed = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`"${amount}" is not a valid amount.`);
  }
  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > USDC_DECIMALS) {
    throw new Error(
      `USDC supports at most ${USDC_DECIMALS} decimal places; "${amount}" has ${fraction.length}.`,
    );
  }
  return BigInt(whole + fraction.padEnd(USDC_DECIMALS, "0"));
}

/** 15000000n -> "1.5" */
export function fromStroops(stroops: bigint): string {
  const base = 10n ** BigInt(USDC_DECIMALS);
  const whole = stroops / base;
  const fraction = (stroops % base).toString().padStart(USDC_DECIMALS, "0");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole.toString();
}
