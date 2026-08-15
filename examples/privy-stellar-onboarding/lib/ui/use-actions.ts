"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

/**
 * A failure the app saw coming and can advise on, raised by an action that is
 * not a contribution and so has no place in that taxonomy. Anything else that
 * throws is genuinely unexpected and is reported in the words it arrived in.
 */
export class ActionError extends Error {
  readonly remedy: string;

  constructor(summary: string, remedy = "") {
    super(summary);
    this.name = "ActionError";
    this.remedy = remedy;
  }
}

/** What an action hands back when it did not throw. */
export type Success = { message: string; tx?: string; tone?: Tone } | void;

const IDLE: Entry = { status: "idle" };

/**
 * How long a finished result stays on screen before it clears itself. Only the
 * sentence goes: the activity log keeps every message for as long as the page
 * is open, so nothing said here is lost when the line fades. Results that
 * carry explorer links are the exception and never expire, since the log does
 * not keep those.
 */
const RESULT_MS = 3000;

/**
 * Tracks every button's own status and its own result.
 *
 * One shared "busy" flag used to be enough, but it meant a result rendered far
 * from the button that produced it. Keying by action id lets each section show
 * its own spinner and its own result in place.
 *
 * Results clear themselves so the page settles back to the steps rather than
 * accumulating a sentence under every one of them.
 */
export function useActions(
  onNote?: (message: string, tone: Tone | "error") => void,
) {
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    const pending = timers.current;
    return () => {
      Object.values(pending).forEach(clearTimeout);
    };
  }, []);

  const settle = useCallback((id: string, entry: Entry) => {
    setEntries((current) => ({ ...current, [id]: entry }));

    clearTimeout(timers.current[id]);

    // A result carrying a transaction hash is the only route to that
    // transaction on the explorer. Timing the sentence out would take its
    // links with it, so those stay until the step is run again.
    if (entry.result?.ok && entry.result.tx) return;

    timers.current[id] = setTimeout(() => {
      // The status stays as it landed. Only the sentence is dropped, so a
      // section that reads its own status still knows how the run went.
      setEntries((current) => ({
        ...current,
        [id]: { status: current[id]?.status ?? "idle" },
      }));
    }, RESULT_MS);
  }, []);

  const run = useCallback(
    async (id: string, action: () => Promise<Success>) => {
      // Not through settle: a run in progress must not be on a clear timer set
      // by the result it is about to replace.
      clearTimeout(timers.current[id]);
      setEntries((current) => ({ ...current, [id]: { status: "pending" } }));

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

  if (caught instanceof ActionError) {
    return {
      ok: false,
      summary: caught.message,
      remedy: caught.remedy,
      kind: "action",
    };
  }

  return {
    ok: false,
    summary: caught instanceof Error ? caught.message : String(caught),
    remedy: "",
    kind: "unexpected",
  };
}
