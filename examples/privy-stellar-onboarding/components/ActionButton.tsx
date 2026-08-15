"use client";

import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { ActionStatus } from "@/lib/ui/use-actions";
import { SpinnerIcon } from "./icons";

type Props = {
  status: ActionStatus;
  onClick: () => void;
  children: ReactNode;
  /** Shown while the action runs, e.g. "Signing". */
  pending?: string;
  disabled?: boolean;
  /** "done" is a step already complete: stated rather than dimmed. */
  variant?: "primary" | "default" | "quiet" | "done";
  size?: "md" | "lg";
  icon?: ReactNode;
};

/**
 * A button that shows only whether it is working. How it went is the result
 * line's job: a button that flashed "Sent" above a panel that also said "Sent"
 * was the same answer twice, and the button's copy expired after two seconds
 * while the panel stayed. What outlives the click belongs below the button.
 */
export function ActionButton({
  status,
  onClick,
  children,
  pending = "Working",
  disabled,
  variant = "default",
  size = "md",
  icon,
}: Props) {
  const running = status === "pending";

  const face = running ? (
    <>
      <SpinnerIcon />
      {pending}
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
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={running ? "pending" : "idle"}
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
