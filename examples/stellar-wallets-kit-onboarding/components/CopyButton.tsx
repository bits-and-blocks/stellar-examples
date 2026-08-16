"use client";

import { useEffect, useState } from "react";
import { CheckIcon, CopyIcon } from "./icons";

/**
 * Copies a value and says so for a moment.
 *
 * An address is the one thing on this page that has to leave it — into a
 * faucet, into an explorer, into a message — so it is copyable everywhere it
 * appears rather than only in the bar at the top.
 */
export function CopyButton({
  value,
  size = 12,
  label = "address",
}: {
  value: string;
  size?: number;
  /** What is being copied, as the tooltip and screen readers say it. */
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      aria-label={copied ? `${capitalise(label)} copied` : `Copy ${label}`}
      title={copied ? "Copied" : `Copy ${label}`}
      onClick={() => {
        navigator.clipboard.writeText(value).then(
          () => setCopied(true),
          () => {},
        );
      }}
      className={`link-icon${copied ? " copied" : ""}`}
    >
      {copied ? <CheckIcon size={size} /> : <CopyIcon size={size} />}
    </button>
  );
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
