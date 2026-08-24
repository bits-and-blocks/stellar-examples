/**
 * The registry: `(contract id, topic[0])` to a decoder.
 *
 * The whole point of this file is that it knows nothing about tokens. It never
 * mentions `transfer`, an asset, or an amount. Repointing this example at a
 * different contract is then a decoder registered next to it — see
 * [`sac.ts`](./sac.ts) for what one looks like — and no change anywhere else.
 *
 * **Why a contract id can be a wildcard.** The obvious key is exact: this
 * contract, this event. That works for a contract you deployed, and not at all
 * for the Stellar Asset Contract, which is not *a* contract — there is one per
 * asset, derived from the asset and the network passphrase, and testnet has
 * thousands. So a decoder may register under `*`, meaning "any contract
 * emitting an event by this name", and prove the contract is what it thinks by
 * looking at the event itself. Exact keys are still tried first, so a specific
 * contract can always override the general case.
 */
import { xdr } from "@stellar/stellar-sdk";

import type { Decoder, DecodedEvent, EventInput } from "./types.js";

export const ANY_CONTRACT = "*";

export type Registration = {
  contractId: string;
  topic: string;
  decoder: Decoder;
};

export class DecoderRegistry {
  private readonly decoders = new Map<string, Decoder>();

  /**
   * @param contractId a contract id, or `ANY_CONTRACT`
   * @param topic the symbol in `topics[0]` — `transfer`, `mint`, …
   */
  register(contractId: string, topic: string, decoder: Decoder): this {
    const key = keyOf(contractId, topic);
    if (this.decoders.has(key)) {
      throw new Error(`a decoder is already registered for ${key}`);
    }
    this.decoders.set(key, decoder);
    return this;
  }

  /**
   * Decode an event, or return null if nothing here understands it.
   *
   * Null covers three cases that are all the same from the outside: no decoder
   * is registered, the event's first topic is not a symbol at all, or a
   * decoder looked and declined. Each of them means "render this structurally
   * instead", which is the caller's job.
   */
  decode(event: EventInput): DecodedEvent | null {
    const topic = topicName(event.topics);
    if (topic === null) return null;

    const exact = event.contractId
      ? this.decoders.get(keyOf(event.contractId, topic))
      : undefined;
    const decoder = exact ?? this.decoders.get(keyOf(ANY_CONTRACT, topic));

    return decoder ? decoder(event) : null;
  }

  /** Every registration, for the README to be checkable rather than trusted. */
  registered(): string[] {
    return [...this.decoders.keys()].sort();
  }
}

const keyOf = (contractId: string, topic: string): string => `${contractId}|${topic}`;

/**
 * The symbol in `topics[0]`, or null.
 *
 * By convention the first topic names the event, and every SAC event follows
 * it. It is only a convention: a contract may put anything there, and one that
 * does simply has no name to key on.
 */
export function topicName(topics: xdr.ScVal[]): string | null {
  const first = topics[0];
  if (!first || first.switch() !== xdr.ScValType.scvSymbol()) return null;
  return first.sym().toString();
}
