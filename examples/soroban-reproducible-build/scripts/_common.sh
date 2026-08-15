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
run_pinned() {
  MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' \
  docker run --rm \
    --platform "$BUILD_PLATFORM" \
    -v "$(host_path "$EXAMPLE_DIR"):/work" \
    -w /work \
    "$@"
}
