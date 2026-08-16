/**
 * The assertion this whole example exists to make:
 *
 *   sha256(wasm we just rebuilt from source) === the Wasm the network is running
 *
 * It is checked in three steps rather than one, because each step can fail for a
 * different reason and a verifier that collapses them tells you "mismatch" when
 * what you needed to hear was "that contract isn't there any more".
 *
 *   1. contract instance entry  -> the wasm hash the contract points at
 *   2. contract code entry      -> the actual bytes the network stores
 *   3. compare                  -> hash and bytes, against our local rebuild
 *
 * Step 2 is not redundant. Step 1 alone proves our hash equals a hash recorded
 * on chain; fetching the code and hashing it ourselves proves that hash really
 * is the hash of the code being executed.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Contract, Networks, rpc, xdr } from "@stellar/stellar-sdk";

const EXAMPLE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

const fail = (message, detail) => {
  console.error(`\n❌ ${message}`);
  if (detail) console.error(`\n${detail}`);
  process.exit(1);
};

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`could not read ${path}`, error.message);
  }
};

const deployment = readJson(join(EXAMPLE_DIR, "deployment.json"));
const { contractId, rpcUrl, networkPassphrase, wasmHash: recordedHash } = deployment;

// Testnet only, enforced rather than documented. Repointing this example at
// mainnet takes editing the source, not setting an environment variable.
if (networkPassphrase !== Networks.TESTNET) {
  fail(
    "deployment.json is not pinned to testnet",
    `expected: ${Networks.TESTNET}\nfound:    ${networkPassphrase}`,
  );
}

// --- local rebuild ---------------------------------------------------------

const wasmName = readFileSync(join(EXAMPLE_DIR, "build.env"), "utf8")
  .match(/^WASM_NAME="(.+)"$/m)?.[1];
if (!wasmName) fail("could not read WASM_NAME from build.env");

const wasmPath = join(EXAMPLE_DIR, "out", wasmName);
let localWasm;
try {
  localWasm = readFileSync(wasmPath);
} catch {
  fail(
    `no rebuilt Wasm at out/${wasmName}`,
    "Run scripts/build.sh first — this check compares a fresh rebuild against\nthe network, so there is nothing to compare without one.",
  );
}
const localHash = sha256(localWasm);

// --- what the network is running -------------------------------------------

const server = new rpc.Server(rpcUrl);

const instanceEntries = await server
  .getLedgerEntries(new Contract(contractId).getFootprint())
  .catch((error) => fail(`RPC request to ${rpcUrl} failed`, error.message));

if (instanceEntries.entries.length === 0) {
  fail(
    `contract ${contractId} does not exist on testnet`,
    "Most likely testnet was reset, which wipes every deployed contract.\nRe-run scripts/deploy.sh and commit the new deployment.json.",
  );
}

const instance = instanceEntries.entries[0].val.contractData().val().instance();
const executable = instance.executable();

if (executable.switch().name !== "contractExecutableWasm") {
  fail(
    `contract ${contractId} is not a Wasm contract`,
    `executable type: ${executable.switch().name} (a built-in contract has no source to reproduce)`,
  );
}

const onChainHashBuf = executable.wasmHash();
const onChainHash = onChainHashBuf.toString("hex");

const codeEntries = await server
  .getLedgerEntries(
    xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({ hash: onChainHashBuf })),
  )
  .catch((error) => fail("could not fetch the contract_code ledger entry", error.message));

if (codeEntries.entries.length === 0) {
  fail(
    `contract_code entry ${onChainHash} is missing`,
    "The contract instance points at Wasm the network no longer stores — most\nlikely the code entry's TTL expired. Re-run scripts/deploy.sh.",
  );
}

const onChainWasm = codeEntries.entries[0].val.contractCode().code();
const onChainCodeHash = sha256(onChainWasm);

// --- compare ---------------------------------------------------------------

console.log(`contract    ${contractId}`);
console.log(`network     testnet (${rpcUrl})`);
console.log(`image       ${deployment.builtWith.image}`);
console.log();
console.log(`rebuilt     ${localHash}  (${localWasm.length} bytes)`);
console.log(`on chain    ${onChainHash}  (${onChainWasm.length} bytes)`);
console.log();

if (onChainCodeHash !== onChainHash) {
  fail(
    "the network's own contract_code entry does not hash to its key",
    `entry key:   ${onChainHash}\nsha256(code): ${onChainCodeHash}\n\nThis is not a problem with our build — it means the RPC response is not\nself-consistent. Suspect the RPC endpoint before suspecting the source.`,
  );
}

if (recordedHash !== onChainHash) {
  fail(
    "deployment.json is stale",
    `recorded: ${recordedHash}\non chain: ${onChainHash}\n\nThe recorded hash and the deployed contract disagree, so deployment.json\nwas not updated after the last deploy. Re-run scripts/deploy.sh.`,
  );
}

if (localHash !== onChainHash) {
  fail(
    "rebuild does not reproduce the deployed contract",
    `rebuilt:  ${localHash} (${localWasm.length} bytes)\non chain: ${onChainHash} (${onChainWasm.length} bytes)\n\nThe source in this commit does not produce the Wasm deployed at\n${contractId}. Either the source changed, or the\nbuild is not as hermetic as this example claims. Check the source diff\nfirst — that is by far the more likely of the two.`,
  );
}

if (!localWasm.equals(onChainWasm)) {
  // Unreachable short of a sha256 collision. Kept because "the hashes matched
  // so the bytes matched" is an assumption, and this costs one comparison.
  fail("hashes match but the bytes differ", "Congratulations, that is a sha256 collision.");
}

console.log("✅ the deployed contract was built from this source");
