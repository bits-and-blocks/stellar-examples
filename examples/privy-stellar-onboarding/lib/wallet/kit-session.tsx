"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { kitSigner } from "@/lib/signing/wallets-kit";
import {
  type KitConnection,
  connectKit,
  disconnectKit,
  restoreKit,
} from "@/lib/signing/wallets-kit";
import { type Session, SessionContext } from "./session";

/**
 * The Wallets Kit session: whichever wallet the user already has.
 *
 * There is no provider component to wrap the tree in — the Kit is a set of
 * static calls, not a React library — so this is the whole of it: restore what
 * the Kit remembers, and hand the page a way to connect, disconnect, and sign.
 *
 * Mounted only in `wallets-kit` mode, which is what keeps the Kit and its
 * modal out of a Privy build entirely.
 */
export function KitSessionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [ready, setReady] = useState(false);
  const [connection, setConnection] = useState<KitConnection | null>(null);

  // The Kit keeps the active address in localStorage, so a reload should not
  // send someone back to the picker. Until this settles the page shows its
  // starting-up state rather than the signed-out one, which would otherwise
  // flash on every load for someone who is already connected.
  useEffect(() => {
    let cancelled = false;
    restoreKit().then(
      (restored) => {
        if (cancelled) return;
        setConnection(restored);
        setReady(true);
      },
      () => {
        if (cancelled) return;
        setReady(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const connect = useCallback(async () => {
    // Anything thrown here — a picker closed, a wallet on the wrong network —
    // reaches the page as a failed action and is reported there.
    setConnection(await connectKit());
  }, []);

  const disconnect = useCallback(async () => {
    await disconnectKit();
    setConnection(null);
  }, []);

  const value = useMemo<Session>(
    () => ({
      mode: "wallets-kit",
      ready,
      connected: connection !== null,
      address: connection?.address ?? null,
      label: connection?.wallet ?? "No wallet connected",
      connect,
      disconnect,
      // Nothing to create: a wallet the user already installed already has an
      // account, and this page could not make it one if it wanted to.
      createWallet: null,
      signer: connection ? kitSigner(connection.address) : null,
    }),
    [ready, connection, connect, disconnect],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}
