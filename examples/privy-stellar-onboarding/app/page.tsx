"use client";

import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import {
  useCreateWallet,
  useSignRawHash,
} from "@privy-io/react-auth/extended-chains";
import {
  Asset,
  BASE_FEE,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { findStellarWallet } from "@/lib/privy/stellar-wallet";
import {
  fundWithFriendbot,
  getXlmBalance,
  horizon,
} from "@/lib/stellar/horizon";
import {
  NETWORK_PASSPHRASE,
  explorerAccountUrl,
  explorerTxUrl,
} from "@/lib/stellar/network";
import { signWithPrivy } from "@/lib/stellar/sign";

export default function Home() {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { createWallet } = useCreateWallet();
  const { signRawHash } = useSignRawHash();

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const wallet = findStellarWallet(user);
  const address = wallet?.address ?? null;

  const note = (message: string) =>
    setLog((entries) => [
      ...entries,
      `${new Date().toLocaleTimeString()}  ${message}`,
    ]);

  const refreshBalance = useCallback(async (target: string) => {
    setBalance(await getXlmBalance(target));
  }, []);

  // Load the balance once an address exists, so a returning user sees their
  // funded account without having to press anything. The cancelled flag keeps
  // a slow response for an old address from overwriting a newer one.
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    getXlmBalance(address).then(
      (value) => {
        if (!cancelled) setBalance(value);
      },
      () => {
        if (!cancelled) setBalance(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [address]);

  /** Wraps an action so every failure surfaces instead of vanishing into a console. */
  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await action();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      note(`✗ ${label} failed: ${message}`);
    } finally {
      setBusy(null);
    }
  };

  const onCreateWallet = () =>
    run("Creating wallet", async () => {
      const { wallet: created } = await createWallet({ chainType: "stellar" });
      note(`✓ Stellar wallet created: ${created.address}`);
    });

  const onFund = () =>
    run("Funding via Friendbot", async () => {
      if (!address) throw new Error("No wallet address.");
      const { note: outcome } = await fundWithFriendbot(address);
      note(`✓ Friendbot: ${outcome}`);
      await refreshBalance(address);
    });

  const onSendPayment = () =>
    run("Signing and submitting", async () => {
      if (!address) throw new Error("No wallet address.");

      // A 1 XLM payment from the account to itself. Deliberately trivial: it
      // needs no counterparty and cannot fail on `op_no_destination`, so what
      // it actually proves is that a Privy-held key produced a signature
      // Horizon accepts.
      const account = await horizon.loadAccount(address);
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(
          Operation.payment({
            destination: address,
            asset: Asset.native(),
            amount: "1",
          }),
        )
        .setTimeout(180)
        .build();

      note(`Built payment, hash ${tx.hash().toString("hex").slice(0, 16)}…`);

      await signWithPrivy(tx, address, signRawHash);
      note("Privy returned a signature; submitting to Horizon.");

      const result = await horizon.submitTransaction(tx);
      setTxHash(result.hash);
      note(`✓ Submitted in ledger ${result.ledger}: ${result.hash}`);
      await refreshBalance(address);
    });

  if (!ready) {
    return (
      <main>
        <p style={{ color: "var(--muted)" }}>Loading Privy…</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Privy → Stellar onboarding</h1>
      <p style={{ color: "var(--muted)", marginTop: 0 }}>
        Phase 1: email login to a signed testnet transaction, no seed phrase.
      </p>

      <h2>1. Log in</h2>
      {authenticated ? (
        <p>
          Signed in as <code>{user?.email?.address ?? user?.id}</code>{" "}
          <button onClick={logout}>Log out</button>
        </p>
      ) : (
        <p>
          <button onClick={login}>Log in with email</button>
        </p>
      )}

      {authenticated && (
        <>
          <h2>2. Stellar wallet</h2>
          {address ? (
            <dl>
              <dt>Address</dt>
              <dd className="mono">
                <a
                  href={explorerAccountUrl(address)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {address}
                </a>
              </dd>
              <dt>XLM balance</dt>
              <dd className="mono">
                {balance === null ? "account not created yet" : balance}
              </dd>
            </dl>
          ) : (
            <p>
              <button onClick={onCreateWallet} disabled={busy !== null}>
                Create Stellar wallet
              </button>
            </p>
          )}

          {address && (
            <>
              <h2>3. Fund with testnet XLM</h2>
              <p>
                <button onClick={onFund} disabled={busy !== null}>
                  Fund via Friendbot
                </button>
              </p>

              <h2>4. Sign and submit</h2>
              <p>
                <button onClick={onSendPayment} disabled={busy !== null}>
                  Send 1 XLM to self
                </button>
              </p>
            </>
          )}
        </>
      )}

      {busy && <p style={{ color: "var(--muted)" }}>{busy}…</p>}

      {error && (
        <p style={{ color: "var(--err)" }}>
          <strong>Error:</strong> {error}
        </p>
      )}

      {txHash && (
        <p style={{ color: "var(--ok)" }}>
          <strong>Signed and submitted.</strong>{" "}
          <a href={explorerTxUrl(txHash)} target="_blank" rel="noreferrer">
            View on stellar.expert
          </a>
        </p>
      )}

      {log.length > 0 && (
        <>
          <h2>Log</h2>
          <pre
            className="mono"
            style={{
              border: "1px solid var(--line)",
              borderRadius: 6,
              padding: "0.9rem 1rem",
              overflowX: "auto",
              whiteSpace: "pre-wrap",
            }}
          >
            {log.join("\n")}
          </pre>
        </>
      )}
    </main>
  );
}
