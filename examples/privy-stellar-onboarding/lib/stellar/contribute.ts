import {
  Address,
  BASE_FEE,
  Contract,
  Horizon,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
} from "@stellar/stellar-sdk";
import {
  POOL_ADDRESS,
  USDC,
  USDC_CODE,
  USDC_ISSUER,
  USDC_SAC_ID,
  fromStroops,
  isContractAddress,
  toStroops,
} from "./assets";
import type { Signer } from "@/lib/signing/signer";
import { ContributionError } from "./errors";
import { horizon } from "./horizon";
import { NETWORK_PASSPHRASE, SOROBAN_RPC_URL } from "./network";

export const soroban = new rpc.Server(SOROBAN_RPC_URL);

type AssetBalance = Horizon.HorizonApi.BalanceLineAsset;

function findUsdcLine(
  account: Horizon.AccountResponse,
): AssetBalance | undefined {
  return account.balances.find(
    (balance): balance is AssetBalance =>
      (balance.asset_type === "credit_alphanum4" ||
        balance.asset_type === "credit_alphanum12") &&
      balance.asset_code === USDC_CODE &&
      balance.asset_issuer === USDC_ISSUER,
  );
}

/** USDC balance as a decimal string, or null when there is no trustline. */
export async function getUsdcBalance(address: string): Promise<string | null> {
  const account = await horizon.loadAccount(address);
  return findUsdcLine(account)?.balance ?? null;
}

/**
 * Adds the USDC trustline. This is the step the proposal calls out: without it
 * the wallet cannot receive USDC at all, no matter who sends it.
 *
 * Costs 0.5 XLM, held in reserve rather than spent, and released if the
 * trustline is ever removed.
 */
export async function addTrustline(signer: Signer): Promise<string> {
  const account = await horizon.loadAccount(signer.address);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.changeTrust({ asset: USDC }))
    .setTimeout(180)
    .build();

  // The signed transaction, which is not always the one passed in — see the
  // note on Signer.signTransaction.
  const signed = await signer.signTransaction(tx);

  try {
    const result = await horizon.submitTransaction(signed);
    return result.hash;
  } catch (caught) {
    throw new ContributionError({
      kind: "submission-failed",
      detail: horizonErrorDetail(caught),
    });
  }
}

/**
 * Removes the USDC trustline, which releases the 0.5 XLM it had set aside.
 *
 * The opt-out is the same `changeTrust` operation as above with a limit of
 * zero: not a different mechanism, the same one asking for room for nothing.
 *
 * What it cannot do is drop a trustline that still holds tokens — the protocol
 * refuses with `CHANGE_TRUST_INVALID_LIMIT` rather than deleting a balance
 * behind your back. So a wallet that still holds some sends it back to the
 * issuer first, in the same transaction: a payment to the issuer of an asset
 * is how that asset is destroyed, and the two operations settle together or
 * not at all, which is what stops a burn from landing without the opt-out it
 * was for.
 *
 * The amount burned is read from the chain here rather than passed in, so it
 * is the balance at the moment of building rather than whatever a page last
 * saw. Anything that arrives between that read and the submission leaves the
 * balance non-zero and takes the whole transaction down with it — the honest
 * failure, rather than a partial one.
 */
export async function removeTrustline(
  signer: Signer,
): Promise<{ hash: string; burned: string | null }> {
  const account = await horizon.loadAccount(signer.address);
  const line = findUsdcLine(account);
  const held = line && toStroops(line.balance) > 0n ? line.balance : null;

  const builder = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  });

  if (held !== null) {
    builder.addOperation(
      Operation.payment({
        destination: USDC_ISSUER,
        asset: USDC,
        amount: held,
      }),
    );
  }

  const tx = builder
    .addOperation(Operation.changeTrust({ asset: USDC, limit: "0" }))
    .setTimeout(180)
    .build();

  const signed = await signer.signTransaction(tx);

  try {
    const result = await horizon.submitTransaction(signed);
    return { hash: result.hash, burned: held };
  } catch (caught) {
    throw new ContributionError({
      kind: "submission-failed",
      detail: horizonErrorDetail(caught),
    });
  }
}

/**
 * Checks the two conditions that are knowable before spending anything.
 *
 * Simulation would catch both, but only as an opaque host error. Reading the
 * state directly means the donor is told which account is missing a trustline
 * and how short the balance is, rather than being shown a contract error code.
 */
export async function preflight(
  donor: string,
  amount: string,
  recipient: string = POOL_ADDRESS,
): Promise<void> {
  const wanted = toStroops(amount);

  const donorAccount = await horizon.loadAccount(donor);
  const line = findUsdcLine(donorAccount);
  if (!line) {
    throw new ContributionError({
      kind: "missing-trustline",
      who: "donor",
      address: donor,
    });
  }

  const held = toStroops(line.balance);
  if (held < wanted) {
    throw new ContributionError({
      kind: "insufficient-balance",
      have: fromStroops(held),
      want: fromStroops(wanted),
    });
  }

  // A contract recipient holds balances in contract storage, so it needs no
  // trustline. Only a G-address does.
  if (!isContractAddress(recipient)) {
    const recipientAccount = await horizon.loadAccount(recipient);
    if (!findUsdcLine(recipientAccount)) {
      throw new ContributionError({
        kind: "missing-trustline",
        who: "recipient",
        address: recipient,
      });
    }
  }
}

/**
 * Contributes `amount` USDC through the Stellar Asset Contract.
 *
 * `skipPreflight` exists to demonstrate the failure modes. It does not induce a
 * failure — it removes the early check, so a contribution that would have
 * worked still works. Pair it with a genuinely impossible contribution and the
 * mistake arrives from Soroban as a host error rather than as a sentence, which
 * is what a donor would see if this app swallowed the distinction.
 *
 * The `from` argument is the transaction's own source account, which is what
 * satisfies the SAC's `require_auth` — no separate authorization entry has to
 * be signed. That is the difference between one signature and a much harder
 * problem, and it holds only while these two addresses are the same.
 */
export async function contribute(
  signer: Signer,
  amount: string,
  options: { recipient?: string; skipPreflight?: boolean } = {},
): Promise<string> {
  const donor = signer.address;
  const recipient = options.recipient ?? POOL_ADDRESS;

  if (!options.skipPreflight) {
    await preflight(donor, amount, recipient);
  }

  const account = await horizon.loadAccount(donor);
  const contract = new Contract(USDC_SAC_ID);

  const built = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "transfer",
        Address.fromString(donor).toScVal(),
        Address.fromString(recipient).toScVal(),
        nativeToScVal(toStroops(amount), { type: "i128" }),
      ),
    )
    .setTimeout(180)
    .build();

  const simulation = await soroban.simulateTransaction(built);
  if (rpc.Api.isSimulationError(simulation)) {
    throw new ContributionError({
      kind: "simulation-failed",
      detail: simulation.error,
    });
  }

  // Simulation determines the footprint and resource fees, so assembling
  // produces a *different* transaction. Signing before this point would sign a
  // hash that no longer matches what gets submitted.
  const prepared = rpc.assembleTransaction(built, simulation).build();

  const signed = await signer.signTransaction(prepared);

  const sent = await soroban.sendTransaction(signed);
  if (sent.status === "ERROR") {
    throw new ContributionError({
      kind: "submission-failed",
      detail: JSON.stringify(sent.errorResult ?? sent.status),
    });
  }

  // Soroban submission is asynchronous: sendTransaction only queues it.
  const settled = await soroban.pollTransaction(sent.hash, { attempts: 30 });
  if (settled.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new ContributionError({
      kind: "submission-failed",
      detail: `Transaction ${sent.hash} ended as ${settled.status}.`,
    });
  }

  return sent.hash;
}

function horizonErrorDetail(caught: unknown): string {
  const codes = (
    caught as {
      response?: { data?: { extras?: { result_codes?: unknown } } };
    }
  )?.response?.data?.extras?.result_codes;

  if (codes) return JSON.stringify(codes);
  return caught instanceof Error ? caught.message : String(caught);
}
