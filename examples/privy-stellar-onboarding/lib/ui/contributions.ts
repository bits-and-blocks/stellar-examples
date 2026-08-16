"use client";

import { useSyncExternalStore } from "react";

export type Contribution = {
  hash: string;
  /** The amount as it was typed, so the list reads the way it was entered. */
  amount: string;
  /** Epoch milliseconds. */
  at: number;
};

/**
 * Contributions kept in localStorage so a reload does not lose them.
 *
 * Keyed by address rather than by user: two wallets in the same browser should
 * not see each other's history. This is a convenience cache, never a source of
 * truth. The chain holds the record, and every entry links out to it.
 */
const KEY = "privy-stellar-onboarding:contributions:";

const EMPTY: readonly Contribution[] = [];

/** Cap on stored entries. Long enough to be useful, short enough to stay small. */
const LIMIT = 50;

/**
 * getSnapshot has to return the same reference until something changes, so the
 * parsed list is memoised per address rather than re-read on every render.
 */
const cache = new Map<string, readonly Contribution[]>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function read(address: string): readonly Contribution[] {
  const cached = cache.get(address);
  if (cached) return cached;

  let parsed: readonly Contribution[] = EMPTY;
  try {
    const raw = window.localStorage.getItem(KEY + address);
    const candidate: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(candidate)) parsed = candidate.filter(isContribution);
  } catch {
    // Private browsing, a full quota, or hand-edited junk. An empty history is
    // a fine outcome for all three.
  }

  cache.set(address, parsed);
  return parsed;
}

function isContribution(value: unknown): value is Contribution {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.hash === "string" &&
    typeof entry.amount === "string" &&
    typeof entry.at === "number"
  );
}

/** The stored history for an address, empty during server rendering. */
export function useContributions(address: string | null) {
  return useSyncExternalStore(
    subscribe,
    () => (address ? read(address) : EMPTY),
    () => EMPTY,
  );
}

export function recordContribution(address: string, entry: Contribution) {
  const next = [entry, ...read(address)].slice(0, LIMIT);
  cache.set(address, next);

  try {
    window.localStorage.setItem(KEY + address, JSON.stringify(next));
  } catch {
    // Storage being unavailable should not cost the user the entry they just
    // made, so the in-memory copy stands on its own for this session.
  }

  listeners.forEach((listener) => listener());
}

export function clearContributions(address: string) {
  cache.set(address, EMPTY);
  try {
    window.localStorage.removeItem(KEY + address);
  } catch {}
  listeners.forEach((listener) => listener());
}
