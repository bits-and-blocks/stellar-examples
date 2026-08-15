"use client";

import {
  FeeBumpTransaction,
  Keypair,
  type Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { NETWORK_PASSPHRASE } from "@/lib/stellar/network";
import { type Signer, SigningError } from "./signer";

/**
 * The other side of the `Signer` interface: a wallet the user already has.
 *
 * Nothing here holds a key or sees one. The transaction goes out as XDR, the
 * user reads it in Freighter or xBull and approves it, and signed XDR comes
 * back. Compared with the Privy implementation this file does no cryptography
 * at all — it delegates, then checks that what came back is what it asked for.
 *
 * Only the Freighter and xBull modules are registered. The Kit ships many
 * more, and `defaultModules()` would enable them all, but WalletConnect
 * configuration is out of scope for this example and every unused module is
 * bundle weight for a wallet nobody here is being asked to install.
 */

type Kit = typeof import("@creit.tech/stellar-wallets-kit").StellarWalletsKit;

let loading: Promise<Kit> | null = null;

/**
 * The Kit, imported on first use and initialised exactly once.
 *
 * The import has to be dynamic. The Kit registers the custom elements for its
 * modal as a side effect of being imported, which needs a DOM, and Next
 * renders client components on the server before they ever reach a browser. A
 * top-level import of this package breaks the build rather than the page.
 */
function kit(): Promise<Kit> {
  loading ??= (async () => {
    const [
      { StellarWalletsKit, Networks },
      { FreighterModule },
      { xBullModule },
    ] = await Promise.all([
      import("@creit.tech/stellar-wallets-kit"),
      import("@creit.tech/stellar-wallets-kit/modules/freighter"),
      import("@creit.tech/stellar-wallets-kit/modules/xbull"),
    ]);

    // The Kit names networks by an enum of its own. This app names one by the
    // passphrase it pins, and the two have to be the same network or every
    // hash signed here would be signed for somewhere else.
    if (Networks.TESTNET !== NETWORK_PASSPHRASE) {
      throw new SigningError(
        "The Wallets Kit and this app disagree about which network testnet is.",
        "This is a bug in the integration. Nothing was connected.",
      );
    }

    StellarWalletsKit.init({
      modules: [new FreighterModule(), new xBullModule()],
      network: Networks.TESTNET,
    });

    return StellarWalletsKit;
  })();

  return loading;
}

/** An address the Kit is connected to, and the wallet it came from. */
export type KitConnection = {
  address: string;
  /** The wallet's own name for itself: "Freighter", "xBull". */
  wallet: string;
};

/**
 * Opens the Kit's own wallet picker and returns what the user connected.
 *
 * This is the whole of the "log in" step in Kit mode. There is no account to
 * create and nothing to fund a key with — the wallet exists already, and the
 * user is choosing which of its accounts to expose.
 */
export async function connectKit(): Promise<KitConnection> {
  const swk = await kit();
  const { address } = await swk.authModal();
  await assertTestnet(swk);
  return { address, wallet: swk.selectedModule.productName };
}

/**
 * The connection from a previous visit, if there is one.
 *
 * The Kit keeps the active address and the chosen wallet in localStorage and
 * rehydrates both when it loads, so a reload does not send someone back to the
 * picker. An address it cannot produce means nobody has connected yet.
 */
export async function restoreKit(): Promise<KitConnection | null> {
  const swk = await kit();
  try {
    const { address } = await swk.getAddress();
    if (!address) return null;
    return { address, wallet: swk.selectedModule.productName };
  } catch {
    // No wallet selected yet, or one that is no longer installed. Either way
    // there is nothing to restore and the picker is the way back in.
    return null;
  }
}

export async function disconnectKit(): Promise<void> {
  const swk = await kit();
  await swk.disconnect();
}

/**
 * Refuses to go on if the wallet is pointed at a network this app cannot use.
 *
 * Every transaction here is built and hashed against the testnet passphrase,
 * so a wallet on Public would be asked to approve something meaningless to the
 * network it is watching. Wallets differ in how they react — some sign it
 * anyway, some reject it with an error of their own — and neither outcome
 * explains itself. This does.
 */
async function assertTestnet(swk: Kit): Promise<void> {
  let passphrase: string;
  try {
    ({ networkPassphrase: passphrase } = await swk.getNetwork());
  } catch {
    // Not every wallet will answer, and a wallet that cannot say which network
    // it is on is not evidence that it is on the wrong one.
    return;
  }

  if (passphrase && passphrase !== NETWORK_PASSPHRASE) {
    throw new SigningError(
      "Your wallet is not on Stellar testnet.",
      "This app is testnet-only. Switch the network to Test Net in your wallet, then connect again.",
    );
  }
}

/** A `Signer` backed by whichever wallet the Kit is connected to. */
export function kitSigner(address: string): Signer {
  return {
    address,

    async signTransaction(tx: Transaction) {
      const swk = await kit();

      let signedTxXdr: string;
      try {
        ({ signedTxXdr } = await swk.signTransaction(tx.toXDR(), {
          address,
          networkPassphrase: NETWORK_PASSPHRASE,
        }));
      } catch (caught) {
        // The ordinary path through here is a person deciding not to approve
        // something, which is not a fault and should not read like one.
        throw new SigningError(
          "Your wallet did not sign the transaction.",
          `The request was declined or closed in your wallet. Nothing was submitted. ${detail(caught)}`.trim(),
        );
      }

      const returned = TransactionBuilder.fromXDR(
        signedTxXdr,
        NETWORK_PASSPHRASE,
      );

      // Nothing this app builds is a fee bump, so anything that comes back as
      // one is a wallet doing something we did not ask for and did not check.
      if (returned instanceof FeeBumpTransaction) {
        throw new SigningError(
          "Your wallet returned a fee-bump transaction.",
          "This app does not use fee bumps, so the transaction that came back is not the one it sent. Nothing was submitted.",
        );
      }

      // A wallet is free to hand back whatever it likes, and two of the ways
      // that can go wrong are invisible at submission time: it can sign a
      // transaction other than the one it was given, or sign with an account
      // other than the one asked for. Freighter signs with whichever account
      // is *active*, and someone can switch that between connecting and
      // approving, so this is a live case rather than a theoretical one.
      if (!returned.hash().equals(tx.hash())) {
        throw new SigningError(
          "Your wallet changed the transaction before signing it.",
          "What came back is not what this app built, so it was not submitted.",
        );
      }

      if (!signedBy(returned, address)) {
        throw new SigningError(
          "Your wallet signed with a different account.",
          `This app is using ${address.slice(0, 6)}…${address.slice(-6)}. Switch back to that account in your wallet, or reconnect to use the one you are on now.`,
        );
      }

      return returned;
    },
  };
}

/** Whether `tx` carries a signature that verifies against `address`. */
function signedBy(tx: Transaction, address: string): boolean {
  const key = Keypair.fromPublicKey(address);
  const hash = tx.hash();
  return tx.signatures.some((signature) => {
    try {
      return key.verify(hash, signature.signature());
    } catch {
      return false;
    }
  });
}

function detail(caught: unknown): string {
  if (caught && typeof caught === "object" && "message" in caught) {
    return String((caught as { message: unknown }).message);
  }
  return caught === undefined ? "" : String(caught);
}
