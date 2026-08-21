/**
 * Formatting shared by everything that has to put a number or an address in
 * front of a person.
 *
 * It lives on its own so that a decoder never has to import from the
 * transaction-meta renderer, or the other way round. The two know nothing
 * about each other; they only agree on how a stroop looks.
 */

/**
 * Classic amounts are 7-decimal fixed point, and so is a Stellar Asset
 * Contract balance for the same asset — it is the same asset, in contract
 * storage instead of a trustline. A token that is not a SAC picks its own
 * number of decimals, so callers that have not established what they are
 * holding should print the integer and leave it at that.
 */
export const STROOP_DECIMALS = 7;

export function formatStroops(value: bigint): string {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const base = 10n ** BigInt(STROOP_DECIMALS);
  const whole = (magnitude / base).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = (magnitude % base).toString().padStart(STROOP_DECIMALS, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/** `1000000000` -> `100.0000000 (1000000000)` */
export const formatAmount = (value: bigint): string =>
  `${formatStroops(value)} (${value.toString()})`;

/** `GBRMGCKG…RTUS`. Long enough to recognise, short enough to sit in a line. */
export const short = (value: string, keep = 4): string =>
  value.length > keep * 2 + 3 ? `${value.slice(0, keep + 1)}…${value.slice(-keep)}` : value;
