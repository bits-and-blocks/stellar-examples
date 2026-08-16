# shellcheck shell=bash
# Sourced by build.sh and deploy.sh. Not executable on its own.

set -euo pipefail

EXAMPLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../build.env
. "$EXAMPLE_DIR/build.env"

# Docker Desktop on Windows wants a Windows-style host path for -v, while MSYS
# would otherwise rewrite the container-side "/work" into "C:\work". Forward
# slashes are accepted by Docker on every platform.
host_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -m "$1" # Windows path, forward slashes
  else
    printf '%s' "$1"
  fi
}

# Every container invocation in this example goes through here, so the pin and
# the working directory can never drift between build and deploy.
#
# -w /work matters for reproducibility as much as the digest does: cargo records
# absolute paths, so building at /work rather than at whatever the host happens
# to call this directory is what stops my checkout path from leaking into the
# wasm and changing its hash.
#
# --user is about the bind mount, not the build. The image runs as its own
# `stellar` user (uid 1000, home /stellar), so on any host where the checkout is
# owned by some other uid — a GitHub runner is uid 1001, and plenty of Linux
# boxes are not 1000 either — cargo cannot create its target directory and dies
# with "Permission denied". Docker Desktop on macOS and Windows papers over
# that; Linux does not, which is why it shows up in CI first.
#
# Running as the caller's uid then costs us everything the image expected to
# write under /stellar, so each of those moves to /tmp: the crate registry
# (CARGO_HOME), anything reaching for ~ (HOME), and the CLI's own config and
# data dirs (deploy.sh has it generate a key). /tmp is world-writable in the
# image and dies with the container, so nothing escapes into the host except
# through the mount.
#
# None of it reaches the compiler. The stellar CLI derives its
# --remap-path-prefix from CARGO_HOME, so moving the registry moves the prefix
# with it and dependency paths still remap to the same relative strings — the
# wasm is unchanged, which is precisely what the hash assertion re-proves.
run_pinned() {
  MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' \
  docker run --rm \
    --platform "$BUILD_PLATFORM" \
    --user "$(id -u):$(id -g)" \
    -e CARGO_HOME=/tmp/cargo \
    -e HOME=/tmp \
    -e STELLAR_CONFIG_HOME=/tmp/stellar/config \
    -e STELLAR_DATA_HOME=/tmp/stellar/data \
    -v "$(host_path "$EXAMPLE_DIR"):/work" \
    -w /work \
    "$@"
}
