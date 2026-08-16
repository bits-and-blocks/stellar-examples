"use client";

import { KitSessionProvider } from "@/lib/wallet/kit-session";

/**
 * Mounts the wallet session.
 *
 * There is nothing to configure and nothing that can be misconfigured: no app
 * ID, no API key, no account with anybody. The wallet is already installed in
 * the browser or it is not, and that is discovered at connect time rather than
 * read from the environment — so this file has no error state to render.
 *
 * The sibling example, `privy-stellar-onboarding`, needs a `NEXT_PUBLIC_`
 * app ID here and checks for it before mounting anything. That difference is
 * the whole of what a custodial signer costs you in configuration.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return <KitSessionProvider>{children}</KitSessionProvider>;
}
