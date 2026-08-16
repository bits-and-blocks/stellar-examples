"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { ActionResult } from "@/lib/ui/use-actions";
import { ExplorerLinks } from "./ExplorerLinks";
import { AlertIcon, CheckIcon, NoChangeIcon } from "./icons";

/**
 * The outcome of one action, rendered inside that action's own section. Every
 * step keeps its answer next to its button, so nothing important is off screen
 * by the time it arrives.
 *
 * An outcome that went fine is one sentence, set flat under the button that
 * caused it. Only a failure gets the filled box, because only a failure has
 * more to say than a sentence: what to do about it, and what the network
 * actually replied.
 */
export function ResultPanel({ result }: { result?: ActionResult }) {
  const tone = !result ? "success" : result.ok ? result.tone : "error";
  const flat = result?.ok === true;

  return (
    <AnimatePresence initial={false} mode="wait">
      {result && (
        <motion.div
          key={result.ok ? `ok:${result.message}` : `err:${result.summary}`}
          initial={{ opacity: 0, height: 0, y: -4 }}
          animate={{ opacity: 1, height: "auto", y: 0 }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className={`result result-${tone}${flat ? " result-flat" : ""}`}
          role={result.ok ? "status" : "alert"}
        >
          <span className="result-icon">
            {tone === "error" ? (
              <AlertIcon />
            ) : tone === "info" ? (
              <NoChangeIcon />
            ) : (
              <CheckIcon />
            )}
          </span>

          <div className="result-body">
            {result.ok ? (
              /* The explorer links ride on the end of the sentence they belong
                 to rather than below it, which kept pushing the next step down
                 the page for two small links. */
              <div className="result-line">
                <span className="result-title">{result.message}</span>
                {result.tx && (
                  <span className="result-links">
                    <ExplorerLinks hash={result.tx} />
                  </span>
                )}
              </div>
            ) : (
              <>
                <span className="result-title">{result.summary}</span>
                {result.remedy && (
                  <span className="result-detail">{result.remedy}</span>
                )}
                {result.detail && (
                  <span className="result-raw">{result.detail}</span>
                )}
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
