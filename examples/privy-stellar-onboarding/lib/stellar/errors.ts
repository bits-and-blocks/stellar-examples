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

/**
 * Plain-language explanation and the action that resolves it. `detail` is the
 * network's own words, kept apart from ours so the UI can set it verbatim in
 * monospace rather than passing it off as a sentence we wrote.
 */
export function describeFailure(failure: ContributionFailure): {
  summary: string;
  remedy: string;
  detail?: string;
} {
  switch (failure.kind) {
    case "missing-trustline":
      return failure.who === "donor"
        ? {
            summary: "Your wallet cannot hold USDC yet.",
            remedy:
              "Stellar makes you switch a token on before your wallet can hold it. Go back to step 4 and switch on USDC. It sets aside 0.5 XLM, which you get back if you ever switch it off.",
          }
        : {
            summary: "The pool cannot receive USDC.",
            remedy: `${failure.address} has not switched USDC on, so nobody can pay it. A regular Stellar address has to opt in first. A pool contract would not.`,
          };

    case "insufficient-balance":
      return {
        summary: `Not enough USDC. You have ${failure.have} and this would send ${failure.want}.`,
        remedy:
          "Claim free test USDC from the Circle faucet in step 5, then check your balance again.",
      };

    case "simulation-failed":
      return {
        summary: "Stellar checked this transaction and turned it down.",
        remedy:
          "The check runs before anything is sent, so it cost you nothing. Here is what came back:",
        detail: failure.detail,
      };

    case "submission-failed":
      return {
        summary: "Your transaction was signed but the network did not take it.",
        remedy:
          "This is a network problem rather than something wrong with your contribution. Trying again usually works. Here is what came back:",
        detail: failure.detail,
      };
  }
}
