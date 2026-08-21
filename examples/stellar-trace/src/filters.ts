/**
 * The `getEvents` filter, and the small DSL the config file writes it in.
 *
 * This file exists so that pointing the indexer at a different contract is an
 * edit to `trace.config.json` and nothing else. Nothing downstream of here —
 * not the loop, not the database, not the queries — knows what a `transfer`
 * is. That matters later: the decoder registry (B3) and the repoint (B6) are
 * only cheap if the ingest path never learned the shape of a SAC event.
 *
 * Topic segments are written as `"*"` for a wildcard, as a bare symbol name
 * for the common case of `Symbol` topics, or as `"base64:<xdr>"` for a topic
 * that is not a symbol. They are encoded to base64 `ScVal` XDR here, which is
 * what the RPC server matches against.
 */
import { createHash } from "node:crypto";
import { nativeToScVal } from "@stellar/stellar-sdk";

import { RPC_LIMITS } from "./network.js";

export type EventType = "contract" | "system";

/** A filter as written in the config file. */
export type FilterSpec = {
  type?: EventType;
  contractIds?: string[];
  topics?: string[][];
};

/** A filter as the RPC server wants it: topic segments already base64 XDR. */
export type RpcFilter = {
  type?: EventType;
  contractIds?: string[];
  topics?: string[][];
};

const WILDCARD = "*";
const BASE64_PREFIX = "base64:";

export class FilterError extends Error {}

/**
 * `"transfer"` -> `AAAADwAAAAh0cmFuc2Zlcg==`, `"*"` -> `"*"`.
 */
export function encodeTopicSegment(segment: string): string {
  if (segment === WILDCARD) return WILDCARD;
  if (segment.startsWith(BASE64_PREFIX)) {
    const raw = segment.slice(BASE64_PREFIX.length);
    if (Buffer.from(raw, "base64").toString("base64") !== raw) {
      throw new FilterError(`topic segment "${segment}" is not valid base64`);
    }
    return raw;
  }
  if (!/^[A-Za-z0-9_]{1,32}$/.test(segment)) {
    throw new FilterError(
      `topic segment "${segment}" is neither "*", a Soroban symbol ` +
        `(<=32 chars of [A-Za-z0-9_]), nor "base64:<xdr>"`,
    );
  }
  return nativeToScVal(segment, { type: "symbol" }).toXDR("base64");
}

/**
 * Encode and range-check the configured filters.
 *
 * The arity check is the one worth knowing about. A topic matcher matches
 * **the whole topic array**, not a prefix: a one-segment `["transfer"]` matcher
 * matches only events that have exactly one topic, so against a Stellar Asset
 * Contract — whose CAP-67 transfer carries four topics — it silently matches
 * nothing. Silently, because "no events" is what an idle contract looks like
 * too. Hence `["transfer", "*", "*", "*"]` in the shipped config.
 */
export function encodeFilters(specs: FilterSpec[]): RpcFilter[] {
  if (specs.length === 0) {
    throw new FilterError(
      "at least one filter is required — an unfiltered ingest would pull " +
        "every event on the network, including a fee event per classic " +
        "transaction, and fill the database with what nothing reads",
    );
  }
  if (specs.length > RPC_LIMITS.filters) {
    throw new FilterError(
      `${specs.length} filters configured; the RPC server accepts at most ${RPC_LIMITS.filters}`,
    );
  }

  return specs.map((spec, index) => {
    const where = `filter ${index + 1}`;

    if (spec.type !== undefined && spec.type !== "contract" && spec.type !== "system") {
      throw new FilterError(
        `${where}: type must be "contract" or "system" — "diagnostic" was ` +
          `removed from getEvents in protocol 23`,
      );
    }
    if (spec.contractIds && spec.contractIds.length > RPC_LIMITS.contractIds) {
      throw new FilterError(
        `${where}: ${spec.contractIds.length} contract ids; the RPC server accepts at most ${RPC_LIMITS.contractIds}`,
      );
    }
    for (const id of spec.contractIds ?? []) {
      if (!/^C[A-Z2-7]{55}$/.test(id)) {
        throw new FilterError(`${where}: "${id}" is not a contract id`);
      }
    }
    if (spec.topics && spec.topics.length > RPC_LIMITS.topicMatchers) {
      throw new FilterError(
        `${where}: ${spec.topics.length} topic matchers; the RPC server accepts at most ${RPC_LIMITS.topicMatchers}`,
      );
    }
    for (const matcher of spec.topics ?? []) {
      if (matcher.length < 1 || matcher.length > RPC_LIMITS.topicSegments) {
        throw new FilterError(
          `${where}: a topic matcher has ${matcher.length} segments; ` +
            `1 to ${RPC_LIMITS.topicSegments} are allowed, and the count must ` +
            `equal the number of topics on the events you mean to match`,
        );
      }
    }

    return {
      ...(spec.type ? { type: spec.type } : {}),
      ...(spec.contractIds ? { contractIds: [...spec.contractIds] } : {}),
      ...(spec.topics
        ? { topics: spec.topics.map((m) => m.map(encodeTopicSegment)) }
        : {}),
    };
  });
}

/**
 * A stable hash of the encoded filters.
 *
 * The stored cursor means "everything matching *these* filters up to here is
 * in the database". Resuming with different filters would leave a hole from
 * the start ledger to the cursor that nothing would ever notice, so the
 * fingerprint is stored beside the cursor and checked on startup.
 */
export function fingerprintFilters(filters: RpcFilter[]): string {
  const canonical = filters.map((f) => ({
    type: f.type ?? null,
    contractIds: [...(f.contractIds ?? [])].sort(),
    topics: (f.topics ?? []).map((m) => m.join(",")).sort(),
  }));
  return createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex")
    .slice(0, 16);
}
