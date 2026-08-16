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
    return { funded: true, note: "Friendbot created and funded the account." };
  }

  const body = await response.text();
  if (body.includes("createAccountAlreadyExist") || response.status === 400) {
    return { funded: false, note: "Account already exists and is funded." };
  }

  throw new Error(`Friendbot failed (${response.status}): ${body.slice(0, 200)}`);
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
