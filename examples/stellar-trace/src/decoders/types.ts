/**
 * What a decoder is handed, and what it must return.
 *
 * Deliberately small. Everything downstream of a decoder — the trace output,
 * the recent list, a page later on — consumes `DecodedEvent` and nothing else,
 * which is what makes adding a decoder a change confined to this directory.
 */
import type { xdr } from "@stellar/stellar-sdk";

export type EventInput = {
  /** The contract that emitted it, or null for a system event. */
  contractId: string | null;
  /** Raw, in order. `topics[0]` is conventionally a symbol naming the event. */
  topics: xdr.ScVal[];
  /** The event's value, raw. */
  data: xdr.ScVal;
};

export type DecodedEvent = {
  /** What happened, in the emitting contract's vocabulary: `transfer`, `mint`. */
  kind: string;
  /** One line, already formatted, for a person reading a trace. */
  summary: string;
  /** The parts, named. Values are formatted strings, not XDR. */
  fields: Record<string, string>;
  /**
   * Anything the reader should know about how much to trust the line above:
   * that the emitting contract really is the asset's SAC, or that it is not.
   * A decoder that can only guess says so here rather than staying silent.
   */
  notes: string[];
};

/**
 * A decoder returns null to decline.
 *
 * Not an error case — the ordinary one. A registry entry is keyed on the
 * event's name, and any contract may emit an event named `transfer` that has
 * nothing to do with the token interface. Declining hands the event back to be
 * rendered structurally, which is honest; decoding it anyway would put a
 * confident wrong sentence on the screen.
 */
export type Decoder = (event: EventInput) => DecodedEvent | null;
