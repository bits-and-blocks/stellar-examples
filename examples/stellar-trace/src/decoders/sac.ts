/**
 * The Stellar Asset Contract's events, as CAP-67 defines them today.
 *
 * Everything specific to tokens lives in this file. The registry next door
 * does not know an asset from an amount, which is the property that makes
 * pointing this example at another contract a matter of adding a file beside
 * this one and a line in [`index.ts`](./index.ts).
 *
 * Shapes, each confirmed against a real testnet event committed under
 * `test/fixtures/sac-events.json`:
 *
 *     transfer   [transfer, from: Address, to: Address, asset: String]
 *     mint       [mint,     to: Address,   asset: String]
 *     burn       [burn,     from: Address, asset: String]
 *     clawback   [clawback, from: Address, asset: String]
 *     fee        [fee,      from: Address]
 *     approve    [approve,  from: Address, spender: Address, asset: String]
 *
 * The value is usually an `i128` of stroops. For `transfer` and `mint` it is a
 * **map** instead when the destination is muxed — `{amount, to_muxed_id}` —
 * which is easy to miss, because the common case decodes fine right up until
 * the first muxed payment goes past. `approve` is a `vec` of amount and
 * expiry.
 *
 * Two things these decoders deliberately do not assume:
 *
 * **That the emitting contract is the SAC it claims to be.** Any contract can
 * emit a four-topic `transfer` naming USDC. The asset in the last topic gives
 * a way to check rather than believe: the SAC's address is derived from the
 * asset and the network passphrase, so deriving it and comparing settles it.
 * Every decoded event says which way that went.
 *
 * **That seven decimals is right.** It is, for a SAC of a classic asset, and
 * that is exactly the case the check above establishes. Where the check does
 * not pass, the amount is printed as the integer it is.
 */
import { Address, Asset, scValToNative, xdr } from "@stellar/stellar-sdk";

import { formatStroops, short } from "../format.js";
import { NETWORK_PASSPHRASE } from "../network.js";
import { ANY_CONTRACT, type DecoderRegistry } from "./registry.js";
import type { DecodedEvent, EventInput } from "./types.js";

export function registerSacDecoders(registry: DecoderRegistry): DecoderRegistry {
  return registry
    .register(ANY_CONTRACT, "transfer", decodeTransfer)
    .register(ANY_CONTRACT, "mint", decodeMint)
    .register(ANY_CONTRACT, "burn", decodeBurn)
    .register(ANY_CONTRACT, "clawback", decodeClawback)
    .register(ANY_CONTRACT, "fee", decodeFee)
    .register(ANY_CONTRACT, "approve", decodeApprove);
}

/** `[transfer, from, to, asset]`, or the pre-protocol-23 form without asset. */
function decodeTransfer(event: EventInput): DecodedEvent | null {
  const [, from, to, asset] = event.topics;
  const sender = readAddress(from);
  const recipient = readAddress(to);
  const amount = readAmount(event.data);
  if (!sender || !recipient || !amount) return null;
  if (event.topics.length > 4) return null;

  const token = readAsset(event, asset);
  const fields: Record<string, string> = {
    from: sender,
    to: recipient,
    amount: token.units(amount.value),
    ...(token.label ? { asset: token.label } : {}),
    ...amount.extra,
  };

  return {
    kind: "transfer",
    summary:
      `${token.units(amount.value)}${token.code ? ` ${token.code}` : ""}` +
      ` from ${short(sender)} to ${short(recipient)}` +
      (amount.extra["to_muxed_id"] ? ` (muxed: ${amount.extra["to_muxed_id"]})` : ""),
    fields,
    notes: token.notes,
  };
}

/**
 * `[mint, to, asset]`.
 *
 * Protocol 23 dropped the admin from these topics. A four-topic mint is the
 * older `[mint, admin, to, asset]`, still reachable through an archival RPC,
 * and is decoded as such rather than refused.
 */
function decodeMint(event: EventInput): DecodedEvent | null {
  const legacy = event.topics.length === 4;
  const to = readAddress(event.topics[legacy ? 2 : 1]);
  const asset = event.topics[legacy ? 3 : 2];
  const admin = legacy ? readAddress(event.topics[1]) : null;
  const amount = readAmount(event.data);
  if (!to || !amount || !isAssetString(asset)) return null;

  const token = readAsset(event, asset);
  return {
    kind: "mint",
    summary:
      `${token.units(amount.value)}${token.code ? ` ${token.code}` : ""}` +
      ` minted to ${short(to)}`,
    fields: {
      to,
      amount: token.units(amount.value),
      ...(token.label ? { asset: token.label } : {}),
      ...(admin ? { admin } : {}),
      ...amount.extra,
    },
    notes: legacy
      ? [...token.notes, "four topics: the pre-protocol-23 shape, with the admin"]
      : token.notes,
  };
}

/** `[burn, from, asset]`. */
const decodeBurn = movement("burn", "burned from");

/** `[clawback, from, asset]`. */
const decodeClawback = movement("clawback", "clawed back from");

function movement(kind: string, verb: string) {
  return (event: EventInput): DecodedEvent | null => {
    const from = readAddress(event.topics[1]);
    const asset = event.topics[2];
    const amount = readAmount(event.data);
    if (!from || !amount || !isAssetString(asset)) return null;

    const token = readAsset(event, asset);
    return {
      kind,
      summary:
        `${token.units(amount.value)}${token.code ? ` ${token.code}` : ""}` +
        ` ${verb} ${short(from)}`,
      fields: {
        from,
        amount: token.units(amount.value),
        ...(token.label ? { asset: token.label } : {}),
        ...amount.extra,
      },
      notes: token.notes,
    };
  };
}

/**
 * `[fee, from]`, emitted by the native SAC for every classic transaction.
 *
 * There are two per Soroban transaction and the second one is negative: the
 * resource fee is charged up front and the unused part refunded afterwards.
 * A decoder that assumed fees were positive would report a refund as a charge.
 */
function decodeFee(event: EventInput): DecodedEvent | null {
  const payer = readAddress(event.topics[1]);
  const amount = readAmount(event.data);
  if (!payer || !amount || event.topics.length !== 2) return null;

  const refund = amount.value < 0n;
  const magnitude = refund ? -amount.value : amount.value;
  return {
    kind: "fee",
    summary: refund
      ? `${formatStroops(magnitude)} XLM refunded to ${short(payer)}`
      : `${formatStroops(magnitude)} XLM fee from ${short(payer)}`,
    fields: {
      [refund ? "to" : "from"]: payer,
      amount: formatStroops(magnitude),
      stroops: amount.value.toString(),
    },
    notes: refund ? ["negative: the unused part of a reserved resource fee"] : [],
  };
}

/** `[approve, from, spender, asset]` with a value of `[amount, expiry ledger]`. */
function decodeApprove(event: EventInput): DecodedEvent | null {
  const from = readAddress(event.topics[1]);
  const spender = readAddress(event.topics[2]);
  const asset = event.topics[3];
  if (!from || !spender || !isAssetString(asset)) return null;
  if (event.data.switch() !== xdr.ScValType.scvVec()) return null;

  const parts = event.data.vec() ?? [];
  const amount = parts[0] ? readAmount(parts[0]) : null;
  const expiry = parts[1] ? String(scValToNative(parts[1])) : null;
  if (!amount) return null;

  const token = readAsset(event, asset);
  return {
    kind: "approve",
    summary:
      `${token.units(amount.value)}${token.code ? ` ${token.code}` : ""}` +
      ` approved for ${short(spender)}${expiry ? ` until ledger ${expiry}` : ""}`,
    fields: {
      from,
      spender,
      amount: token.units(amount.value),
      ...(token.label ? { asset: token.label } : {}),
      ...(expiry ? { "expires at ledger": expiry } : {}),
    },
    notes: token.notes,
  };
}

// --- reading the pieces ------------------------------------------------------

const readAddress = (value: xdr.ScVal | undefined): string | null => {
  if (!value || value.switch() !== xdr.ScValType.scvAddress()) return null;
  return Address.fromScAddress(value.address()).toString();
};

const isAssetString = (value: xdr.ScVal | undefined): value is xdr.ScVal =>
  value !== undefined && value.switch() === xdr.ScValType.scvString();

/**
 * The amount, and whatever else the value carried.
 *
 * `i128` in the ordinary case; a map of `amount` plus extras — `to_muxed_id`
 * on a payment to a muxed account — in the case that only shows up once
 * somebody pays an exchange.
 */
function readAmount(
  data: xdr.ScVal,
): { value: bigint; extra: Record<string, string> } | null {
  const arm = data.switch().name;
  if (arm === "scvI128" || arm === "scvU128") {
    return { value: scValToNative(data) as bigint, extra: {} };
  }
  if (arm !== "scvMap") return null;

  let value: bigint | null = null;
  const extra: Record<string, string> = {};
  for (const entry of data.map() ?? []) {
    if (entry.key().switch() !== xdr.ScValType.scvSymbol()) continue;
    const name = entry.key().sym().toString();
    const inner = entry.val();
    if (name === "amount") {
      const kind = inner.switch().name;
      if (kind !== "scvI128" && kind !== "scvU128") return null;
      value = scValToNative(inner) as bigint;
      continue;
    }
    try {
      extra[name] = String(scValToNative(inner));
    } catch {
      extra[name] = `<${inner.switch().name}>`;
    }
  }
  return value === null ? null : { value, extra };
}

type Token = {
  /** `USDC` or `XLM`, for a summary line. */
  code: string | null;
  /** `USDC:GBBD…FLA5`, for the fields. */
  label: string | null;
  /** Formats an amount, at seven decimals only where that is established. */
  units: (value: bigint) => string;
  notes: string[];
};

/**
 * Read the asset topic, and check the emitting contract against it.
 *
 * `Asset.contractId` derives the SAC's address from the asset and the network
 * passphrase. If the contract that emitted this event is that address, the
 * event is the SAC's and the asset is a classic one, which settles both who is
 * speaking and how many decimal places the amount has. If it is not, the event
 * may still be perfectly legitimate — a token contract can call its events
 * whatever it likes — but nothing here should present it as that asset moving.
 */
function readAsset(event: EventInput, asset: xdr.ScVal | undefined): Token {
  const raw = ((): string | null => {
    if (!isAssetString(asset)) return null;
    const native = scValToNative(asset);
    return typeof native === "string" ? native : null;
  })();

  if (raw === null) {
    return {
      code: null,
      label: null,
      units: (value) => value.toString(),
      notes: [
        "no asset topic, so this is not the Stellar Asset Contract's shape — " +
          "the amount is shown as the integer it is",
      ],
    };
  }

  const code = raw === "native" ? "XLM" : (raw.split(":")[0] ?? raw);
  const derived = deriveSacAddress(raw);

  if (derived === null) {
    return {
      code,
      label: raw,
      units: (value) => value.toString(),
      notes: [`"${raw}" is not an asset this tool can parse`],
    };
  }
  if (derived !== event.contractId) {
    return {
      code,
      label: raw,
      units: (value) => value.toString(),
      notes: [
        `the emitting contract is not ${raw}'s Stellar Asset Contract ` +
          `(that would be ${short(derived, 6)}), so the asset name is this ` +
          `contract's claim rather than a fact`,
      ],
    };
  }
  return {
    code,
    label: raw,
    units: formatStroops,
    notes: [`emitted by ${raw}'s Stellar Asset Contract, derived and matched`],
  };
}

function deriveSacAddress(asset: string): string | null {
  try {
    if (asset === "native") return Asset.native().contractId(NETWORK_PASSPHRASE);
    const [code, issuer] = asset.split(":");
    if (!code || !issuer) return null;
    return new Asset(code, issuer).contractId(NETWORK_PASSPHRASE);
  } catch {
    return null;
  }
}
