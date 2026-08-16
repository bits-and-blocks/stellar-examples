#!/usr/bin/env bash
#
# Assert that verify.sh refuses the contracts it should refuse.
#
# The pass case is the easy half. Without this, verify.sh could regress into
# something that returns 0 for everything and CI would stay green — which is
# precisely the failure mode a verifier must not have.

. "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

cd "$EXAMPLE_DIR"

failed=0

expect_exit() {
  local label="$1" expected="$2"
  shift 2
  local actual=0
  "$@" >/dev/null 2>&1 || actual=$?
  if [ "$actual" -eq "$expected" ]; then
    echo "  ok       $label (exit $actual)"
  else
    echo "  FAILED   $label — expected exit $expected, got $actual"
    failed=1
  fi
}

NO_META_ID="$(node -p "require('./negative-fixtures.json').fixtures.noBuildMetadata.contractId")"
LYING_ID="$(node -p "require('./negative-fixtures.json').fixtures.sourceMismatch.contractId")"

echo "verify.sh must refuse:"

# 3 — contract carries no SEP-58 fields at all.
expect_exit "no build metadata" 3 bash scripts/verify.sh "$NO_META_ID"

# 9 — metadata is well-formed and the archive matches source_sha256, but the
# recorded source does not produce the deployed bytes.
expect_exit "source does not build to the deployed bytes" 9 \
  bash scripts/verify.sh "$LYING_ID"

# 7 — the supplied archive is not the one source_sha256 names. Built here rather
# than committed, so the check cannot silently pass against a stale fixture.
TAMPERED="$(mktemp)"
cp "$SOURCE_ARCHIVE" "$TAMPERED"
printf 'X' | dd of="$TAMPERED" bs=1 seek=2000 conv=notrunc 2>/dev/null
expect_exit "archive does not match source_sha256" 7 \
  bash scripts/verify.sh --source-archive "$TAMPERED"
rm -f "$TAMPERED"

# 0 — and it must still accept the honest one, so a verifier that refuses
# everything cannot pass this file either.
expect_exit "the honest contract still verifies" 0 bash scripts/verify.sh

exit "$failed"
