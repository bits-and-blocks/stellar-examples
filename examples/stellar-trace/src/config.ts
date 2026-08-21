/**
 * Loading and validating `trace.config.json`.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { encodeFilters, fingerprintFilters, type FilterSpec, type RpcFilter } from "./filters.js";
import { DEFAULT_RPC_URL, RPC_LIMITS } from "./network.js";

export const DEFAULT_CONFIG_PATH = "trace.config.json";

export type TraceConfigFile = {
  rpcUrl?: string;
  /** Records per request. The server caps this at 10,000. */
  pageLimit?: number;
  /** How long to wait after catching up to the tip before asking again. */
  pollIntervalMs?: number;
  filters: FilterSpec[];
};

export type TraceConfig = {
  path: string;
  rpcUrl: string;
  pageLimit: number;
  pollIntervalMs: number;
  filters: RpcFilter[];
  /** Identifies the filter set the stored cursor belongs to. */
  fingerprint: string;
};

export class ConfigError extends Error {}

/** Roughly a ledger close, so the loop asks about as often as there is news. */
const DEFAULT_POLL_INTERVAL_MS = 5_000;

export function loadConfig(path: string = DEFAULT_CONFIG_PATH): TraceConfig {
  const absolute = resolve(path);

  let parsed: TraceConfigFile;
  try {
    parsed = JSON.parse(readFileSync(absolute, "utf8")) as TraceConfigFile;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`could not read ${absolute}: ${reason}`);
  }

  if (!Array.isArray(parsed.filters)) {
    throw new ConfigError(`${absolute}: "filters" must be an array`);
  }

  const pageLimit = parsed.pageLimit ?? RPC_LIMITS.pageLimit;
  if (!Number.isInteger(pageLimit) || pageLimit < 1 || pageLimit > RPC_LIMITS.pageLimit) {
    throw new ConfigError(
      `${absolute}: "pageLimit" must be between 1 and ${RPC_LIMITS.pageLimit}`,
    );
  }

  const pollIntervalMs = parsed.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 0) {
    throw new ConfigError(`${absolute}: "pollIntervalMs" must be a non-negative integer`);
  }

  const rpcUrl = parsed.rpcUrl ?? DEFAULT_RPC_URL;
  try {
    new URL(rpcUrl);
  } catch {
    throw new ConfigError(`${absolute}: "rpcUrl" is not a URL: ${rpcUrl}`);
  }

  const filters = encodeFilters(parsed.filters);

  return {
    path: absolute,
    rpcUrl,
    pageLimit,
    pollIntervalMs,
    filters,
    fingerprint: fingerprintFilters(filters),
  };
}
