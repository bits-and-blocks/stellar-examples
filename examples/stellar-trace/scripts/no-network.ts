/**
 * Unplug the network for whatever runs after this module.
 *
 * Loaded with `--import` by `npm run demo`, ahead of the command it is
 * demonstrating. Every way this example could reach the network goes through
 * `fetch`, so replacing it with a refusal turns "the demo does not need the
 * network" from a claim into a property of the run: if anything reached for it,
 * the demo would fail loudly rather than quietly succeed on a good day.
 */
const refuse = (): never => {
  throw new Error(
    "the network is unplugged for this run — something tried to fetch anyway",
  );
};

globalThis.fetch = refuse as unknown as typeof fetch;
