"use client";

import { KitSessionProvider } from "@/lib/wallet/kit-session";
import {
  CONFIGURED_WALLET_MODE,
  WALLET_MODE,
  WALLET_MODES,
} from "@/lib/wallet/mode";
import { PrivySessionProvider } from "@/lib/wallet/privy-session";

const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

/**
 * Mounts the session for the configured mode, and only that one.
 *
 * Both branches supply the same `Session`, so everything below this point is
 * written once, and only one of them is ever mounted: a Wallets Kit build
 * never constructs a `PrivyProvider` and needs no Privy app ID.
 *
 * Mounting is not bundling, though. Both providers are imported statically
 * here, so both SDKs ship in either build — the Kit's weight sits behind the
 * dynamic import in `lib/signing/wallets-kit.ts` and is never fetched in Privy
 * mode, but Privy's is loaded in both. Lazy-loading each provider would fix
 * that; see the README.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  if (WALLET_MODE === null) {
    return (
      <Misconfigured>
        <p>
          <code>NEXT_PUBLIC_WALLET_MODE</code> is set to{" "}
          <code>{CONFIGURED_WALLET_MODE}</code>, which is not a mode. Use{" "}
          <code>{WALLET_MODES[0]}</code> or <code>{WALLET_MODES[1]}</code>, or
          leave it unset for Privy.
        </p>
      </Misconfigured>
    );
  }

  if (WALLET_MODE === "wallets-kit") {
    return <KitSessionProvider>{children}</KitSessionProvider>;
  }

  if (!appId) {
    return (
      <Misconfigured>
        <p>
          <code>NEXT_PUBLIC_PRIVY_APP_ID</code> is not set. Copy{" "}
          <code>.env.example</code> to <code>.env.local</code> and add your app
          ID from the Privy dashboard, then restart the dev server.
        </p>
        <p>
          Or set <code>NEXT_PUBLIC_WALLET_MODE=wallets-kit</code> to run against
          a browser wallet instead, which needs no app ID.
        </p>
      </Misconfigured>
    );
  }

  return <PrivySessionProvider appId={appId}>{children}</PrivySessionProvider>;
}

function Misconfigured({ children }: { children: React.ReactNode }) {
  return (
    <main className="shell">
      <h1>Missing configuration</h1>
      {children}
    </main>
  );
}
