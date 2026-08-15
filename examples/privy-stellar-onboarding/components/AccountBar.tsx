"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { ActionStatus } from "@/lib/ui/use-actions";
import {
  CheckIcon,
  CopyIcon,
  ExternalIcon,
  LogoutIcon,
  RefreshIcon,
} from "./icons";

type Props = {
  email: string;
  address: string | null;
  explorerUrl: string | null;
  xlm: string | null;
  usdc: string | null;
  loadingBalances: boolean;
  refreshStatus: ActionStatus;
  onRefresh: () => void;
  onLogout: () => void;
  usdcCode: string;
};

/**
 * Sticks to the top of the viewport so who you are, what you hold, and the way
 * out stay reachable from any point in the walkthrough.
 */
export function AccountBar({
  email,
  address,
  explorerUrl,
  xlm,
  usdc,
  loadingBalances,
  refreshStatus,
  onRefresh,
  onLogout,
  usdcCode,
}: Props) {
  const refreshing = refreshStatus === "pending";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="bar"
    >
      <div className="bar-identity">
        <span className="avatar">{email.slice(0, 1).toUpperCase()}</span>
        <span style={{ minWidth: 0 }}>
          <span className="bar-email" title={email}>
            {email}
          </span>
          {address ? (
            <span className="bar-address">
              <span className="mono">{shorten(address)}</span>
              <CopyButton value={address} />
              {explorerUrl && (
                <a
                  href={explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="View account on the explorer"
                  className="link-icon"
                >
                  <ExternalIcon size={12} />
                </a>
              )}
            </span>
          ) : (
            <span className="bar-address">No wallet yet</span>
          )}
        </span>
      </div>

      {address && (
        <div className="bar-balances">
          <Balance
            label="XLM"
            value={xlm}
            empty="Not funded"
            loading={loadingBalances}
          />
          <Balance
            label={usdcCode}
            value={usdc}
            empty="Not enabled"
            loading={loadingBalances}
          />
        </div>
      )}

      <div className="bar-actions">
        {address && (
          /* Icon only, and the icon itself is the progress: a label swapping to
             "Refreshing" resized the bar on every press. What it did lands in
             the activity log either way. */
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            aria-busy={refreshing}
            className="btn btn-icon"
            aria-label={refreshing ? "Refreshing balances" : "Refresh balances"}
            title="Refresh balances"
          >
            <RefreshIcon size={15} spinning={refreshing} />
          </button>
        )}
        <button
          type="button"
          onClick={onLogout}
          className="btn btn-icon"
          aria-label="Log out"
          title="Log out"
        >
          <LogoutIcon size={15} />
        </button>
      </div>
    </motion.div>
  );
}

function Balance({
  label,
  value,
  empty,
  loading,
}: {
  label: string;
  value: string | null;
  empty: string;
  loading: boolean;
}) {
  return (
    <div className="balance">
      <span className="balance-label">{label}</span>
      {loading ? (
        <span className="shimmer" />
      ) : (
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={value ?? "empty"}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ duration: 0.18 }}
            className={`balance-value${value ? "" : " empty"}`}
            title={value ?? empty}
          >
            {value ? exact(value) : empty}
          </motion.span>
        </AnimatePresence>
      )}
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      aria-label={copied ? "Address copied" : "Copy address"}
      title={copied ? "Copied" : "Copy address"}
      onClick={() => {
        navigator.clipboard.writeText(value).then(
          () => setCopied(true),
          () => {},
        );
      }}
      className={`link-icon${copied ? " copied" : ""}`}
    >
      {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
    </button>
  );
}

function shorten(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-6)}`;
}

/**
 * Stellar reports 7 decimals. Every one of them is kept: rounding to two turns
 * a balance of 9.9999999 into "10", which reads as money the wallet does not
 * have. Only trailing zeros go, which shortens the common case without
 * changing a digit, and the integer part picks up thousands separators.
 */
function exact(value: string) {
  const [whole, fraction = ""] = value.split(".");
  const asNumber = Number(whole);
  if (!Number.isFinite(asNumber)) return value;

  const grouped = asNumber.toLocaleString(undefined, {
    maximumFractionDigits: 0,
  });
  const kept = fraction.replace(/0+$/, "");
  return kept ? `${grouped}.${kept}` : grouped;
}
