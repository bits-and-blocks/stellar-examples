import { GithubIcon } from "./icons";

export const REPO_URL =
  "https://github.com/bits-and-blocks/privy-stellar-onboarding";

export function Footer() {
  return (
    <footer className="footer">
      <span>Open source, MIT licensed. Stellar testnet only.</span>
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
