/**
 * A small JSON-RPC client for the three methods this indexer calls.
 *
 * Deliberately not `rpc.Server` from `@stellar/stellar-sdk`. That class parses
 * events into `xdr.ScVal` objects on the way through, and B1 stores them
 * undecoded — the raw variant it offers is `_getEvents`, and an example should
 * not be built on an underscore. Writing the request out also keeps the two
 * things this file is here to teach visible: that `cursor` and `limit` live
 * inside `pagination` while `startLedger` does not, and that the interesting
 * failures are JSON-RPC error codes rather than exceptions.
 *
 * The SDK is still a dependency — it encodes the topic filters, and the
 * decoding tasks downstream lean on it far more heavily than this.
 */
import { RPC_LIMITS } from "./network.js";
import type { Logger } from "./log.js";
import type { RpcFilter } from "./filters.js";

export type RawEvent = {
  type: "contract" | "system";
  ledger: number;
  ledgerClosedAt: string;
  contractId?: string;
  id: string;
  transactionIndex: number;
  operationIndex: number;
  txHash: string;
  inSuccessfulContractCall?: boolean;
  /** base64 `ScVal` XDR, one per topic. Stored exactly as it arrives. */
  topic?: string[];
  /** base64 `ScVal` XDR. */
  value: string;
};

export type GetEventsResponse = {
  events: RawEvent[];
  cursor: string;
  latestLedger: number;
  oldestLedger: number;
  latestLedgerCloseTime: string;
  oldestLedgerCloseTime: string;
};

export type GetHealthResponse = {
  status: string;
  latestLedger: number;
  oldestLedger: number;
  ledgerRetentionWindow: number;
};

/**
 * What the ingest loop needs from a server.
 *
 * Named as an interface so the loop can be driven by something other than a
 * live RPC — the tests here, and the recorded fixtures a later task replays
 * with the network unplugged.
 */
export type EventSource = {
  getEvents(
    request: GetEventsRequest & { filters: RpcFilter[]; limit?: number },
  ): Promise<GetEventsResponse>;
  getHealth(): Promise<GetHealthResponse>;
  getNetwork(): Promise<{ passphrase: string; protocolVersion: number }>;
};

export type GetEventsRequest =
  | { startLedger: number; endLedger?: number; cursor?: never }
  | { cursor: string; startLedger?: never; endLedger?: never };

/** A JSON-RPC error result. The server answered; it just said no. */
export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "RpcError";
  }

  /**
   * The one error the ingest loop has to recognise rather than report.
   *
   * Ask for a ledger — or resume from a cursor — older than the RPC server's
   * retention window and it answers `-32600 startLedger must be within the
   * ledger range: 4124535 - 4245494`. For a resuming indexer that is not a bad
   * request, it is history that no longer exists anywhere this program can
   * reach, and it needs saying in those words.
   */
  get retentionWindow(): { oldest: number; latest: number } | null {
    const match = /ledger range:\s*(\d+)\s*-\s*(\d+)/.exec(this.message);
    if (this.code !== -32600 || !match) return null;
    return { oldest: Number(match[1]), latest: Number(match[2]) };
  }
}

/** The server did not answer: DNS, connection reset, 502, timeout. */
export class RpcTransportError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "RpcTransportError";
  }
}

export type RpcOptions = {
  url: string;
  log: Logger;
  /** Attempts per call, including the first. Transport failures only. */
  maxAttempts?: number;
  timeoutMs?: number;
  /**
   * Abandon a request in flight. Wired to the second Ctrl-C, which is what
   * makes "stop now" a real stop rather than a process teardown — a page can
   * take a while to come back, and waiting for it is the thing the second
   * interrupt is asking not to do.
   */
  signal?: AbortSignal;
};

export class TraceRpc {
  private id = 0;

  constructor(private readonly options: RpcOptions) {}

  async getEvents(
    request: GetEventsRequest & { filters: RpcFilter[]; limit?: number },
  ): Promise<GetEventsResponse> {
    const { filters, limit, ...range } = request;
    if (limit !== undefined && limit > RPC_LIMITS.pageLimit) {
      throw new RangeError(`limit ${limit} exceeds the server's ${RPC_LIMITS.pageLimit}`);
    }
    return this.call<GetEventsResponse>("getEvents", {
      filters,
      // `cursor` and `limit` go inside `pagination`; the ledger bounds do not,
      // and sending a cursor together with either is rejected by the server.
      pagination: {
        ...("cursor" in range && range.cursor ? { cursor: range.cursor } : {}),
        ...(limit ? { limit } : {}),
      },
      ...("startLedger" in range && range.startLedger !== undefined
        ? { startLedger: range.startLedger }
        : {}),
      ...("endLedger" in range && range.endLedger !== undefined
        ? { endLedger: range.endLedger }
        : {}),
    });
  }

  getHealth = (): Promise<GetHealthResponse> => this.call<GetHealthResponse>("getHealth");

  getNetwork = (): Promise<{ passphrase: string; protocolVersion: number }> =>
    this.call("getNetwork");

  getLatestLedger = (): Promise<{ sequence: number }> => this.call("getLatestLedger");

  private async call<T>(method: string, params?: unknown): Promise<T> {
    const maxAttempts = this.options.maxAttempts ?? 10;
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: ++this.id,
      method,
      ...(params === undefined ? {} : { params }),
    });

    for (let attempt = 1; ; attempt++) {
      this.options.signal?.throwIfAborted();
      try {
        return await this.attempt<T>(method, body);
      } catch (error) {
        // An RpcError is the server's considered answer. Asking again with the
        // same arguments would get the same answer, so it goes straight up.
        if (error instanceof RpcError || attempt >= maxAttempts) throw error;
        this.options.signal?.throwIfAborted();
        const waitMs = Math.min(30_000, 500 * 2 ** (attempt - 1));
        this.options.log.warn("rpc call failed, retrying", {
          method,
          attempt,
          maxAttempts,
          waitMs,
          error: error instanceof Error ? error.message : String(error),
        });
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
  }

  private async attempt<T>(method: string, body: string): Promise<T> {
    let response: Response;
    try {
      response = await fetch(this.options.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: this.options.signal
          ? AbortSignal.any([
              this.options.signal,
              AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
            ])
          : AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
      });
    } catch (error) {
      if (this.options.signal?.aborted) throw error;
      throw new RpcTransportError(`${method}: ${(error as Error).message}`, error);
    }

    if (!response.ok) {
      throw new RpcTransportError(`${method}: HTTP ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as {
      result?: T;
      error?: { code: number; message: string; data?: unknown };
    };

    if (payload.error) {
      throw new RpcError(payload.error.code, payload.error.message, payload.error.data);
    }
    if (payload.result === undefined) {
      throw new RpcTransportError(`${method}: response had neither result nor error`);
    }
    return payload.result;
  }
}
