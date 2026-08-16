"use client";

import { useSyncExternalStore } from "react";

export type Sent = {
  hash: string;
  /** The amount as it was typed, so the list reads the way it was entered. */
  amount: string;
  /** Epoch milliseconds. */
  at: number;
};

/**
 * Which list an entry belongs to. Two steps send something and confirm it by
 * the arrival of a row: the signing check in step 3 and the contributions in
 * step 6. They are different assets going to different places, so they are
 * different lists rather than one list with a column saying which is which.
 */
export type Ledger = "signing" | "contributions";

/**
 * What this browser has sent, kept in localStorage so a reload does not lose
 * it.
 *
 * Keyed by ledger and address rather than by user: two wallets in the same
 * browser should not see each other's history. This is a convenience cache,
 * never a source of truth. The chain holds the record, and every entry links
 * out to it.
 */
const KEY = "stellar-wallets-kit-onboarding:";

const EMPTY: readonly Sent[] = [];

/** Cap on stored entries. Long enough to be useful, short enough to stay small. */
const LIMIT = 50;

const storageKey = (ledger: Ledger, address: string) =>
  `${KEY}${ledger}:${address}`;

/**
 * getSnapshot has to return the same reference until something changes, so the
 * parsed list is memoised per ledger and address rather than re-read on every
 * render.
 */
const cache = new Map<string, readonly Sent[]>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function read(ledger: Ledger, address: string): readonly Sent[] {
  const key = storageKey(ledger, address);
  const cached = cache.get(key);
  if (cached) return cached;

  let parsed: readonly Sent[] = EMPTY;
  try {
    const raw = window.localStorage.getItem(key);
    const candidate: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(candidate)) parsed = candidate.filter(isSent);
  } catch {
    // Private browsing, a full quota, or hand-edited junk. An empty history is
    // a fine outcome for all three.
  }

  cache.set(key, parsed);
  return parsed;
}

function isSent(value: unknown): value is Sent {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.hash === "string" &&
    typeof entry.amount === "string" &&
    typeof entry.at === "number"
  );
}

/** The stored history for an address, empty during server rendering. */
export function useSent(ledger: Ledger, address: string | null) {
  return useSyncExternalStore(
    subscribe,
    () => (address ? read(ledger, address) : EMPTY),
    () => EMPTY,
  );
}

export function recordSent(ledger: Ledger, address: string, entry: Sent) {
  const key = storageKey(ledger, address);
  const next = [entry, ...read(ledger, address)].slice(0, LIMIT);
  cache.set(key, next);

  try {
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Storage being unavailable should not cost the user the entry they just
    // made, so the in-memory copy stands on its own for this session.
  }

  listeners.forEach((listener) => listener());
}
