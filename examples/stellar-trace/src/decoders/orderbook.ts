/**
 * A second contract, to prove the repoint is cheap.
 *
 * The decoders next door read the token interface, which is a published
 * standard with a derivable address. This file reads an order book contract
 * that happens to be busy on testnet — a stranger's deployment, with no
 * published schema and no way to check its claims. It exists to answer one
 * question: what does adding a contract to this example actually cost?
 *
 * The answer is this file and one line in `index.ts`. Nothing in the ingest
 * loop, the storage, the queries or the page knows it arrived.
 *
 * **Where the field names come from.** Not from documentation — there is
 * none. Each name below was corroborated against the contract's *own storage
 * keys*, read out of the same transactions that emitted the events:
 *
 *     event   rested 1        [GAV6…V3QT, 1787146455005, true, 18038, 16, 0]
 *     key     ["Order", 1, GAV6…V3QT, 1787146455005]
 *     key     ["Level", 1, true, 18038]
 *
 * The market id, the account, the order id, the side and the tick each appear
 * on both sides of that comparison, which is evidence rather than a guess.
 * The values that appear only in the event are left positional and labelled as
 * such — inventing names for them would be exactly the confident wrong sentence
 * this registry is built to avoid.
 *
 * `top_changed` is corroborated harder still, and pleasingly: its two ticks are
 * the before and after of the contract's own `BestTick` entry in the same
 * transaction. The trace shows the decoded line and that entry's diff one above
 * the other, agreeing.
 */
import { Address, scValToNative, xdr } from "@stellar/stellar-sdk";

import { short } from "../format.js";
import type { DecoderRegistry } from "./registry.js";
import type { DecodedEvent, EventInput } from "./types.js";

/**
 * One deployment, not a standard, so this registers under an exact contract id
 * rather than the wildcard the token decoders use. A different order book —
 * even the same source, deployed again — would be a different entry.
 */
const ORDER_BOOK = "CDX3WVFY6GV53J3XT53MNPE5HVKAGTCH74W3AWGMI43KUFK5TSXOU2RO";

/** Said on every event from here, because none of it is verifiable. */
const PROVENANCE =
  "field names corroborated against this contract's own storage keys, not " +
  "against a published schema";

export function registerOrderBookDecoders(registry: DecoderRegistry): DecoderRegistry {
  return registry
    .register(ORDER_BOOK, "rested", decodeRested)
    .register(ORDER_BOOK, "settled", decodeSettled)
    .register(ORDER_BOOK, "top_changed", decodeTopChanged);
}

/** `[rested, market]` · `[account, order, side, tick, …]` */
function decodeRested(event: EventInput): DecodedEvent | null {
  const market = readMarket(event);
  const parts = readVec(event.data);
  if (market === null || !parts) return null;

  const account = readAddress(parts[0]);
  const order = readNumber(parts[1]);
  const side = readBool(parts[2]);
  const tick = readNumber(parts[3]);
  if (account === null || order === null || side === null || tick === null) return null;

  return {
    kind: "rested",
    summary:
      `order ${order} from ${short(account)} rested at tick ${tick} ` +
      `on market ${market}`,
    fields: {
      market,
      account,
      order,
      side,
      tick,
      ...rest(parts, 4),
    },
    notes: [PROVENANCE, ...unnamed(parts, 4)],
  };
}

/** `[settled, market]` · `[account, order, …]` */
function decodeSettled(event: EventInput): DecodedEvent | null {
  const market = readMarket(event);
  const parts = readVec(event.data);
  if (market === null || !parts) return null;

  const account = readAddress(parts[0]);
  const order = readNumber(parts[1]);
  if (account === null || order === null) return null;

  return {
    kind: "settled",
    summary: `order ${order} from ${short(account)} settled on market ${market}`,
    fields: { market, account, order, ...rest(parts, 2) },
    notes: [PROVENANCE, ...unnamed(parts, 2)],
  };
}

/**
 * `[top_changed, market]` · `[side, from tick, to tick]`
 *
 * The one event here whose every field is accounted for: the two ticks are the
 * before and after of `["BestTick", market, side]`, which changes in the same
 * transaction. A test asserts that correspondence against the committed
 * fixture rather than trusting this comment.
 */
function decodeTopChanged(event: EventInput): DecodedEvent | null {
  const market = readMarket(event);
  const parts = readVec(event.data);
  if (market === null || !parts || parts.length !== 3) return null;

  const side = readBool(parts[0]);
  const from = readNumber(parts[1]);
  const to = readNumber(parts[2]);
  if (side === null || from === null || to === null) return null;

  return {
    kind: "top_changed",
    summary: `best tick on market ${market} (side ${side}) moved ${from} -> ${to}`,
    fields: { market, side, "from tick": from, "to tick": to },
    notes: [
      PROVENANCE,
      "the two ticks are the before and after of this contract's BestTick entry",
    ],
  };
}

// --- reading the pieces ------------------------------------------------------

/** `topics[1]`, a u32 that matches the market in every storage key. */
function readMarket(event: EventInput): string | null {
  const topic = event.topics[1];
  if (!topic || topic.switch() !== xdr.ScValType.scvU32()) return null;
  if (event.topics.length !== 2) return null;
  return String(scValToNative(topic));
}

const readVec = (data: xdr.ScVal): xdr.ScVal[] | null =>
  data.switch() === xdr.ScValType.scvVec() ? (data.vec() ?? []) : null;

const readAddress = (value: xdr.ScVal | undefined): string | null =>
  value && value.switch() === xdr.ScValType.scvAddress()
    ? Address.fromScAddress(value.address()).toString()
    : null;

const readBool = (value: xdr.ScVal | undefined): string | null =>
  value && value.switch() === xdr.ScValType.scvBool() ? String(value.b()) : null;

const readNumber = (value: xdr.ScVal | undefined): string | null => {
  if (!value) return null;
  const arm = value.switch().name;
  if (arm !== "scvU32" && arm !== "scvU64" && arm !== "scvI128" && arm !== "scvU128") {
    return null;
  }
  return String(scValToNative(value));
};

/** Everything past the fields we can name, kept but not interpreted. */
const rest = (parts: xdr.ScVal[], from: number): Record<string, string> => {
  const extra = parts.slice(from).map((part) => {
    try {
      return String(scValToNative(part));
    } catch {
      return `<${part.switch().name}>`;
    }
  });
  return extra.length ? { "unnamed values": `[${extra.join(", ")}]` } : {};
};

const unnamed = (parts: xdr.ScVal[], from: number): string[] =>
  parts.length > from
    ? [
        `${parts.length - from} value${parts.length - from === 1 ? "" : "s"} in this ` +
          `event appear in no storage key, so they are shown in the order they arrived`,
      ]
    : [];
