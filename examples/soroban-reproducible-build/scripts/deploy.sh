#!/usr/bin/env bash
#
# Deploy out/<wasm> to testnet from the same pinned container, then record what
# was deployed in deployment.json.
#
# You run this once. CI never deploys — it rebuilds and compares against the
# contract ID recorded here. Re-run it only when the contract source changes on
# purpose, or after a testnet reset (see the README).

. "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

RPC_URL="https://soroban-testnet.stellar.org"
# Pinned in code. This example cannot be pointed at mainnet by changing a flag.
NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
FRIENDBOT_URL="https://friendbot.stellar.org"

WASM="$EXAMPLE_DIR/out/$WASM_NAME"
KEY_FILE="$EXAMPLE_DIR/.deployer-secret"

if [ ! -f "$WASM" ]; then
  echo "error: $WASM not found — run scripts/build.sh first" >&2
  exit 1
fi

# A throwaway testnet key, generated on first run and gitignored. Nothing of
# value is ever held by it, and no mainnet key is accepted here by construction:
# the passphrase above is the only network this script can reach.
if [ ! -f "$KEY_FILE" ]; then
  echo "generating a throwaway testnet deployer key -> .deployer-secret"
  # `keys generate` writes the identity into the container's config dir, which
  # dies with the container, so read it back out in the same invocation.
  run_pinned --entrypoint sh "$STELLAR_CLI_IMAGE" -c \
    'stellar keys generate --as-secret ci-deployer >/dev/null 2>&1 && stellar keys secret ci-deployer' \
    | tr -d '[:space:]' > "$KEY_FILE"
  [ -s "$KEY_FILE" ] || { rm -f "$KEY_FILE"; echo "error: key generation failed" >&2; exit 1; }
fi

SECRET="$(tr -d '[:space:]' < "$KEY_FILE")"
PUBLIC="$(run_pinned "$STELLAR_CLI_IMAGE" keys public-key "$SECRET" | tr -d '[:space:]')"

echo "deployer: $PUBLIC"
echo "funding via friendbot (a no-op if the account already exists)"
curl -sS "$FRIENDBOT_URL?addr=$PUBLIC" -o /dev/null || true

echo "deploying $WASM_NAME"
CONTRACT_ID="$(
  run_pinned \
    -e "STELLAR_ACCOUNT=$SECRET" \
    -e "STELLAR_RPC_URL=$RPC_URL" \
    -e "STELLAR_NETWORK_PASSPHRASE=$NETWORK_PASSPHRASE" \
    "$STELLAR_CLI_IMAGE" \
    contract deploy --wasm "/work/out/$WASM_NAME" --quiet | tr -d '[:space:]'
)"

WASM_HASH="$(node -e "
  const {createHash}=require('crypto'),{readFileSync}=require('fs');
  process.stdout.write(createHash('sha256').update(readFileSync(process.argv[1])).digest('hex'));
" "$WASM")"

cat > "$EXAMPLE_DIR/deployment.json" <<EOF
{
  "network": "testnet",
  "networkPassphrase": "$NETWORK_PASSPHRASE",
  "rpcUrl": "$RPC_URL",
  "contractId": "$CONTRACT_ID",
  "wasmHash": "$WASM_HASH",
  "builtWith": {
    "image": "$STELLAR_CLI_IMAGE",
    "platform": "$BUILD_PLATFORM"
  },
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

echo
echo "contract: $CONTRACT_ID"
echo "wasmHash: $WASM_HASH"
echo "recorded in deployment.json"
