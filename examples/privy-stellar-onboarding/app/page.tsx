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
  POOL_ADDRESS,
  USDC_CODE,
  USDC_SAC_ID,
  isContractAddress,
} from "@/lib/stellar/assets";
import {
  addTrustline,
  contribute,
  getUsdcBalance,
} from "@/lib/stellar/contribute";
import { ContributionError, describeFailure } from "@/lib/stellar/errors";
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
  const [failure, setFailure] = useState<{
    summary: string;
    remedy: string;
    kind: string;
  } | null>(null);
  const [xlm, setXlm] = useState<string | null>(null);
  const [usdc, setUsdc] = useState<string | null>(null);
  const [amount, setAmount] = useState("1");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [contributions, setContributions] = useState<string[]>([]);
  const [log, setLog] = useState<string[]>([]);

  const wallet = findStellarWallet(user);
  const address = wallet?.address ?? null;

  const note = (message: string) =>
    setLog((entries) => [
      ...entries,
      `${new Date().toLocaleTimeString()}  ${message}`,
    ]);

  const refresh = useCallback(async (target: string) => {
    const [nextXlm, nextUsdc] = await Promise.all([
      getXlmBalance(target),
      getUsdcBalance(target).catch(() => null),
    ]);
    setXlm(nextXlm);
    setUsdc(nextUsdc);
  }, []);

  // Load balances once an address exists. The cancelled flag stops a slow
  // response for an old address from overwriting a newer one.
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    Promise.all([
      getXlmBalance(address),
      getUsdcBalance(address).catch(() => null),
    ]).then(
      ([nextXlm, nextUsdc]) => {
        if (cancelled) return;
        setXlm(nextXlm);
        setUsdc(nextUsdc);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [address]);

  /**
   * Runs an action and turns any failure into something the donor can act on.
   * A ContributionError already carries a classified cause; anything else is
   * genuinely unexpected and is shown raw rather than dressed up.
   */
  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    setFailure(null);
    try {
      await action();
    } catch (caught) {
      if (caught instanceof ContributionError) {
        const described = describeFailure(caught.failure);
        setFailure({ ...described, kind: caught.failure.kind });
        note(`✗ ${caught.failure.kind}: ${described.summary}`);
      } else {
        const message =
          caught instanceof Error ? caught.message : String(caught);
        setFailure({ summary: message, remedy: "", kind: "unexpected" });
        note(`✗ ${label} failed: ${message}`);
      }
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
      await refresh(address);
    });

  const onSendPayment = () =>
    run("Signing and submitting", async () => {
      if (!address) throw new Error("No wallet address.");
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

      await signWithPrivy(tx, address, signRawHash);
      const result = await horizon.submitTransaction(tx);
      setTxHash(result.hash);
      note(`✓ Payment in ledger ${result.ledger}: ${result.hash}`);
      await refresh(address);
    });

  const onAddTrustline = () =>
    run("Adding trustline", async () => {
      if (!address) throw new Error("No wallet address.");
      const hash = await addTrustline(address, signRawHash);
      note(`✓ ${USDC_CODE} trustline established: ${hash}`);
      await refresh(address);
    });

  const onContribute = (options?: {
    skipPreflight?: boolean;
    /** Explicit amount for the failure demos, which must not depend on a
     *  setAmount() that has not been applied to state yet. */
    amountOverride?: string;
  }) =>
    run("Contributing", async () => {
      if (!address) throw new Error("No wallet address.");
      const value = options?.amountOverride ?? amount;
      const hash = await contribute(address, value, signRawHash, options);
      setContributions((previous) => [hash, ...previous]);
      note(`✓ Contributed ${value} ${USDC_CODE}: ${hash}`);
      await refresh(address);
    });

  if (!ready) {
    return (
      <main>
        <p style={{ color: "var(--muted)" }}>Loading Privy…</p>
      </main>
    );
  }

  const hasTrustline = usdc !== null;

  return (
    <main>
      <h1>Privy → Stellar onboarding</h1>
      <p style={{ color: "var(--muted)", marginTop: 0 }}>
        Email login to a funded testnet contribution, no seed phrase at any
        point. Testnet only.
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
              <dt>XLM</dt>
              <dd className="mono">{xlm ?? "account not created yet"}</dd>
              <dt>{USDC_CODE}</dt>
              <dd className="mono">
                {usdc ?? "no trustline — cannot hold this asset"}
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

              <h2>4. Prove signing works</h2>
              <p>
                <button onClick={onSendPayment} disabled={busy !== null}>
                  Send 1 XLM to self
                </button>
                {txHash && (
                  <>
                    {" "}
                    <a
                      href={explorerTxUrl(txHash)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      view tx
                    </a>
                  </>
                )}
              </p>

              <h2>5. {USDC_CODE} trustline</h2>
              <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
                A Stellar account cannot receive an asset until it opts in. This
                costs 0.5 XLM held in reserve, not spent. Without it, every
                contribution below fails — which is the point of surfacing it as
                its own step.
              </p>
              <p>
                <button
                  onClick={onAddTrustline}
                  disabled={busy !== null || hasTrustline}
                >
                  {hasTrustline
                    ? `${USDC_CODE} trustline established`
                    : `Add ${USDC_CODE} trustline`}
                </button>
              </p>

              <h2>6. Get test {USDC_CODE}</h2>
              <p>
                <a
                  href="https://faucet.circle.com"
                  target="_blank"
                  rel="noreferrer"
                >
                  Circle testnet faucet
                </a>{" "}
                — choose Stellar, paste your address above, then{" "}
                <button
                  onClick={() => address && refresh(address)}
                  disabled={busy !== null}
                >
                  refresh balances
                </button>
              </p>

              <h2>7. Contribute</h2>
              <dl>
                <dt>Pool</dt>
                <dd className="mono">
                  {POOL_ADDRESS}{" "}
                  <span style={{ color: "var(--muted)" }}>
                    ({isContractAddress(POOL_ADDRESS)
                      ? "contract"
                      : "G-address, interim target"}
                    )
                  </span>
                </dd>
                <dt>Via SAC</dt>
                <dd className="mono">{USDC_SAC_ID}</dd>
              </dl>
              <p>
                <input
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  size={10}
                  aria-label={`Amount of ${USDC_CODE}`}
                  style={{
                    font: "inherit",
                    padding: "0.5rem",
                    marginRight: "0.5rem",
                    border: "1px solid var(--line)",
                    borderRadius: 6,
                    background: "transparent",
                    color: "var(--fg)",
                  }}
                />
                <button
                  onClick={() => onContribute()}
                  disabled={busy !== null}
                >
                  Contribute {USDC_CODE}
                </button>
              </p>

              <h2>Deliberate failures</h2>
              <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
                The same impossible contribution — 999999 {USDC_CODE} — sent
                both ways. Both buttons fail; the difference is what the donor
                is told. Skipping preflight does not cause the failure, it only
                removes the early check, so the mistake arrives from Soroban as
                a host error instead of as a sentence.
              </p>
              <p style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <button
                  onClick={() => onContribute({ amountOverride: "999999" })}
                  disabled={busy !== null}
                >
                  Over-balance, checked
                </button>
                <button
                  onClick={() =>
                    onContribute({
                      amountOverride: "999999",
                      skipPreflight: true,
                    })
                  }
                  disabled={busy !== null}
                >
                  Over-balance, unchecked
                </button>
              </p>
            </>
          )}
        </>
      )}

      {busy && <p style={{ color: "var(--muted)" }}>{busy}…</p>}

      {failure && (
        <div
          style={{
            border: "1px solid var(--err)",
            borderRadius: 6,
            padding: "0.9rem 1rem",
            margin: "1rem 0",
          }}
        >
          <p style={{ margin: "0 0 0.4rem", color: "var(--err)" }}>
            <code>{failure.kind}</code> — {failure.summary}
          </p>
          {failure.remedy && (
            <p style={{ margin: 0, fontSize: "0.9rem" }}>{failure.remedy}</p>
          )}
        </div>
      )}

      {contributions.length > 0 && (
        <>
          <h2>Contributions</h2>
          <ul>
            {contributions.map((hash) => (
              <li key={hash} className="mono">
                <a href={explorerTxUrl(hash)} target="_blank" rel="noreferrer">
                  {hash}
                </a>
              </li>
            ))}
          </ul>
        </>
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
