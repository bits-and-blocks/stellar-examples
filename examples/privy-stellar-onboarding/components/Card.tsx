"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { CheckIcon, LockIcon } from "./icons";

type Props = {
  /** Step number in the walkthrough. Left out for cards that are not a step. */
  step?: number;
  title: string;
  note?: ReactNode;
  done?: boolean;
  /**
   * Why this step cannot be used yet. Set it and the whole body goes inert,
   * so nothing inside can be clicked, tabbed to, or read out as available.
   */
  locked?: ReactNode;
  children: ReactNode;
};

export function Card({ step, title, note, done, locked, children }: Props) {
  return (
    <motion.section
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className="card"
    >
      <header className="card-head">
        {step !== undefined && (
          <span className={`step-num${done ? " done" : ""}`}>
            {done ? <CheckIcon size={13} /> : step}
          </span>
        )}
        <div style={{ minWidth: 0 }}>
          <h2 className="card-title">{title}</h2>
          {note && <p className="card-note">{note}</p>}
        </div>
      </header>

      <div className={`card-body${step !== undefined ? " card-body-step" : ""}`}>
        {/* Outside the inert region on purpose: the one thing you can still
            read here is the reason you cannot do anything else. */}
        {locked && (
          <p className="locked-note">
            <LockIcon size={13} />
            {locked}
          </p>
        )}
        <div className={locked ? "card-locked" : "card-stack"} inert={!!locked}>
          {children}
        </div>
      </div>
    </motion.section>
  );
}
