"use client";

import { useCallback, useState } from "react";
import { ContributionError, describeFailure } from "@/lib/stellar/errors";

export type ActionStatus = "idle" | "pending" | "success" | "info" | "error";

/**
 * How an outcome reads. "info" is for an action that completed without
 * changing anything, which is neither a success worth a checkmark nor a
 * failure: asking Friendbot to fund an already funded wallet, for instance.
 */
export type Tone = "success" | "info";

/** What a finished action leaves behind for its own section to render. */
export type ActionResult =
  | { ok: true; tone: Tone; message: string; tx?: string }
  | {
      ok: false;
      summary: string;
      remedy: string;
      /** Verbatim text from the network, if the failure carried any. */
      detail?: string;
      kind: string;
    };

type Entry = { status: ActionStatus; result?: ActionResult };

/** What an action hands back when it did not throw. */
export type Success = { message: string; tx?: string; tone?: Tone } | void;

const IDLE: Entry = { status: "idle" };

/**
 * Tracks every button's own status and its own result.
 *
 * One shared "busy" flag used to be enough, but it meant a result rendered far
 * from the button that produced it. Keying by action id lets each section show
 * its own spinner and its own result in place.
 *
 * A result is final once it arrives: it stays until the same action runs again
 * and replaces it. Nothing here expires on a timer.
 */
export function useActions(
  onNote?: (message: string, tone: Tone | "error") => void,
) {
  const [entries, setEntries] = useState<Record<string, Entry>>({});

  const settle = useCallback(
    (id: string, entry: Entry) =>
      setEntries((current) => ({ ...current, [id]: entry })),
    [],
  );

  const run = useCallback(
    async (id: string, action: () => Promise<Success>) => {
      settle(id, { status: "pending" });

      try {
        const success = await action();
        const tone = success?.tone ?? "success";
        const result: ActionResult = {
          ok: true,
          tone,
          message: success?.message ?? "Done.",
          tx: success?.tx,
        };
        settle(id, { status: tone, result });
        onNote?.(result.message, tone);
      } catch (caught) {
        const result = toFailure(caught);
        settle(id, { status: "error", result });
        onNote?.(result.summary, "error");
      }
    },
    [onNote, settle],
  );

  const get = useCallback((id: string) => entries[id] ?? IDLE, [entries]);

  const busy = Object.values(entries).some(
    (entry) => entry.status === "pending",
  );

  return { run, get, busy };
}

/**
 * A ContributionError already carries a classified cause, so it becomes a
 * sentence the user can act on. Anything else is genuinely unexpected and is
 * shown as it came rather than dressed up as something we understood.
 */
function toFailure(caught: unknown): Extract<ActionResult, { ok: false }> {
  if (caught instanceof ContributionError) {
    return {
      ok: false,
      ...describeFailure(caught.failure),
      kind: caught.failure.kind,
    };
  }

  return {
    ok: false,
    summary: caught instanceof Error ? caught.message : String(caught),
    remedy: "",
    kind: "unexpected",
  };
}
