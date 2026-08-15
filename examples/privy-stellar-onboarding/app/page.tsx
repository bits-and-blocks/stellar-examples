import {
  FRIENDBOT_URL,
  HORIZON_URL,
  NETWORK_PASSPHRASE,
  SOROBAN_RPC_URL,
} from "@/lib/stellar/network";

export default function Home() {
  return (
    <main>
      <h1>Privy → Stellar onboarding</h1>
      <p style={{ color: "var(--muted)", marginTop: 0 }}>
        Email login to funded testnet contribution in one flow. Phase 0:
        scaffold and network configuration only — no wallet integration yet.
      </p>

      <h2>Network</h2>
      <dl>
        <dt>Passphrase</dt>
        <dd className="mono">{NETWORK_PASSPHRASE}</dd>

        <dt>Horizon</dt>
        <dd className="mono">{HORIZON_URL}</dd>

        <dt>Soroban RPC</dt>
        <dd className="mono">{SOROBAN_RPC_URL}</dd>

        <dt>Friendbot</dt>
        <dd className="mono">{FRIENDBOT_URL}</dd>
      </dl>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
        These are literals in{" "}
        <code>lib/stellar/network.ts</code>, not environment variables. There is
        no configuration path that points this app at mainnet.
      </p>
    </main>
  );
}
