#!/usr/bin/env bash
#
# Build the contract the SEP-58 way: from the source archive, in the
# digest-pinned image, with the build environment recorded into the Wasm.
#
# The recorded fields are what make the result verifiable by someone who has
# never seen this repo. Everything a third party needs to repeat this build
# travels inside the artifact — see scripts/verify.sh for the other half.
#
# Nothing here touches the host toolchain; you do not need cargo, rustc or the
# stellar CLI installed.

. "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

cd "$EXAMPLE_DIR"

# 1. The source archive, and the hash that binds this Wasm to it.
if [ ! -f "$SOURCE_ARCHIVE" ]; then
  echo "no source archive yet, generating it"
  bash scripts/make-source-archive.sh >/dev/null
fi
SOURCE_SHA256="$(sha256_of "$SOURCE_ARCHIVE")"

# 2. Extract to the single top-level directory the SEP requires, which becomes
#    the /source mount. Extracting in the container keeps tar behaviour
#    identical to the archive's producer. target/ is left in place between runs
#    so rebuilds stay warm.
BUILD_ROOT="$EXAMPLE_DIR/.build"
SOURCE_DIR="$BUILD_ROOT/$SOURCE_PREFIX"
mkdir -p "$BUILD_ROOT"
run_pinned --entrypoint tar "$BLDIMG" \
  --extract --file "/work/$SOURCE_ARCHIVE" --directory /work/.build

# 3. The image's own toolchain, forced back in so nothing in the source can
#    swap it.
TOOLCHAIN="$(image_toolchain "$BLDIMG")"

echo "bldimg:        $BLDIMG"
echo "               ($BLDIMG_TAG)"
echo "toolchain:     $TOOLCHAIN"
echo "bldopt:        ${BLDOPT[*]}"
echo "source_sha256: $SOURCE_SHA256"
echo

# 4. Build, recording the vocabulary. Meta order is fixed here and replayed in
#    read order by the verifier, because the meta lands inside the Wasm and so
#    is itself part of what is being hashed.
META=(
  --meta "bldimg=$BLDIMG"
)
for opt in "${BLDOPT[@]}"; do
  META+=(--meta "bldopt=$opt")
done
META+=(--meta "source_sha256=$SOURCE_SHA256")

run_sep58_build "$SOURCE_DIR" "$BLDIMG" "$TOOLCHAIN" \
  contract build "${BLDOPT[@]}" "${META[@]}"

# 5. Collect the artefact. No --out-dir: it is not recorded as a bldopt, so the
#    verifier will not pass it either, and both sides must read the Wasm from
#    the same place.
mkdir -p out
cp "$SOURCE_DIR/target/wasm32v1-none/release/$WASM_NAME" "out/$WASM_NAME"

echo
echo "wrote out/$WASM_NAME"
echo "wasm sha256: $(sha256_of "out/$WASM_NAME")"
