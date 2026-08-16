"use client";

import { createContext, useContext } from "react";
import type { Signer } from "@/lib/signing/signer";

/**
 * Everything the page knows about whose wallet it is working with.
 *
 * The page is written against this and nothing else: no `usePrivy`, no
 * `useSignRawHash`, no knowledge that Privy is what is behind it. That keeps
 * every Privy call in this directory and `lib/signing/privy.ts`, which is what
 * makes the integration's surface area easy to read off and easy to swap.
 */
export type Session = {
  /** The wallet layer has started and restored whatever it remembers. */
  ready: boolean;

  /** Somebody is signed in. */
  connected: boolean;

  /**
   * The account, once there is one.
   *
   * Null while signed in but before step 1: Privy has a signed-in state with
   * no wallet yet, because the embedded wallet is created on request rather
   * than at login. (A browser extension has no such state — it arrives with an
   * account already, which is the one place the two shapes genuinely differ.
   * See the sibling `stellar-wallets-kit-onboarding` example.)
   */
  address: string | null;

  /** What the account bar shows: the signed-in email address. */
  label: string;

  /** Sign in. */
  connect: () => Promise<void>;

  /** Sign out. */
  disconnect: () => Promise<void>;

  /** Step 1: create the embedded Stellar wallet. */
  createWallet: () => Promise<void>;

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
