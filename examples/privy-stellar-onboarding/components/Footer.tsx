import { GithubIcon } from "./icons";

/** Where this example lives now. The standalone repository it was developed in
 *  is archived. */
export const REPO_URL =
  "https://github.com/bits-and-blocks/stellar-examples/tree/main/examples/privy-stellar-onboarding";

export function Footer() {
  return (
    <footer className="footer">
      <span>Open source, Apache 2.0 licensed. Stellar testnet only.</span>
      <span className="footer-links">
        <a href={REPO_URL} target="_blank" rel="noreferrer">
          <GithubIcon />
          Source code
        </a>
        <a href="https://privy.io" target="_blank" rel="noreferrer">
          Privy
        </a>
        <a href="https://stellar.org" target="_blank" rel="noreferrer">
          Stellar
        </a>
      </span>
    </footer>
  );
}
