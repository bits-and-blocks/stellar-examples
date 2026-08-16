#!/usr/bin/env bash
#
# Deploy out/<wasm> to testnet from the same pinned image, then record what was
# deployed in deployment.json.
#
# You run this once. CI never deploys — it rebuilds and compares against the
# contract recorded here. Re-run it only when the contract source changes on
# purpose, or after a testnet reset (see the README).

. "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

cd "$EXAMPLE_DIR"

if [ ! -f "out/$WASM_NAME" ]; then
  echo "error: out/$WASM_NAME not found — run scripts/build.sh first" >&2
  exit 1
fi
if [ ! -f "$SOURCE_ARCHIVE" ]; then
  echo "error: $SOURCE_ARCHIVE not found — run scripts/make-source-archive.sh" >&2
  exit 1
fi

echo "deploying $WASM_NAME"
CONTRACT_ID="$(deploy_wasm "out/$WASM_NAME")"

WASM_HASH="$(sha256_of "out/$WASM_NAME")"
SOURCE_SHA256="$(sha256_of "$SOURCE_ARCHIVE")"

cat > deployment.json <<EOF
{
  "network": "testnet",
  "networkPassphrase": "$NETWORK_PASSPHRASE",
  "rpcUrl": "$RPC_URL",
  "contractId": "$CONTRACT_ID",
  "wasmHash": "$WASM_HASH",
  "sep58": {
    "version": "0.6.0",
    "bldimg": "$BLDIMG",
    "bldopt": [$(printf '"%s"' "${BLDOPT[0]}"; for o in "${BLDOPT[@]:1}"; do printf ', "%s"' "$o"; done)],
    "source_sha256": "$SOURCE_SHA256"
  },
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

echo
echo "contract: $CONTRACT_ID"
echo "wasmHash: $WASM_HASH"
echo "recorded in deployment.json"
