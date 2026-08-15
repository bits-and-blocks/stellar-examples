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
import { AnimatePresence, motion } from "framer-motion";
import { AccountBar } from "@/components/AccountBar";
import { ActionButton } from "@/components/ActionButton";
import { ActivityLog, type LogEntry } from "@/components/ActivityLog";
import { Card } from "@/components/Card";
import { Footer } from "@/components/Footer";
import { ResultPanel } from "@/components/ResultPanel";
import { ExplorerLinks } from "@/components/ExplorerLinks";
import {
  CheckIcon,
  ExternalIcon,
  MailIcon,
  SparkIcon,
  SpinnerIcon,
} from "@/components/icons";
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
import {
  fundWithFriendbot,
  getXlmBalance,
  hasSelfPayment,
  horizon,
} from "@/lib/stellar/horizon";
import { NETWORK_PASSPHRASE, explorerAccountUrl } from "@/lib/stellar/network";
import { signWithPrivy } from "@/lib/stellar/sign";
import {
  recordContribution,
  useContributions,
} from "@/lib/ui/contributions";
import { useActions } from "@/lib/ui/use-actions";

export default function Home() {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { createWallet } = useCreateWallet();
  const { signRawHash } = useSignRawHash();

  // Balances carry the address they belong to, which is what lets the shimmer
  // be derived rather than toggled: anything not yet read for the current
  // address is still loading.
  const [balances, setBalances] = useState<Balances | null>(null);
  // Every other step reads its tick off the network or off storage, so this one
  // does too rather than off the action state, which a reload throws away. Held
  // as the address it was proven for, like the balances above, so a switch of
  // wallet cannot leave the previous one's tick behind.
  const [signedFor, setSignedFor] = useState<string | null>(null);
  const [amount, setAmount] = useState("1");
  const [log, setLog] = useState<LogEntry[]>([]);

  const wallet = findStellarWallet(user);
  const address = wallet?.address ?? null;

  // Survives a reload, unlike everything else on this page.
  const contributions = useContributions(address);

  const note = useCallback((text: string, tone: LogEntry["tone"]) => {
    setLog((entries) => [
      { id: Date.now() + entries.length, time: clock(), text, tone },
      ...entries,
    ]);
  }, []);

  const actions = useActions(note);

  const refresh = useCallback(async (target: string) => {
    const [nextXlm, nextUsdc] = await Promise.all([
      getXlmBalance(target),
      getUsdcBalance(target).catch(() => null),
    ]);
    const next = { address: target, xlm: nextXlm, usdc: nextUsdc };
    setBalances(next);
    return next;
  }, []);

  // Read balances once an address exists. The cancelled flag stops a slow
  // response for an old address from overwriting a newer one.
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    Promise.all([
      getXlmBalance(address),
      getUsdcBalance(address).catch(() => null),
    ]).then(
      ([xlm, usdc]) => {
        if (!cancelled) setBalances({ address, xlm, usdc });
      },
      () => {
        // A wallet nobody has funded yet has no account on the network, which
        // reads as an error. Record the address anyway so the bar can say "not
        // funded" instead of shimmering forever.
        if (!cancelled) setBalances({ address, xlm: null, usdc: null });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [address]);

  // The signing check leaves a self-payment behind, so the step can be ticked
  // from the chain on a fresh load the same way the balance-backed steps are.
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    hasSelfPayment(address).then(
      (found) => {
        if (!cancelled && found) setSignedFor(address);
      },
      () => {
        // No history to read yet. Leaving the step unticked is the honest
        // reading, and sending the payment sets it directly anyway.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [address]);

  const onCreateWallet = () =>
    actions.run("wallet", async () => {
      const { wallet: created } = await createWallet({ chainType: "stellar" });
      return { message: `Your Stellar wallet is ready: ${created.address}` };
    });

  const onFund = () =>
    actions.run("fund", async () => {
      if (!address) throw new Error("You do not have a wallet address yet.");
      const { funded, note: outcome } = await fundWithFriendbot(address);
      const next = await refresh(address);
      // Friendbot only creates accounts, so a second ask is a no-op rather
      // than a top-up. Reporting it as a success would be a lie about a
      // balance that did not move.
      return {
        message: `${outcome} You ${funded ? "now" : "still"} hold ${
          next.xlm ?? "0"
        } XLM.`,
        tone: funded ? "success" : "info",
      };
    });

  const onSendPayment = () =>
    actions.run("sign", async () => {
      if (!address) throw new Error("You do not have a wallet address yet.");
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
      setSignedFor(address);
      await refresh(address);
      return {
        message: `Signed and accepted in ledger ${result.ledger}.`,
        tx: result.hash,
      };
    });

  const onAddTrustline = () =>
    actions.run("trustline", async () => {
      if (!address) throw new Error("You do not have a wallet address yet.");
      const hash = await addTrustline(address, signRawHash);
      await refresh(address);
      return { message: `Your wallet can now hold ${USDC_CODE}.`, tx: hash };
    });

  const onRefreshBalances = (id: string) => () =>
    actions.run(id, async () => {
      if (!address) throw new Error("You do not have a wallet address yet.");
      const next = await refresh(address);
      const held =
        next.usdc === null
          ? `${USDC_CODE} is not switched on yet`
          : `${next.usdc} ${USDC_CODE}`;
      return { message: `Balances updated: ${next.xlm ?? "0"} XLM, ${held}.` };
    });

  const onContribute =
    (
      id: string,
      options?: {
        skipPreflight?: boolean;
        /** Explicit amount for the failure demos, which must not depend on a
         *  setAmount() that has not been applied to state yet. */
        amountOverride?: string;
      },
    ) =>
    () =>
      actions.run(id, async () => {
        if (!address) throw new Error("You do not have a wallet address yet.");
        const value = options?.amountOverride ?? amount;
        const hash = await contribute(address, value, signRawHash, options);
        recordContribution(address, { hash, amount: value, at: Date.now() });
        await refresh(address);
        return { message: `Sent ${value} ${USDC_CODE} to the pool.`, tx: hash };
      });

  if (!ready) {
    return (
      <div className="shell">
        <div
          className="row"
          style={{ color: "var(--muted)", padding: "4rem 0", gap: "0.6rem" }}
        >
          <SpinnerIcon />
          Getting things ready
        </div>
      </div>
    );
  }

  const current = balances?.address === address ? balances : null;
  const xlm = current?.xlm ?? null;
  const usdc = current?.usdc ?? null;
  const loadingBalances = address !== null && current === null;

  const signed = signedFor !== null && signedFor === address;
  const hasTrustline = usdc !== null;
  const hasUsdc = usdc !== null && Number(usdc) > 0;
  const email = user?.email?.address ?? user?.id ?? "Signed in";
  const busy = actions.busy;

  if (!authenticated) {
    return (
      <>
        <div className="shell">
          <motion.header
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="hero"
          >
            <h1>A Stellar wallet, with nothing to write down</h1>
            <p>
              Sign in with your email and you get a wallet you can actually use:
              funded, able to hold USDC, and ready to send its first payment. No
              seed phrase, no browser extension.
            </p>
            <div className="badge-row">
              <span className="badge badge-accent">Testnet only</span>
              <span className="badge">No real money</span>
              <span className="badge">Takes about a minute</span>
            </div>
          </motion.header>

          <Card
            title="Sign in"
            note="Privy emails you a code, then creates and keeps the wallet safe for you."
          >
            <div className="row">
              <ActionButton
                status="idle"
                onClick={() => login()}
                variant="primary"
                size="lg"
                icon={<MailIcon />}
              >
                Continue with email
              </ActionButton>
            </div>
          </Card>
        </div>
        <Footer />
      </>
    );
  }

  return (
    <>
      <div className="shell">
        <AccountBar
          email={email}
          address={address}
          explorerUrl={address ? explorerAccountUrl(address) : null}
          xlm={xlm}
          usdc={usdc}
          loadingBalances={loadingBalances}
          refreshStatus={actions.get("bar-refresh").status}
          onRefresh={onRefreshBalances("bar-refresh")}
          onLogout={logout}
          usdcCode={USDC_CODE}
        />

        <header className="hero">
          <h1>Set up your wallet</h1>
          <p>
            Work down the list. Each step tells you what it did as soon as it is
            done.
          </p>
        </header>

        {!address ? (
          <Card
            step={1}
            title="Create your Stellar wallet"
            note="This makes a wallet tied to your account. Privy holds the key, so there is nothing for you to back up."
          >
            <div className="row">
              <ActionButton
                status={actions.get("wallet").status}
                onClick={onCreateWallet}
                disabled={busy}
                variant="primary"
                pending="Creating"
                icon={<SparkIcon />}
              >
                Create wallet
              </ActionButton>
            </div>
            <ResultPanel result={actions.get("wallet").result} />
          </Card>
        ) : (
          <>
            <Card
              step={1}
              title="Get some test XLM"
              note="XLM pays the network fees. Friendbot hands it out free on testnet."
              done={xlm !== null}
            >
              <div className="row">
                <ActionButton
                  status={actions.get("fund").status}
                  onClick={onFund}
                  disabled={busy}
                  variant={xlm === null ? "primary" : "default"}
                  pending="Asking Friendbot"
                >
                  {xlm === null ? "Get test XLM" : "Ask Friendbot again"}
                </ActionButton>
              </div>
              <ResultPanel result={actions.get("fund").result} />
            </Card>

            <Card
              step={2}
              title="Check that signing works"
              note="Send 1 XLM to yourself. Nothing leaves your wallet, and it proves your wallet can sign a real transaction."
              done={signed}
            >
              <div className="row">
                <ActionButton
                  status={actions.get("sign").status}
                  onClick={onSendPayment}
                  disabled={busy}
                  pending="Signing"
                >
                  Send 1 XLM to myself
                </ActionButton>
              </div>
              <ResultPanel result={actions.get("sign").result} />
            </Card>

            <Card
              step={3}
              title={`Switch on ${USDC_CODE}`}
              note={`Stellar makes you opt in to a token before your wallet can hold it. It sets aside 0.5 XLM, which you get back if you ever opt out. Skip this and every contribution below will fail.`}
              done={hasTrustline}
            >
              <div className="row">
                <ActionButton
                  status={actions.get("trustline").status}
                  onClick={onAddTrustline}
                  disabled={busy || hasTrustline}
                  variant={hasTrustline ? "done" : "primary"}
                  pending="Switching on"
                  icon={hasTrustline ? <CheckIcon size={13} /> : undefined}
                >
                  {hasTrustline
                    ? `${USDC_CODE} is switched on`
                    : `Switch on ${USDC_CODE}`}
                </ActionButton>
              </div>
              <ResultPanel result={actions.get("trustline").result} />
            </Card>

            <Card
              step={4}
              title={`Claim some test ${USDC_CODE}`}
              note="Circle gives out free test tokens. Pick Stellar, paste the address from the bar at the top, then come back and refresh."
              done={hasUsdc}
            >
              <div className="row">
                <a
                  href="https://faucet.circle.com"
                  target="_blank"
                  rel="noreferrer"
                  className="btn"
                  style={{ textDecoration: "none" }}
                >
                  Open the Circle faucet
                  <ExternalIcon />
                </a>
                <ActionButton
                  status={actions.get("faucet-refresh").status}
                  onClick={onRefreshBalances("faucet-refresh")}
                  disabled={busy}
                  pending="Checking"
                >
                  I claimed it, check my balance
                </ActionButton>
              </div>
              <ResultPanel result={actions.get("faucet-refresh").result} />
            </Card>

            <Card
              step={5}
              title="Contribute"
              note={`Send ${USDC_CODE} from your wallet to the pool.`}
              done={contributions.length > 0}
            >
              {/* Where the money goes comes before the button that sends it. */}
              <dl className="kv">
                <dt>Goes to</dt>
                <dd className="mono">
                  {POOL_ADDRESS}{" "}
                  <span className="aside">
                    (
                    {isContractAddress(POOL_ADDRESS)
                      ? "a contract"
                      : "a regular address, standing in for the pool"}
                    )
                  </span>
                </dd>
                <dt>Token</dt>
                <dd className="mono">{USDC_SAC_ID}</dd>
              </dl>

              <div className="row">
                <label className="field">
                  <input
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    inputMode="decimal"
                    aria-label={`Amount of ${USDC_CODE} to contribute`}
                  />
                  <span className="field-suffix">{USDC_CODE}</span>
                </label>
                <ActionButton
                  status={actions.get("contribute").status}
                  onClick={onContribute("contribute")}
                  disabled={busy}
                  variant="primary"
                  pending="Sending"
                >
                  Contribute
                </ActionButton>
              </div>

              <ResultPanel result={actions.get("contribute").result} />

              <AnimatePresence initial={false}>
                {contributions.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                    style={{ overflow: "hidden" }}
                  >
                    <p className="section-label" style={{ margin: "0 0 12px" }}>
                      Your contributions, kept in this browser
                    </p>
                    <ul className="list">
                      <AnimatePresence initial={false}>
                        {contributions.map((entry) => (
                          <motion.li
                            key={entry.hash}
                            layout
                            initial={{ opacity: 0, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.2 }}
                          >
                            <span className="list-line">
                              <span
                                className="list-amount"
                                title={new Date(entry.at).toLocaleString()}
                              >
                                {entry.amount} {USDC_CODE}
                              </span>
                              <span className="mono list-hash">
                                {entry.hash}
                              </span>
                            </span>
                            <ExplorerLinks hash={entry.hash} compact />
                          </motion.li>
                        ))}
                      </AnimatePresence>
                    </ul>
                  </motion.div>
                )}
              </AnimatePresence>
            </Card>

            <Card
              step={6}
              title="See what a failure looks like"
              note={`Both buttons try to send 999999 ${USDC_CODE}, which you do not have, so both fail. The difference is what you are told. With the check on, you get a plain sentence. With it off, the error comes straight back from the network.`}
            >
              <div className="row">
                <ActionButton
                  status={actions.get("fail-checked").status}
                  onClick={onContribute("fail-checked", {
                    amountOverride: "999999",
                  })}
                  disabled={busy}
                  pending="Sending"
                >
                  Too much, with the check
                </ActionButton>
                <ActionButton
                  status={actions.get("fail-unchecked").status}
                  onClick={onContribute("fail-unchecked", {
                    amountOverride: "999999",
                    skipPreflight: true,
                  })}
                  disabled={busy}
                  pending="Sending"
                >
                  Too much, no check
                </ActionButton>
              </div>
              <ResultPanel result={actions.get("fail-checked").result} />
              <ResultPanel result={actions.get("fail-unchecked").result} />
            </Card>
          </>
        )}

        <ActivityLog entries={log} />
      </div>
      <Footer />
    </>
  );
}

type Balances = {
  /** Which account these were read for. */
  address: string;
  xlm: string | null;
  /** null means the wallet has not switched USDC on. */
  usdc: string | null;
};

function clock() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
