"use client";

import { createContext, useContext } from "react";
import type { Signer } from "@/lib/signing/signer";

/**
 * Everything the page knows about whose wallet it is working with.
 *
 * The page is written against this and nothing else: no Kit import, no
 * `StellarWalletsKit` call, no knowledge of which extension answered. That
 * keeps every Kit call in `lib/signing/wallets-kit.ts` and this file's
 * provider, which is what makes the Kit's surface area easy to read off and
 * easy to swap.
 */
export type Session = {
  /** The wallet layer has started and restored whatever it remembers. */
  ready: boolean;

  /** A wallet is connected. */
  connected: boolean;

  /**
   * The account the connected wallet is currently exposing.
   *
   * Non-null exactly when `connected` is true: an extension arrives with an
   * account already, so there is no connected-but-address-less state to model.
   * (A custodial signer such as Privy does have one — the wallet is created in
   * a second step — which is the one place the two shapes genuinely differ.)
   */
  address: string | null;

  /** What the account bar shows: the wallet's name for itself. */
  label: string;

  /** Open the Kit's wallet picker. */
  connect: () => Promise<void>;

  /** Forget the connected wallet. */
  disconnect: () => Promise<void>;

  /** How this session signs, once there is an account to sign for. */
  signer: Signer | null;
};

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) {
    throw new Error("useSession must be used inside a wallet provider.");
  }
  return session;
}
