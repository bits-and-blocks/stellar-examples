#!/usr/bin/env bash
#
# Build the contract inside the digest-pinned container. Produces out/<wasm>.
#
# Nothing here touches the host toolchain — you do not need cargo, rustc or the
# stellar CLI installed. That is deliberate: if the host could influence the
# build, the hash assertion would only prove something about this machine.

. "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

echo "image:   $STELLAR_CLI_IMAGE"
echo "package: $CONTRACT_PACKAGE"
echo

# --locked fails the build if Cargo.lock would change, so a dependency that
# published a new patch release cannot silently alter the bytes.
run_pinned "$STELLAR_CLI_IMAGE" \
  contract build \
  --locked \
  --manifest-path /work/contract/Cargo.toml \
  --package "$CONTRACT_PACKAGE" \
  --out-dir /work/out

echo
echo "wrote out/$WASM_NAME"
