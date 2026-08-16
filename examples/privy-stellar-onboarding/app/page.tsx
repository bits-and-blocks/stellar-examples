"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Asset,
  BASE_FEE,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { motion } from "framer-motion";
import { AccountBar } from "@/components/AccountBar";
import { ActionButton } from "@/components/ActionButton";
import { ActivityLog } from "@/components/ActivityLog";
import { Card } from "@/components/Card";
import { ContributionList } from "@/components/ContributionList";
import { Footer } from "@/components/Footer";
import { ResultPanel } from "@/components/ResultPanel";
import { ExplorerLinks } from "@/components/ExplorerLinks";
import {
  CheckIcon,
  ExternalIcon,
  MailIcon,
  SparkIcon,
  SpinnerIcon,
  WalletIcon,
} from "@/components/icons";
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
import {
  clearActivity,
  recordActivity,
  useActivityLog,
  type LogEntry,
} from "@/lib/ui/activity-log";
import { recordContribution, useContributions } from "@/lib/ui/contributions";
import { recordTrustlineTx, useTrustlineTx } from "@/lib/ui/trustline";
import { ActionError, useActions } from "@/lib/ui/use-actions";
import { useSession } from "@/lib/wallet/session";

export default function Home() {
  // The one place the page learns whose wallet it is working with. Which of
  // the two implementations is behind this is settled at build time, and
  // nothing below asks.
  const session = useSession();
  const { ready, connected, address, signer } = session;

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

  // Survives a reload, like the contributions below.
  const log = useActivityLog();

  // Survive a reload, unlike everything else on this page.
  const contributions = useContributions(address);
  const trustlineTx = useTrustlineTx(address);

  const note = useCallback(
    (text: string, tone: LogEntry["tone"]) => recordActivity(text, tone),
    [],
  );

  // The log is the account of one person's session, so it goes when they do.
  // Left behind, the next person to sign in on this browser would open it to
  // someone else's wallet address and balances.
  const onLogout = useCallback(async () => {
    await session.disconnect();
    clearActivity();
  }, [session]);

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

  // The signed-out card. Privy opens its email modal and returns immediately;
  // the Kit resolves once a wallet is connected, or throws if the picker was
  // closed or the wallet is on the wrong network. Only the failure has
  // anything to say, so only the failure is rendered.
  const onConnect = () => actions.run("connect", () => session.connect());

  const onCreateWallet = () =>
    actions.run("wallet", async () => {
      if (!session.createWallet) {
        throw new ActionError("This wallet mode has no wallet to create.");
      }
      await session.createWallet();
      return { message: "Your Stellar wallet is ready." };
    });

  const onFund = () =>
    actions.run("fund", async () => {
      if (!address) throw new Error("You do not have a wallet address yet.");
      const { funded, note: outcome } = await fundWithFriendbot(address);
      const next = await refresh(address);

      // Friendbot only creates accounts, so a second ask is a no-op rather
      // than a top-up. Asking for XLM and being given none is a failed
      // attempt whatever Horizon makes of the request, so it is reported as
      // one: a neutral "nothing changed" read as though it had worked.
      if (!funded) {
        throw new ActionError(
          "Friendbot added nothing: your wallet already exists.",
          `It only creates accounts on testnet and will not top up one it has already funded, so this is as much XLM as it will give you. You still hold ${
            next.xlm ?? "0"
          } XLM.`,
        );
      }

      return { message: `${outcome} You now hold ${next.xlm ?? "0"} XLM.` };
    });

  const onSendPayment = () =>
    actions.run("sign", async () => {
      if (!address || !signer) {
        throw new Error("You do not have a wallet address yet.");
      }
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

      // The signed transaction, which the Kit builds anew rather than handing
      // back the one it was given.
      const signed = await signer.signTransaction(tx);
      const result = await horizon.submitTransaction(signed);
      setSignedFor(address);
      await refresh(address);
      return {
        message: `Signed and accepted in ledger ${result.ledger}.`,
        tx: result.hash,
      };
    });

  const onAddTrustline = () =>
    actions.run("trustline", async () => {
      if (!address || !signer) {
        throw new Error("You do not have a wallet address yet.");
      }
      const hash = await addTrustline(signer);
      recordTrustlineTx(address, hash);
      await refresh(address);
      // The message still reaches the activity log. What it does not do is
      // appear under the step, where the button already says this.
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

  // Separate from the bar's refresh, which only reports. This one is a claim
  // being checked, so it has an opinion about the answer.
  const onCheckFaucet = () =>
    actions.run("faucet-refresh", async () => {
      if (!address) throw new Error("You do not have a wallet address yet.");

      // What the balance was before the check. A balance above zero only says
      // this wallet holds some, which it may have held for an hour; whether
      // anything arrived is a question about the difference, and answering the
      // first as though it were the second told people their claim had landed
      // when it had not.
      const before = balances?.address === address ? balances.usdc : null;
      const next = await refresh(address);
      const held = next.usdc ?? "0";

      // Pressing this before going to the faucet is the easy slip to make, and
      // "0.0000000 USDC" states it as a fact rather than as something to fix.
      // A claim that has been made and has not landed yet looks identical from
      // here, so both readings are offered rather than the wrong one asserted.
      if (!(Number(held) > 0)) {
        return {
          message: `No ${USDC_CODE} has reached your wallet yet. If you have just claimed some, give it a few seconds and check again — the faucet takes a moment to send it. If you have not, open the Circle faucet above, choose Stellar, and paste the address from the bar at the top.`,
          tone: "info" as const,
        };
      }

      if (before !== null && Number(held) > Number(before)) {
        // Stated to the seven places Horizon reports balances in, rather than
        // to whatever a float subtraction produces.
        const arrived = (Number(held) - Number(before)).toFixed(7);
        return {
          message: `${arrived} ${USDC_CODE} arrived. You now hold ${held} ${USDC_CODE}.`,
        };
      }

      if (before !== null) {
        return {
          message: `Your wallet holds ${held} ${USDC_CODE}, and nothing new has arrived since the last check. If you have just claimed some, give it a few seconds and check again.`,
          tone: "info" as const,
        };
      }

      // No earlier reading to compare against, so the balance is all that can
      // honestly be said.
      return {
        message: `Your wallet holds ${held} ${USDC_CODE}.`,
        tone: "info" as const,
      };
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
        if (!address || !signer) {
          throw new Error("You do not have a wallet address yet.");
        }
        const value = options?.amountOverride ?? amount;
        const hash = await contribute(signer, value, options);
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
  const busy = actions.busy;

  // The two modes are the same app from step 2 onwards. They differ in how you
  // arrive: Privy makes you a wallet, and a browser extension brings its own.
  const kit = session.mode === "wallets-kit";

  // The balance-derived locks below are read off something that is not in hand
  // on the first render. Stating a reason from what has not been read yet would
  // flash the wrong one at someone whose wallet is perfectly ready, so the
  // reason waits even though the buttons do not.
  const known = !loadingBalances;

  // Every step is gated on the one that makes it possible, and each reason
  // below is resolved to the earliest unmet condition rather than the nearest
  // one: told to switch USDC on when there is no wallet at all, you would go
  // to a step that is itself locked.
  const needsWallet =
    address === null
      ? kit
        ? "Connect a wallet in step 1 first. Every step below acts on it."
        : "Create your wallet in step 1 first. Every step below acts on it."
      : undefined;

  // Nothing can touch a wallet the network has never heard of: signing needs a
  // fee, and a trustline needs a fee and 0.5 XLM set aside on top. Left open,
  // both steps failed with the network's own words about a missing account,
  // which reads as a broken app rather than as a skipped step.
  const needsFunding =
    needsWallet ??
    (known && xlm === null
      ? "Get some test XLM in step 2 first. Until something funds it your wallet does not exist on the network, and it cannot pay a fee or set anything aside."
      : undefined);

  // Everything from the faucet onwards moves USDC, and a wallet that has not
  // opted in cannot receive any of it.
  const needsTrustline =
    needsFunding ??
    (known && !hasTrustline
      ? `Switch ${USDC_CODE} on in step 4 first. Until you do, your wallet cannot receive or send it.`
      : undefined);

  if (!connected) {
    return (
      <>
        <div className="shell">
          <motion.header
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="hero"
          >
            <h1>
              {kit
                ? "A funded testnet wallet, from the one you already have"
                : "A Stellar wallet, with nothing to write down"}
            </h1>
            <p>
              {kit
                ? "Connect Freighter or xBull and you get an account you can actually use here: funded, able to hold USDC, and ready to send its first payment. Your key stays in the extension."
                : "Sign in with your email and you get a wallet you can actually use: funded, able to hold USDC, and ready to send its first payment. No seed phrase, no browser extension."}
            </p>
            <div className="badge-row">
              <span className="badge badge-accent">Testnet only</span>
              <span className="badge">No real money</span>
              <span className="badge">Takes about a minute</span>
            </div>
          </motion.header>

          <Card
            title={kit ? "Connect your wallet" : "Sign in"}
            note={
              kit
                ? "Every transaction below is built here and approved by you in the extension. This page never sees your key."
                : "Privy emails you a code, then creates and keeps the wallet safe for you."
            }
          >
            <div className="row">
              <ActionButton
                status={actions.get("connect").status}
                onClick={onConnect}
                variant="primary"
                size="lg"
                pending={kit ? "Waiting for your wallet" : undefined}
                icon={kit ? <WalletIcon /> : <MailIcon />}
              >
                {kit ? "Connect a wallet" : "Continue with email"}
              </ActionButton>
            </div>
            {/* A picker that was closed, or a wallet on the wrong network.
                Success needs no sentence: the page becomes the walkthrough. */}
            <ResultPanel
              result={
                actions.get("connect").result?.ok
                  ? undefined
                  : actions.get("connect").result
              }
            />
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
          label={session.label}
          address={address}
          explorerUrl={address ? explorerAccountUrl(address) : null}
          xlm={xlm}
          usdc={usdc}
          loadingBalances={loadingBalances}
          refreshStatus={actions.get("bar-refresh").status}
          onRefresh={onRefreshBalances("bar-refresh")}
          onLogout={onLogout}
          usdcCode={USDC_CODE}
        />

        <header className="hero">
          <h1>Set up your wallet</h1>
          <p>
            Work down the list. Each step tells you what it did as soon as it is
            done.
          </p>
        </header>

        <Card
          step={1}
          title={kit ? "Your connected wallet" : "Create your Stellar wallet"}
          note={
            kit
              ? `Connected with ${session.label}. The account below is the one it is currently exposing, and every step after this one acts on it.`
              : "This makes a wallet tied to your account. Privy holds the key, so there is nothing for you to back up."
          }
          done={address !== null}
        >
          <div className="row">
            {/* Nothing to create in Kit mode: the wallet arrived with an
                account already. The step stays in the list rather than
                renumbering the other six, and states what it has instead of
                offering a button that would have nothing to do. */}
            <ActionButton
              status={actions.get("wallet").status}
              onClick={onCreateWallet}
              disabled={
                busy || address !== null || session.createWallet === null
              }
              variant={address === null ? "primary" : "done"}
              pending="Creating"
              icon={address === null ? <SparkIcon /> : <CheckIcon size={13} />}
            >
              {address === null
                ? "Create wallet"
                : kit
                  ? `Connected with ${session.label}`
                  : "Your wallet is ready"}
            </ActionButton>
          </div>
          {/* Success is the button's to state, and the address it used to
              report is in the bar at the top the moment it exists. */}
          <ResultPanel
            result={
              actions.get("wallet").result?.ok
                ? undefined
                : actions.get("wallet").result
            }
          />
        </Card>

        <Card
          step={2}
          title="Get some test XLM"
          note="XLM pays the network fees. Friendbot hands it out free on testnet."
          done={xlm !== null}
          locked={needsWallet}
        >
          <div className="row">
            <ActionButton
              status={actions.get("fund").status}
              onClick={onFund}
              disabled={busy || address === null}
              variant={xlm === null ? "primary" : "default"}
              pending="Asking Friendbot"
            >
              {xlm === null ? "Get test XLM" : "Ask Friendbot again"}
            </ActionButton>
          </div>
          <ResultPanel result={actions.get("fund").result} />
        </Card>

        <Card
          step={3}
          title="Check that signing works"
          note="Send 1 XLM to yourself. Nothing leaves your wallet, and it proves your wallet can sign a real transaction."
          done={signed}
          locked={needsFunding}
        >
          <div className="row">
            <ActionButton
              status={actions.get("sign").status}
              onClick={onSendPayment}
              disabled={busy || xlm === null}
              pending="Sending"
            >
              Send 1 XLM to myself
            </ActionButton>
          </div>
          <ResultPanel result={actions.get("sign").result} />
        </Card>

        <Card
          step={4}
          title={`Switch on ${USDC_CODE}`}
          note={`Stellar makes you opt in to a token before your wallet can hold it. It sets aside 0.5 XLM, which you get back if you ever opt out. Skip this and every contribution below will fail.`}
          done={hasTrustline}
          locked={needsFunding}
        >
          <div className="row">
            <ActionButton
              status={actions.get("trustline").status}
              onClick={onAddTrustline}
              disabled={busy || hasTrustline || xlm === null}
              variant={hasTrustline ? "done" : "primary"}
              pending="Switching on"
              icon={hasTrustline ? <CheckIcon size={13} /> : undefined}
            >
              {hasTrustline
                ? `Your wallet can now hold ${USDC_CODE}`
                : `Switch on ${USDC_CODE}`}
            </ActionButton>
            {/* Kept beside the button rather than inside a result that
                expires, so the opt-in stays reachable after a reload. */}
            {hasTrustline && trustlineTx && (
              <ExplorerLinks hash={trustlineTx} compact size="md" />
            )}
          </div>
          {/* Success is the button's to state. Only a failure has anything
              left to say here. */}
          <ResultPanel
            result={
              actions.get("trustline").result?.ok
                ? undefined
                : actions.get("trustline").result
            }
          />
        </Card>

        <Card
          step={5}
          title={`Claim some test ${USDC_CODE}`}
          note="Circle gives out free test tokens. Pick Stellar, paste your address from the bar at the top, then come back and refresh."
          done={hasUsdc}
          locked={needsTrustline}
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
              onClick={onCheckFaucet}
              disabled={busy || !hasTrustline}
              pending="Checking"
            >
              I claimed it, check my balance
            </ActionButton>
          </div>
          <ResultPanel result={actions.get("faucet-refresh").result} />
        </Card>

        <Card
          step={6}
          title="Contribute"
          note={`Send ${USDC_CODE} from your wallet to the pool.`}
          done={contributions.length > 0}
          locked={needsTrustline}
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
                disabled={!hasTrustline}
                inputMode="decimal"
                aria-label={`Amount of ${USDC_CODE} to contribute`}
              />
              <span className="field-suffix">{USDC_CODE}</span>
            </label>
            <ActionButton
              status={actions.get("contribute").status}
              onClick={onContribute("contribute")}
              disabled={busy || !hasTrustline}
              variant="primary"
              pending="Sending"
            >
              Contribute
            </ActionButton>
          </div>

          {/* Success is the list's to state: what was sent arrives at the top
              of it with its own links, dated, a moment later. Saying it in a
              sentence here as well answered the same question twice. */}
          <ResultPanel
            result={
              actions.get("contribute").result?.ok
                ? undefined
                : actions.get("contribute").result
            }
          />

          <ContributionList entries={contributions} code={USDC_CODE} />
        </Card>

        <Card
          step={7}
          title="See what a failure looks like"
          note={`Both buttons try to send 999999 ${USDC_CODE}, which you do not have, so both fail. The difference is what you are told. With the check on, you get a plain sentence. With it off, the error comes straight back from the network.`}
          locked={needsTrustline}
        >
          <div className="row">
            <ActionButton
              status={actions.get("fail-checked").status}
              onClick={onContribute("fail-checked", {
                amountOverride: "999999",
              })}
              disabled={busy || !hasTrustline}
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
              disabled={busy || !hasTrustline}
              pending="Sending"
            >
              Too much, no check
            </ActionButton>
          </div>
          <ResultPanel result={actions.get("fail-checked").result} />
          <ResultPanel result={actions.get("fail-unchecked").result} />
        </Card>

        <ActivityLog entries={log} onClear={clearActivity} />
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
