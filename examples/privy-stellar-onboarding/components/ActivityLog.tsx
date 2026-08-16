"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { LogEntry } from "@/lib/ui/activity-log";

/** Four characters each, so the column lines up in the monospaced log. */
const TAGS = {
  success: { label: "done", color: "var(--ok)" },
  info: { label: "same", color: "var(--muted)" },
  error: { label: "fail", color: "var(--err)" },
} as const;

/** A running record of what happened, folded away until someone wants it. */
export function ActivityLog({
  entries,
  onClear,
}: {
  entries: readonly LogEntry[];
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (entries.length === 0) return null;

  return (
    <motion.section layout className="card">
      <header
        className="card-head card-head-flat"
        style={{ alignItems: "center", justifyContent: "space-between" }}
      >
        <h2 className="card-title">Activity</h2>
        <div className="row">
          {/* Only offered while the log is open. Throwing away a record you
              cannot see is not a choice worth putting in front of anyone. */}
          {open && (
            <button type="button" className="btn btn-quiet" onClick={onClear}>
              Clear
            </button>
          )}
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? "Hide" : `Show ${entries.length}`}
          </button>
        </div>
      </header>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: "hidden" }}
          >
            <div className="log mono">
              {entries.map((entry) => (
                <div key={entry.id} className="log-line">
                  <span className="log-time">{entry.time}</span>
                  <span style={{ color: TAGS[entry.tone].color, flex: "none" }}>
                    {TAGS[entry.tone].label}
                  </span>
                  <span>{entry.text}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}
