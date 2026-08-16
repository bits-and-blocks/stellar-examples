"use client";

import { PrivySessionProvider } from "@/lib/wallet/privy-session";

const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

/**
 * Mounts the wallet session.
 *
 * The app ID is the one piece of configuration this example cannot supply a
 * default for, and a missing one fails deep inside Privy's provider rather
 * than anywhere useful — so it is checked here and said on the page, in terms
 * that name the file to edit.
 *
 * It is a public identifier rather than a secret: it ships in the client
 * bundle by design, and Privy scopes it with an allowed-origins list from the
 * dashboard. There is no `PRIVY_APP_SECRET` anywhere in this project, because
 * wallet creation and signing both happen in the browser.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  if (!appId) {
    return (
      <main className="shell">
        <h1>Missing configuration</h1>
        <p>
          <code>NEXT_PUBLIC_PRIVY_APP_ID</code> is not set. Copy{" "}
          <code>.env.example</code> to <code>.env.local</code> and add your app
          ID from the Privy dashboard, then restart the dev server.
        </p>
      </main>
    );
  }

  return <PrivySessionProvider appId={appId}>{children}</PrivySessionProvider>;
}
