"use client";

import { useSyncExternalStore } from "react";

/**
 * The transaction that switched USDC on, kept per address in localStorage.
 *
 * The balance proves the trustline exists but says nothing about what created
 * it, and the result line under the step clears itself a few seconds after it
 * arrives. Without this the only route to the opt-in transaction would be gone
 * by the next reload, so the step keeps its own record and its explorer links
 * stay put.
 *
 * Keyed by address rather than by user, like the contributions store: two
 * wallets in the same browser must not show each other's transactions.
 */
const KEY = "stellar-wallets-kit-onboarding:trustline:";

/** Absent from the map means storage has not been read for that address yet. */
const cache = new Map<string, string | null>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function read(address: string): string | null {
  const cached = cache.get(address);
  if (cached !== undefined) return cached;

  let hash: string | null = null;
  try {
    hash = window.localStorage.getItem(KEY + address);
  } catch {
    // Private browsing or a blocked store. Losing the links is the whole cost.
  }

  cache.set(address, hash);
  return hash;
}

/** The stored opt-in transaction for an address, null during server rendering. */
export function useTrustlineTx(address: string | null) {
  return useSyncExternalStore(
    subscribe,
    () => (address ? read(address) : null),
    () => null,
  );
}

export function recordTrustlineTx(address: string, hash: string) {
  cache.set(address, hash);
  try {
    window.localStorage.setItem(KEY + address, hash);
  } catch {
    // The in-memory copy still carries this session.
  }
  listeners.forEach((listener) => listener());
}
