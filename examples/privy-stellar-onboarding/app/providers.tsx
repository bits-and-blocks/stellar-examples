"use client";

import { PrivyProvider } from "@privy-io/react-auth";

const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

export function Providers({ children }: { children: React.ReactNode }) {
  if (!appId) {
    return (
      <main>
        <h1>Missing configuration</h1>
        <p>
          <code>NEXT_PUBLIC_PRIVY_APP_ID</code> is not set. Copy{" "}
          <code>.env.example</code> to <code>.env.local</code> and add your app
          ID from the Privy dashboard, then restart the dev server.
        </p>
      </main>
    );
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email"],
        // Stellar wallets are created explicitly via useCreateWallet from
        // /extended-chains, and this config has no Tier 2 equivalent. Both
        // knobs it does have are turned off so logging in does not silently
        // mint unrelated EVM or Solana wallets alongside the one we want.
        embeddedWallets: {
          ethereum: { createOnLogin: "off" },
          solana: { createOnLogin: "off" },
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
