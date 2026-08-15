"use client";

import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { ActionStatus } from "@/lib/ui/use-actions";
import { AlertIcon, CheckIcon, NoChangeIcon, SpinnerIcon } from "./icons";

type Props = {
  status: ActionStatus;
  onClick: () => void;
  children: ReactNode;
  /** Shown while the action runs, e.g. "Signing". */
  pending?: string;
  /** Shown for a moment after it works, e.g. "Sent". */
  done?: string;
  /** Shown when it completed but changed nothing. */
  unchanged?: string;
  failed?: string;
  disabled?: boolean;
  /** "done" is a step already complete: stated rather than dimmed. */
  variant?: "primary" | "default" | "quiet" | "done";
  size?: "md" | "lg";
  icon?: ReactNode;
};

/**
 * A button that reports on itself: spinner while running, check when it worked,
 * cross when it did not. The label swaps with the status so the feedback lands
 * where the click happened rather than somewhere further down the page.
 */
export function ActionButton({
  status,
  onClick,
  children,
  pending = "Working",
  done = "Done",
  unchanged = "No change",
  failed = "Failed",
  disabled,
  variant = "default",
  size = "md",
  icon,
}: Props) {
  const running = status === "pending";

  const face =
    status === "pending" ? (
      <>
        <SpinnerIcon />
        {pending}
      </>
    ) : status === "success" ? (
      <>
        <CheckIcon />
        {done}
      </>
    ) : status === "info" ? (
      <>
        <NoChangeIcon />
        {unchanged}
      </>
    ) : status === "error" ? (
      <>
        <AlertIcon />
        {failed}
      </>
    ) : (
      <>
        {icon}
        {children}
      </>
    );

  return (
    <motion.button
      layout
      type="button"
      onClick={onClick}
      disabled={disabled || running}
      aria-busy={running}
      whileHover={disabled || running ? undefined : { y: -1 }}
      whileTap={disabled || running ? undefined : { scale: 0.97 }}
      transition={{ type: "spring", stiffness: 420, damping: 32 }}
      className={[
        "btn",
        variant === "primary" ? "btn-primary" : "",
        variant === "quiet" ? "btn-quiet" : "",
        variant === "done" ? "btn-done" : "",
        size === "lg" ? "btn-lg" : "",
        status === "success" && variant !== "primary" ? "is-success" : "",
        status === "info" && variant !== "primary" ? "is-info" : "",
        status === "error" && variant !== "primary" ? "is-error" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={status}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.16 }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.45rem",
          }}
        >
          {face}
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );
}
