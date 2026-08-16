"use client";

import { useMemo } from "react";
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import {
  useCreateWallet,
  useSignRawHash,
} from "@privy-io/react-auth/extended-chains";
import { findStellarWallet } from "@/lib/privy/stellar-wallet";
import { privySigner } from "@/lib/signing/privy";
import { type Session, SessionContext } from "./session";

/**
 * The Privy session: an email address, an embedded wallet Privy custodies, and
 * a key that signs hashes on request.
 *
 * Mounted only in `privy` mode, so nothing here runs — and no Privy app ID is
 * needed — in a Wallets Kit build.
 */
export function PrivySessionProvider({
  appId,
  children,
}: {
  appId: string;
  children: React.ReactNode;
}) {
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
      <CurrentSession>{children}</CurrentSession>
    </PrivyProvider>
  );
}

function CurrentSession({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { createWallet } = useCreateWallet();
  const { signRawHash } = useSignRawHash();

  const address = findStellarWallet(user)?.address ?? null;
  const label = user?.email?.address ?? user?.id ?? "Signed in";

  const value = useMemo<Session>(
    () => ({
      mode: "privy",
      ready,
      connected: authenticated,
      address,
      label,
      connect: async () => {
        // Privy's login resolves once the modal is up rather than once someone
        // has finished with it. Nothing to report either way: the page changes
        // by itself when the session does.
        login();
      },
      disconnect: () => logout(),
      createWallet: async () => {
        await createWallet({ chainType: "stellar" });
      },
      signer: address ? privySigner(address, signRawHash) : null,
    }),
    [
      ready,
      authenticated,
      address,
      label,
      login,
      logout,
      createWallet,
      signRawHash,
    ],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}
