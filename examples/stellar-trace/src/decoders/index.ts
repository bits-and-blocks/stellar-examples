/**
 * The default registry.
 *
 * Adding a decoder is two edits, both inside this directory: a file next to
 * `sac.ts` holding the decoder, and a line here registering it. Nothing
 * outside `src/decoders/` needs to know it happened — which is the property
 * the repoint depends on, and is checked by a test rather than promised.
 */
import { registerOrderBookDecoders } from "./orderbook.js";
import { DecoderRegistry } from "./registry.js";
import { registerSacDecoders } from "./sac.js";

export function defaultRegistry(): DecoderRegistry {
  const registry = new DecoderRegistry();
  registerSacDecoders(registry);
  registerOrderBookDecoders(registry);
  return registry;
}

/** The registry everything in this example decodes with. */
export const decoders = defaultRegistry();

export { ANY_CONTRACT, DecoderRegistry, topicName } from "./registry.js";
export type { DecodedEvent, Decoder, EventInput } from "./types.js";
