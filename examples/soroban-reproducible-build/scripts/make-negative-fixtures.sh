#!/usr/bin/env bash
#
# Deploy the contracts that make verify.sh's failure paths demonstrable.
#
# A verifier is only worth as much as its refusals, and refusals are hard to
# trust when the only subject is a contract we built correctly. So we deploy
# two deliberately defective contracts to testnet and point the README at them:
#
#   no-meta  built with no --meta at all. The ordinary case for anything built
#            before SEP-58, and the one a verifier must not confuse with fraud.
#
#   lying    built from modified source, but recording the *honest* archive's
#            source_sha256. Its metadata passes every format check, its archive
#            hashes correctly, and the rebuild still disagrees. This is the
#            attack SEP-58 exists to detect.
#
# Run once. The ids are committed in negative-fixtures.json.

. "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

cd "$EXAMPLE_DIR"

[ -f "$SOURCE_ARCHIVE" ] || bash scripts/make-source-archive.sh >/dev/null
HONEST_SHA256="$(sha256_of "$SOURCE_ARCHIVE")"

FIX=".fixtures"
rm -rf "$FIX"
mkdir -p "$FIX/no-meta" "$FIX/lying"
trap 'rm -rf "$EXAMPLE_DIR/$FIX"' EXIT

TOOLCHAIN="$(image_toolchain "$BLDIMG")"

extract_source() {
  cp "$SOURCE_ARCHIVE" "$FIX/archive.tmp"
  run_pinned --entrypoint tar "$BLDIMG" \
    --extract --file "/work/$FIX/archive.tmp" --directory "/work/$1"
  echo "$EXAMPLE_DIR/$1/$SOURCE_PREFIX"
}

# --- fixture 1: no build metadata -------------------------------------------
echo "=== building the no-metadata fixture ==="
NO_META_DIR="$(extract_source "$FIX/no-meta")"
run_sep58_build "$NO_META_DIR" "$BLDIMG" "$TOOLCHAIN" \
  contract build "${BLDOPT[@]}" >/dev/null
cp "$NO_META_DIR/target/wasm32v1-none/release/$WASM_NAME" "$FIX/no-meta.wasm"
NO_META_ID="$(deploy_wasm "$FIX/no-meta.wasm")"
echo "no-meta contract: $NO_META_ID"
echo

# --- fixture 2: metadata that lies about its source --------------------------
echo "=== building the lying fixture ==="
LYING_DIR="$(extract_source "$FIX/lying")"
# One byte of behaviour changed, then the *unmodified* archive's hash recorded.
sed -i 's/extend_ttl(50, 100)/extend_ttl(50, 101)/' "$LYING_DIR/src/lib.rs"
grep -q 'extend_ttl(50, 101)' "$LYING_DIR/src/lib.rs" || {
  echo "error: could not modify the fixture source" >&2; exit 1;
}
run_sep58_build "$LYING_DIR" "$BLDIMG" "$TOOLCHAIN" \
  contract build "${BLDOPT[@]}" \
  --meta "bldimg=$BLDIMG" \
  $(for o in "${BLDOPT[@]}"; do printf -- '--meta bldopt=%s ' "$o"; done) \
  --meta "source_sha256=$HONEST_SHA256" >/dev/null
cp "$LYING_DIR/target/wasm32v1-none/release/$WASM_NAME" "$FIX/lying.wasm"
LYING_ID="$(deploy_wasm "$FIX/lying.wasm")"
echo "lying contract:   $LYING_ID"

cat > negative-fixtures.json <<EOF
{
  "note": "Contracts deployed on purpose to make verify.sh's refusals demonstrable. Do not treat these as examples of correct contracts.",
  "network": "testnet",
  "fixtures": {
    "noBuildMetadata": {
      "contractId": "$NO_META_ID",
      "wasmHash": "$(sha256_of "$FIX/no-meta.wasm")",
      "expect": "verify.sh exits 3 — no SEP-58 build fields recorded"
    },
    "sourceMismatch": {
      "contractId": "$LYING_ID",
      "wasmHash": "$(sha256_of "$FIX/lying.wasm")",
      "recordedSourceSha256": "$HONEST_SHA256",
      "expect": "verify.sh exits 9 — archive matches source_sha256, rebuild does not match the deployed bytes"
    }
  },
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

echo
echo "recorded in negative-fixtures.json"
