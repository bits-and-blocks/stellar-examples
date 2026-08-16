# shellcheck shell=bash
# Sourced by the other scripts. Not executable on its own.

set -euo pipefail

EXAMPLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../build.conf
. "$EXAMPLE_DIR/build.conf"

# On Windows these scripts land in one of two completely different shells:
# Git Bash if you run them directly, or WSL if you run them through `npm run`
# from PowerShell, because that is what `bash` resolves to there. They differ in
# ways that break naive assumptions, so both are handled explicitly.
#
# Paths: Git Bash needs a Windows-style path for -v (and MSYS would otherwise
# rewrite container-side paths like "/source" into "C:\source"). WSL paths such
# as /mnt/c/... are understood by Docker Desktop as-is, as is a native Linux
# path, so everything else passes through untouched.
host_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -m "$1" # Windows path, forward slashes
  else
    printf '%s' "$1"
  fi
}

# Interpreter: WSL has the Windows Node install on PATH as node.exe, with no
# bare `node`, so assuming `node` works is exactly the bug that makes
# `npm run verify:sep58` fail from PowerShell while working from Git Bash.
resolve_node() {
  if [ -n "${npm_node_execpath:-}" ] && [ -x "${npm_node_execpath:-}" ]; then
    printf '%s' "$npm_node_execpath"
    return 0
  fi
  local candidate
  for candidate in node node.exe; do
    if command -v "$candidate" >/dev/null 2>&1; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  return 1
}

if ! NODE="$(resolve_node)"; then
  echo "error: could not find node (tried \$npm_node_execpath, node, node.exe)" >&2
  echo "Install Node 20+ and make sure it is on PATH in this shell." >&2
  exit 1
fi

# Utility container runs: the example directory at /work. Used for tasks that
# are not the contract build itself (archiving, key handling).
run_pinned() {
  MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' \
  docker run --rm \
    --platform "$BUILD_PLATFORM" \
    -v "$(host_path "$EXAMPLE_DIR"):/work" \
    -w /work \
    "$@"
}

# The toolchain the image ships, e.g. "1.97.1-x86_64-unknown-linux-gnu".
#
# SEP-58 §"Why no explicit rust version field": a `rust-toolchain.toml` inside
# the source would otherwise make rustup silently swap toolchains mid-build,
# defeating the image pin. Reading the image's own default and forcing it back
# in via RUSTUP_TOOLCHAIN closes that hole for *any* source, including sources
# we did not write — which matters once verify.sh builds strangers' contracts.
image_toolchain() {
  MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' \
  docker run --rm --platform "$BUILD_PLATFORM" --entrypoint rustup "$1" default \
    | cut -d' ' -f1
}

# The SEP-58 build invocation, reconstructed from recorded fields.
#
#   <entry point> <bldarg...> <bldopt...>
#
# and per the SEP the source is mounted at /source, which is also the image's
# WORKDIR, so relative paths resolve against the source root. We record no
# `bldarg`, so a verifier applies the spec's default of `contract` then `build`
# — passed explicitly here so producer and verifier run the identical command.
#
#   $1  source directory on the host (the archive's single top-level directory)
#   $2  image reference
#   $3  RUSTUP_TOOLCHAIN value
#   $4+ arguments after the entry point
run_sep58_build() {
  local source_dir="$1" image="$2" toolchain="$3"
  shift 3
  MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' \
  docker run --rm \
    --platform "$BUILD_PLATFORM" \
    -v "$(host_path "$source_dir"):/source" \
    -e "RUSTUP_TOOLCHAIN=$toolchain" \
    "$image" \
    "$@"
}

# sha256sum is present in Git Bash, WSL and on CI; node is the fallback for
# anywhere it is not (macOS ships shasum instead).
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    "$NODE" -e "
      const {createHash}=require('crypto'),{readFileSync}=require('fs');
      process.stdout.write(createHash('sha256').update(readFileSync(process.argv[1])).digest('hex'));
    " "$1"
  fi
}

# Testnet, pinned in code. Nothing reads these from the environment, so this
# example cannot be pointed at mainnet by setting a variable.
RPC_URL="https://soroban-testnet.stellar.org"
NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
FRIENDBOT_URL="https://friendbot.stellar.org"
KEY_FILE="$EXAMPLE_DIR/.deployer-secret"

# A throwaway testnet key, generated on first use and gitignored. Nothing of
# value is ever held by it.
deployer_secret() {
  if [ ! -f "$KEY_FILE" ]; then
    echo "generating a throwaway testnet deployer key -> .deployer-secret" >&2
    # `keys generate` writes the identity into the container's config dir,
    # which dies with the container, so read it back out in the same run.
    run_pinned --entrypoint sh "$BLDIMG" -c \
      'stellar keys generate --as-secret ci-deployer >/dev/null 2>&1 && stellar keys secret ci-deployer' \
      | tr -d '[:space:]' > "$KEY_FILE"
    [ -s "$KEY_FILE" ] || { rm -f "$KEY_FILE"; echo "error: key generation failed" >&2; exit 1; }
  fi
  tr -d '[:space:]' < "$KEY_FILE"
}

# Deploy a Wasm file (path relative to the example directory) and echo the
# resulting contract id. Used by deploy.sh for the real subject contract and by
# the negative-fixture script for the deliberately broken ones.
deploy_wasm() {
  local rel_wasm="$1" secret public
  secret="$(deployer_secret)"
  public="$(run_pinned "$BLDIMG" keys public-key "$secret" | tr -d '[:space:]')"

  echo "deployer: $public" >&2
  curl -sS "$FRIENDBOT_URL?addr=$public" -o /dev/null || true

  run_pinned \
    -e "STELLAR_ACCOUNT=$secret" \
    -e "STELLAR_RPC_URL=$RPC_URL" \
    -e "STELLAR_NETWORK_PASSPHRASE=$NETWORK_PASSPHRASE" \
    "$BLDIMG" \
    contract deploy --wasm "/work/$rel_wasm" --quiet | tr -d '[:space:]'
}
