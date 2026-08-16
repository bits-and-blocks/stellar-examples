"use client";

import { useSyncExternalStore } from "react";

export type LogEntry = {
  /** Only ever a React key, so uniqueness within the list is all it needs. */
  id: string;
  time: string;
  text: string;
  tone: "success" | "info" | "error";
};

/**
 * The running record of what happened, kept in localStorage so a reload does
 * not lose it. Results under each step clear themselves after a few seconds,
 * which makes this the only place a message survives, and a refresh mid-setup
 * used to take the whole account of the session with it.
 *
 * One key rather than one per address, unlike the contributions store: the log
 * starts before a wallet exists, since creating one is itself an entry. Logging
 * out clears it, so there is no history left to keep separate between accounts.
 */
const KEY = "stellar-wallets-kit-onboarding:log";

const EMPTY: readonly LogEntry[] = [];

/** Cap on stored entries, oldest dropped first. */
const LIMIT = 200;

/**
 * getSnapshot has to return the same reference until something changes, so the
 * parsed list is held here rather than re-read on every render. null means it
 * has not been read from storage yet.
 */
let cache: readonly LogEntry[] | null = null;
const listeners = new Set<() => void>();

/** Distinguishes entries written in the same millisecond. */
let sequence = 0;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function read(): readonly LogEntry[] {
  if (cache) return cache;

  let parsed: readonly LogEntry[] = EMPTY;
  try {
    const raw = window.localStorage.getItem(KEY);
    const candidate: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(candidate)) parsed = candidate.filter(isEntry);
  } catch {
    // Private browsing, a full quota, or hand-edited junk. An empty log is a
    // fine outcome for all three.
  }

  cache = parsed;
  return parsed;
}

function isEntry(value: unknown): value is LogEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    typeof entry.time === "string" &&
    typeof entry.text === "string" &&
    (entry.tone === "success" || entry.tone === "info" || entry.tone === "error")
  );
}

function publish(next: readonly LogEntry[]) {
  cache = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage being unavailable should not cost the entry that was just made,
    // so the in-memory copy stands on its own for this session.
  }
  listeners.forEach((listener) => listener());
}

/** The stored log, empty during server rendering. */
export function useActivityLog() {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}

export function recordActivity(text: string, tone: LogEntry["tone"]) {
  const entry: LogEntry = {
    id: `${Date.now()}-${sequence++}`,
    time: clock(),
    text,
    tone,
  };
  publish([entry, ...read()].slice(0, LIMIT));
}

export function clearActivity() {
  cache = EMPTY;
  try {
    window.localStorage.removeItem(KEY);
  } catch {}
  listeners.forEach((listener) => listener());
}

function clock() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
