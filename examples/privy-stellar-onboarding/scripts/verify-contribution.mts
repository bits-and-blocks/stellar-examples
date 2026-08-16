/**
 * Exercises the contribution path in lib/stellar against live testnet.
 *
 * Run with: pnpm verify:contribution
 *
 * This imports the same functions the browser calls. A local Keypair stands in
 * for Privy, exposing the identical interface — a 32-byte hash in, a 64-byte
 * hex signature out — so everything except Privy's signing service is the real
 * code. What that leaves untested is exactly what Privy is responsible for.
 *
 * It uses a throwaway issuer rather than Circle's USDC for one reason: the
 * success case needs the script to mint itself a supply, and Circle's faucet is
 * captcha-gated. The SAC is generated per-asset by the protocol and is the same
 * contract either way, which is what makes the substitution sound — and is also
 * the fallback the brief provides for if the faucet is flaky.
 */
import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  rpc,
} from "@stellar/stellar-sdk";

const HORIZON_URL = "https://horizon-testnet.stellar.org";
const horizon = new Horizon.Server(HORIZON_URL);

/**
 * The script builds transactions with its own server instances rather than
 * reusing the ones lib/stellar exports.
 *
 * Not a stylistic choice: this file is ESM (.mts) while lib/*.ts loads as CJS
 * under tsx, so the two get separate copies of stellar-sdk and separate
 * `Transaction` classes. Passing a transaction built here into a server
 * imported from there fails an `instanceof` check inside the SDK. Each side
 * stays internally consistent instead. The app itself has no such split — Next
 * loads everything as ESM.
 */
const sorobanLocal = new rpc.Server("https://soroban-testnet.stellar.org");

const issuer = Keypair.random();
const donor = Keypair.random();
const pool = Keypair.random();

// lib/stellar/assets.ts reads these at import time, so they must be set before
// the dynamic import below.
process.env.NEXT_PUBLIC_ASSET_CODE = "DEMO";
process.env.NEXT_PUBLIC_ASSET_ISSUER = issuer.publicKey();
process.env.NEXT_PUBLIC_POOL_ADDRESS = pool.publicKey();

const { addTrustline, contribute, getUsdcBalance } = await import(
  "../lib/stellar/contribute.js"
);
const { ContributionError } = await import("../lib/stellar/errors.js");
const { toStroops } = await import("../lib/stellar/assets.js");
const { privySigner } = await import("../lib/signing/privy.js");
type Failure = import("../lib/stellar/errors.js").ContributionFailure;
type Signer = import("../lib/signing/signer.js").Signer;

/**
 * A `Signer` for the contribution path with no Privy account behind it.
 *
 * This is the real Privy adapter — `privySigner`, the same function the app
 * builds its signer from — handed a local key in place of Privy's service. So
 * the hash extraction, the hint, and the `DecoratedSignature` attachment are
 * all the shipped code, and the only thing standing in is the one part a
 * script cannot have: a key Privy holds.
 *
 * Constructing it through lib rather than signing here also keeps every XDR
 * object on one side of the module split described above.
 */
const signerFor = (kp: Keypair): Signer =>
  privySigner(kp.publicKey(), async ({ address, chainType, hash }) => {
    if (chainType !== "stellar") throw new Error("unexpected chainType");
    if (address !== kp.publicKey()) throw new Error("unexpected address");
    const bytes = Buffer.from(hash.slice(2), "hex");
    if (bytes.length !== 32) throw new Error(`hash was ${bytes.length} bytes`);
    return { signature: `0x${kp.sign(bytes).toString("hex")}` as const };
  });

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

async function expectFailure(
  name: string,
  kind: Failure["kind"],
  action: () => Promise<unknown>,
): Promise<void> {
  try {
    await action();
    check(name, false, `expected ${kind}, but it succeeded`);
  } catch (caught) {
    if (caught instanceof ContributionError) {
      check(
        name,
        caught.failure.kind === kind,
        caught.failure.kind === kind
          ? caught.message
          : `expected ${kind}, got ${caught.failure.kind}`,
      );
    } else {
      check(name, false, `unclassified: ${(caught as Error).message}`);
    }
  }
}

const fund = async (kp: Keypair) => {
  const r = await fetch(`https://friendbot.stellar.org?addr=${kp.publicKey()}`);
  if (!r.ok) throw new Error(`friendbot ${r.status}`);
};

const submit = async (kp: Keypair, build: (b: TransactionBuilder) => TransactionBuilder) => {
  const account = await horizon.loadAccount(kp.publicKey());
  const tx = build(
    new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    }),
  )
    .setTimeout(180)
    .build();
  tx.sign(kp);
  return horizon.submitTransaction(tx);
};

/**
 * Soroban operations cannot be submitted through Horizon unprepared: without a
 * simulated footprint and resource fees they are rejected as `tx_malformed`.
 * They also have to be signed *after* preparation, since preparing rebuilds the
 * transaction and changes its hash.
 */
const submitSorobanOp = async (
  kp: Keypair,
  build: (b: TransactionBuilder) => TransactionBuilder,
) => {
  const account = await horizon.loadAccount(kp.publicKey());
  const built = build(
    new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    }),
  )
    .setTimeout(180)
    .build();

  const prepared = await sorobanLocal.prepareTransaction(built);
  prepared.sign(kp);

  const sent = await sorobanLocal.sendTransaction(prepared);
  if (sent.status === "ERROR") {
    throw new Error(`send failed: ${JSON.stringify(sent.errorResult)}`);
  }
  const settled = await sorobanLocal.pollTransaction(sent.hash, { attempts: 30 });
  if (settled.status !== "SUCCESS") {
    throw new Error(`settled as ${settled.status}`);
  }
  return sent.hash;
};

// --- setup ----------------------------------------------------------------
console.log("\nSetting up throwaway asset DEMO…");
console.log("  issuer:", issuer.publicKey());
console.log("  donor :", donor.publicKey());
console.log("  pool  :", pool.publicKey());

await Promise.all([fund(issuer), fund(donor), fund(pool)]);
const asset = new Asset("DEMO", issuer.publicKey());

// The pool can receive; the donor deliberately cannot, yet.
await submit(pool, (b) => b.addOperation(Operation.changeTrust({ asset })));
console.log("  pool trustline established.");

// The SAC must exist before it can be called. Circle's USDC already has one
// deployed; a fresh issuer does not, which is the hidden cost of the fallback.
await submitSorobanOp(issuer, (b) =>
  b.addOperation(Operation.createStellarAssetContract({ asset })),
);
console.log("  DEMO SAC deployed.");

// --- failure cases --------------------------------------------------------
console.log("\nFailure taxonomy:");

await expectFailure("missing trustline (donor)", "missing-trustline", () =>
  contribute(signerFor(donor), "5"),
);

await expectFailure(
  "missing trustline surfaces from Soroban when preflight is skipped",
  "simulation-failed",
  () =>
    contribute(signerFor(donor), "5", {
      skipPreflight: true,
    }),
);

console.log("\n  adding donor trustline…");
const trustlineTx = await addTrustline(signerFor(donor));
check("changeTrust signed by the stand-in signer", true, trustlineTx);

await expectFailure("insufficient balance", "insufficient-balance", () =>
  contribute(signerFor(donor), "5"),
);

await submit(issuer, (b) =>
  b.addOperation(
    Operation.payment({
      destination: donor.publicKey(),
      asset,
      amount: "100",
    }),
  ),
);
console.log("  donor funded with 100 DEMO.");

// Deliberately checked only after the donor is funded. Preflight reports the
// donor's own problems before the recipient's, so with a zero balance this
// case would correctly report insufficient-balance instead and prove nothing.
const noTrustlineRecipient = Keypair.random();
await fund(noTrustlineRecipient);
await expectFailure("missing trustline (recipient)", "missing-trustline", () =>
  contribute(signerFor(donor), "1", {
    recipient: noTrustlineRecipient.publicKey(),
  }),
);

// --- success case ---------------------------------------------------------
console.log("\nSuccess case:");

const hash = await contribute(signerFor(donor), "25");
check("SAC transfer accepted", true, hash);
console.log(`     https://stellar.expert/explorer/testnet/tx/${hash}`);

const donorLeft = await getUsdcBalance(donor.publicKey());
const poolHas = await getUsdcBalance(pool.publicKey());
check("donor debited", donorLeft === "75.0000000", `balance ${donorLeft}`);
check("pool credited", poolHas === "25.0000000", `balance ${poolHas}`);

// Pins the behaviour that made the first version of the UI failure demo
// misleading: skipPreflight removes a check, it does not induce a failure. With
// a trustline and enough balance, a contribution must still go through.
const skipped = await contribute(signerFor(donor), "5", {
  skipPreflight: true,
});
check("skipping preflight still succeeds when state is healthy", true, skipped);

await expectFailure(
  "over-balance without preflight degrades to a host error",
  "simulation-failed",
  () =>
    contribute(signerFor(donor), "999999", {
      skipPreflight: true,
    }),
);

// --- amount parsing -------------------------------------------------------
console.log("\nAmount handling:");
check("1.5 -> 15000000 stroops", toStroops("1.5") === 15000000n);
try {
  toStroops("1.123456789");
  check("rejects excess precision", false, "accepted 9 decimals");
} catch {
  check("rejects excess precision", true);
}

console.log(
  failures === 0
    ? "\n✅ All contribution checks passed.\n"
    : `\n❌ ${failures} check(s) failed.\n`,
);
process.exitCode = failures === 0 ? 0 : 1;
