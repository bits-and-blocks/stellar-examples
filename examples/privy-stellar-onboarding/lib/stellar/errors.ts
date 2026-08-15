/**
 * The failure taxonomy for a contribution.
 *
 * The proposal names missing trustlines as the failure mode donors actually
 * hit, so these are modelled as distinct outcomes rather than collapsed into
 * one "transaction failed" string. Each carries what the UI needs to tell the
 * donor what to do next, which a raw Horizon or host error does not.
 */

export type ContributionFailure =
  /** An account cannot hold the asset at all until it opts in with changeTrust. */
  | { kind: "missing-trustline"; who: "donor" | "recipient"; address: string }
  /** The donor holds the asset but not enough of it. */
  | { kind: "insufficient-balance"; have: string; want: string }
  /** Soroban rejected the call before it cost anything. */
  | { kind: "simulation-failed"; detail: string }
  /** The network rejected or dropped the signed transaction. */
  | { kind: "submission-failed"; detail: string };

export class ContributionError extends Error {
  readonly failure: ContributionFailure;

  constructor(failure: ContributionFailure) {
    super(describeFailure(failure).summary);
    this.name = "ContributionError";
    this.failure = failure;
  }
}

/** Plain-language explanation and the action that resolves it. */
export function describeFailure(failure: ContributionFailure): {
  summary: string;
  remedy: string;
} {
  switch (failure.kind) {
    case "missing-trustline":
      return failure.who === "donor"
        ? {
            summary: "Your wallet has no USDC trustline.",
            remedy:
              "A Stellar account cannot hold an asset until it explicitly opts in. Run step 5 to add the trustline, which costs 0.5 XLM in reserve.",
          }
        : {
            summary: "The recipient has no USDC trustline.",
            remedy: `${failure.address} cannot receive USDC. A G-address must opt in before it can be paid; a pool contract (C-address) would not need to.`,
          };

    case "insufficient-balance":
      return {
        summary: `Not enough USDC: you have ${failure.have}, this would send ${failure.want}.`,
        remedy:
          "Claim test USDC from the Circle faucet in step 6, then refresh the balance.",
      };

    case "simulation-failed":
      return {
        summary: "Soroban rejected the call during simulation.",
        remedy:
          "Simulation runs before submission, so this cost no fee. Detail: " +
          failure.detail,
      };

    case "submission-failed":
      return {
        summary: "The transaction was signed but the network did not accept it.",
        remedy:
          "This is a network-level failure rather than a problem with the contribution itself; retrying with a fresh sequence number usually resolves it. Detail: " +
          failure.detail,
      };
  }
}
