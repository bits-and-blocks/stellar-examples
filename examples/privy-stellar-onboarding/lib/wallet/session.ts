"use client";

import { createContext, useContext } from "react";
import type { Signer } from "@/lib/signing/signer";
import type { WalletMode } from "./mode";

/**
 * Everything the page knows about whose wallet it is working with.
 *
 * The page is written against this and nothing else: no `usePrivy`, no Kit
 * import, no branch on which one is running except where the two genuinely
 * differ in what they can offer. Both modes fill this in, and the parts that
 * cannot be made to line up are stated as such rather than faked — see
 * `createWallet`.
 */
export type Session = {
  mode: WalletMode;

  /** The wallet layer has started and restored whatever it remembers. */
  ready: boolean;

  /** Somebody is here: signed in with Privy, or a wallet is connected. */
  connected: boolean;

  /**
   * The account, once there is one.
   *
   * The two modes differ here and it is not worth papering over: Privy has a
   * signed-in state with no wallet yet, because the embedded wallet is created
   * in a second step. A connected extension always has an address already.
   */
  address: string | null;

  /** What the account bar shows: an email address, or a wallet's name. */
  label: string;

  /** Sign in, or open the wallet picker. */
  connect: () => Promise<void>;

  /** Sign out, or forget the connected wallet. */
  disconnect: () => Promise<void>;

  /**
   * Step 1, or null in a mode that has no such step.
   *
   * Privy creates the embedded wallet on request, which is the one thing in
   * this flow with no counterpart on the other side: you cannot create a
   * Freighter account from a web page, and the address is already in hand by
   * the time the picker closes. Null says that plainly, and the page renders
   * the step as already done rather than offering a button that would have to
   * lie about what it did.
   */
  createWallet: (() => Promise<void>) | null;

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
