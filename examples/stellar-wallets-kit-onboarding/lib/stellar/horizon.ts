import { Horizon, NotFoundError } from "@stellar/stellar-sdk";
import { FRIENDBOT_URL, HORIZON_URL } from "./network";

export const horizon = new Horizon.Server(HORIZON_URL);

/**
 * Asks Friendbot to create and fund `address` with testnet XLM.
 *
 * Friendbot only funds accounts that do not yet exist. Calling it for an
 * already-funded account returns a 400, which is a no-op rather than a real
 * failure, so it is reported as such.
 */
export async function fundWithFriendbot(
  address: string,
): Promise<{ funded: boolean; note: string }> {
  const response = await fetch(
    `${FRIENDBOT_URL}?addr=${encodeURIComponent(address)}`,
  );

  if (response.ok) {
    return { funded: true, note: "Friendbot funded your wallet." };
  }

  const body = await response.text();
  if (body.includes("createAccountAlreadyExist") || response.status === 400) {
    return { funded: false, note: "Your wallet was already funded." };
  }

  throw new Error(`Friendbot failed (${response.status}): ${body.slice(0, 200)}`);
}

/**
 * Has this wallet already sent XLM to `destination`?
 *
 * This is the record left behind by the signing check, and it is what lets that
 * step stay ticked across a reload instead of depending on this session's
 * memory of the click. Matched on that one payment rather than on "signed
 * anything" so that adding a trustline later cannot tick the step off on its
 * behalf.
 */
export async function hasNativePaymentTo(
  address: string,
  destination: string,
): Promise<boolean> {
  try {
    const page = await horizon
      .payments()
      .forAccount(address)
      .order("desc")
      .limit(200)
      .call();

    return page.records.some(
      (record) =>
        record.type === "payment" &&
        record.asset_type === "native" &&
        record.from === address &&
        record.to === destination,
    );
  } catch (error) {
    // An account nobody has funded yet has no history, which reads as a 404.
    if (error instanceof NotFoundError) return false;
    throw error;
  }
}

/** Native XLM balance as a decimal string, or null if the account does not exist yet. */
export async function getXlmBalance(address: string): Promise<string | null> {
  try {
    const account = await horizon.loadAccount(address);
    const native = account.balances.find((b) => b.asset_type === "native");
    return native ? native.balance : "0";
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
}
