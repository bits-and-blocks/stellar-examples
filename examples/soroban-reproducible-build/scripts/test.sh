#!/usr/bin/env bash
#
# Run the contract's unit tests, in the same pinned container as the build.
#
# These test behaviour, which is a separate question from reproducibility — a
# perfectly reproducible build of a broken contract still reproduces. Run here
# rather than on the host so this example keeps its "no Rust required" promise.

. "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

run_pinned --entrypoint cargo "$BLDIMG" \
  test --manifest-path /work/contract/Cargo.toml
