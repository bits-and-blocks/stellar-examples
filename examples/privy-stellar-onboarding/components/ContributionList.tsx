"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Contribution } from "@/lib/ui/contributions";
import { formatExact, formatWhen, useNow } from "@/lib/ui/when";
import { ExplorerLinks } from "./ExplorerLinks";

/**
 * What this wallet has sent to the pool, newest first.
 *
 * This is where a contribution is confirmed. The step used to answer twice —
 * a sentence under the button saying it had been sent, and the same transaction
 * appearing at the top of this list a moment later — so the sentence went and
 * the arrival became the confirmation. For that to work the arrival has to be
 * visible: the new row drops in at the top, the rows below it slide down to
 * make the space, and it holds a highlight for a beat before settling in with
 * the rest.
 *
 * The list folds away, since fifty rows of hashes is a lot of page to scroll
 * past on the way to the step below it. Folded, it unfolds itself when
 * something new arrives — the arrival is the only confirmation there is, and
 * one that happens off screen is not one.
 */
export function ContributionList({
  entries,
  code,
}: {
  entries: readonly Contribution[];
  code: string;
}) {
  const now = useNow();

  // Entries already here when the page loaded came out of storage rather than
  // out of something the reader just did, so they are not announced as new.
  const [openedAt] = useState(() => Date.now());

  const newest = entries[0];
  // The arrival is the confirmation, and an arrival is something you watch. The
  // count is in the sentence because a live region only speaks when its text
  // changes, and two contributions of the same amount would otherwise read as
  // the same event and be announced once.
  const arrival =
    newest && newest.at > openedAt
      ? `Sent ${newest.amount} ${code} to the pool. ${entries.length} so far from this browser.`
      : "";

  // Folding is held as the entry that was newest when it was folded, rather
  // than as a plain "closed". Anything newer than that is something the reader
  // has done since, so the list is open again for it without a second thought
  // about how it got there.
  const [foldedAt, setFoldedAt] = useState<string | null>(null);
  const open = foldedAt === null || foldedAt !== newest?.hash;

  return (
    <>
      {/* Mounted whether or not there is a list, because a live region added to
          the page with its message already in it is not announced. */}
      <p className="sr-only" role="status">
        {arrival}
      </p>

      <AnimatePresence initial={false}>
        {entries.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: "hidden" }}
          >
            <div
              className="row"
              style={{ justifyContent: "space-between", marginBottom: 12 }}
            >
              <p className="section-label" style={{ margin: 0 }}>
                Your contributions, kept in this browser
              </p>
              <button
                type="button"
                className="btn btn-sm"
                aria-expanded={open}
                onClick={() =>
                  setFoldedAt(open ? (newest?.hash ?? null) : null)
                }
              >
                {open ? "Hide" : `Show ${entries.length}`}
              </button>
            </div>

            <AnimatePresence initial={false}>
              {open && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{
                    opacity: 1,
                    height: "auto",
                    // Clipping is only wanted while the fold is moving. Left on,
                    // it would cut the top off each row on its way in, since a
                    // row arrives from just above where it comes to rest.
                    transitionEnd: { overflow: "visible" },
                  }}
                  exit={{ opacity: 0, height: 0, overflow: "hidden" }}
                  transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                  style={{ overflow: "hidden" }}
                >
                  <ul className="list">
                    <AnimatePresence initial={false}>
                      {entries.map((entry) => (
                        <motion.li
                          key={entry.hash}
                          // What moves the rows below out of the way. Each one animates
                          // from where it was to where the new row has pushed it,
                          // rather than being redrawn a row lower.
                          layout
                          initial={{ opacity: 0, y: -14, scale: 0.98 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.98 }}
                          transition={{
                            layout: {
                              type: "spring",
                              stiffness: 380,
                              damping: 34,
                            },
                            duration: 0.28,
                            ease: [0.22, 1, 0.36, 1],
                          }}
                        >
                          {entry.at > openedAt && (
                            <span className="list-flash" aria-hidden />
                          )}
                          <span className="list-line">
                            <span className="list-amount">
                              {entry.amount} {code}
                            </span>
                            <time
                              className="list-when"
                              dateTime={new Date(entry.at).toISOString()}
                              title={formatExact(entry.at)}
                            >
                              {formatWhen(entry.at, now)}
                            </time>
                            <span className="mono list-hash">{entry.hash}</span>
                          </span>
                          <ExplorerLinks hash={entry.hash} compact />
                        </motion.li>
                      ))}
                    </AnimatePresence>
                  </ul>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
