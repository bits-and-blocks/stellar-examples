#!/usr/bin/env bash
#
# SEP-58 verifier. Takes any contract id, reads the build metadata recorded in
# its Wasm, replays the recorded build against the recorded source, and compares
# the bytes.
#
#   ./verify.sh <contract-id> [options]
#
# Nothing about this script is specific to our contract. It knows the SEP-58
# vocabulary and nothing else; the recipe travels inside the artifact. Run it
# against a contract built by someone else and it works, or tells you precisely
# which part of the chain is missing.
#
# Targets SEP-58 v0.6.0.

. "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

cd "$EXAMPLE_DIR"

CONTRACT_ID=""
SOURCE_ARCHIVE_ARG=""
KEEP=0
ANY_IMAGE=0
# SEP-58 §"Compatible build image" and §Security Concerns: a digest pin protects
# integrity, not honesty — a malicious image can emit attacker-chosen bytes from
# any source. The spec says verifiers SHOULD allowlist rather than run whatever
# a contract names. Ours is deliberately narrow.
ALLOWED_IMAGE_PREFIXES=("docker.io/stellar/stellar-cli@")

usage() {
  cat >&2 <<'EOF'
usage: ./verify.sh <contract-id> [options]

  --source-archive <path>   Use this archive as the source (content-addressed
                            mode, or to verify a contract whose source_uri is
                            unreachable).
  --allow-image <prefix>    Add an allowed bldimg prefix. Repeatable.
  --any-image               Run whatever image the contract names. Unsafe; the
                            image is part of the supply chain.
  --rpc-url <url>           Default: testnet.
  --keep                    Keep the .verify working directory.
EOF
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --source-archive) SOURCE_ARCHIVE_ARG="$2"; shift 2 ;;
    --allow-image)    ALLOWED_IMAGE_PREFIXES+=("$2"); shift 2 ;;
    --any-image)      ANY_IMAGE=1; shift ;;
    --rpc-url)        RPC_URL="$2"; shift 2 ;;
    --keep)           KEEP=1; shift ;;
    -h|--help)        usage ;;
    -*)               echo "unknown option: $1" >&2; usage ;;
    *)                [ -z "$CONTRACT_ID" ] || usage; CONTRACT_ID="$1"; shift ;;
  esac
done

# Convenience only: with no id, verify the contract this example deployed. The
# script is otherwise entirely general — it reads the recipe out of whatever
# contract it is pointed at.
if [ -z "$CONTRACT_ID" ] && [ -f deployment.json ]; then
  CONTRACT_ID="$("$NODE" -p "require('./deployment.json').contractId")"
  echo "no contract id given, using the one in deployment.json"
fi
[ -n "$CONTRACT_ID" ] || usage

WORK=".verify"
rm -rf "$WORK"
mkdir -p "$WORK/src"
if [ "$KEEP" -eq 0 ]; then
  trap 'rm -rf "$EXAMPLE_DIR/$WORK"' EXIT
fi

net_args=(--rpc-url "$RPC_URL" --network-passphrase "$NETWORK_PASSPHRASE")

echo "contract:  $CONTRACT_ID"
echo "network:   $RPC_URL"
echo

# --- 1. the recorded build metadata -----------------------------------------
#
# Read with our own pinned image. SEP-58 §Security Concerns notes that the
# verifier's toolchain is itself part of the rebuild environment and that
# verifiers should pin and disclose it; ours is the same digest we build with.

if ! META_JSON="$(run_pinned "$BLDIMG" contract info meta \
      --contract-id "$CONTRACT_ID" "${net_args[@]}" --output json 2>"$WORK/meta.err")"; then
  echo "❌ could not read contract $CONTRACT_ID" >&2
  echo >&2
  sed 's/^/    /' "$WORK/meta.err" >&2
  echo >&2
  echo "The contract id may not exist on this network, or may be a built-in" >&2
  echo "contract (such as a Stellar Asset Contract) that has no Wasm to verify." >&2
  exit 1
fi

set +e
printf '%s' "$META_JSON" | "$NODE" scripts/sep58-fields.mjs > "$WORK/fields.tsv" 2>"$WORK/fields.err"
fields_status=$?
set -e

# --- failure path 1: no build metadata --------------------------------------
if [ "$fields_status" -eq 3 ]; then
  echo "❌ no build metadata"
  echo
  echo "Contract $CONTRACT_ID carries no SEP-58 build"
  echo "fields, so there is no recorded recipe to replay. This is the normal"
  echo "state for contracts built before SEP-58, or by tooling that does not"
  echo "record it — it is not evidence that anything is wrong with the contract."
  echo
  echo "Verifying it would mean guessing the image, flags and source that"
  echo "produced it, and a guess that happens to match proves nothing. The"
  echo "contract's publisher has to record the metadata at build time."
  exit 3
fi

if [ "$fields_status" -eq 4 ]; then
  echo "❌ malformed build metadata"
  echo
  cat "$WORK/fields.err"
  echo
  echo "SEP-58 v0.6.0 defines a format for each field; a value that fails it is"
  echo "not conformant and is not safe to replay."
  exit 4
fi
[ "$fields_status" -eq 0 ] || { cat "$WORK/fields.err" >&2; exit "$fields_status"; }

BLDIMG_REC=""
SOURCE_SHA256_REC=""
SOURCE_URI_REC=""
BLDOPT_REC=()
BLDARG_REC=()
META_REPLAY=()
while IFS=$'\t' read -r key val; do
  [ -n "$key" ] || continue
  case "$key" in
    bldimg)        BLDIMG_REC="$val" ;;
    bldopt)        BLDOPT_REC+=("$val") ;;
    bldarg)        BLDARG_REC+=("$val") ;;
    source_uri)    SOURCE_URI_REC="$val" ;;
    source_sha256) SOURCE_SHA256_REC="$val" ;;
  esac
  # Replayed in read order so the rebuilt contractmetav0 section is identical.
  META_REPLAY+=(--meta "$key=$val")
done < "$WORK/fields.tsv"

echo "recorded build metadata (SEP-58 v0.6.0)"
sed 's/^/  /; s/\t/: /' "$WORK/fields.tsv"
echo

if [ -z "$BLDIMG_REC" ]; then
  echo "❌ no bldimg recorded"
  echo
  echo "The contract records source but not the image it was built in. SEP-58"
  echo "gives bldimg no default: without it the build environment is unknown,"
  echo "and rebuilding in an image of our choosing would prove only that our"
  echo "image and their source agree by luck."
  exit 3
fi
if [ -z "$SOURCE_SHA256_REC" ]; then
  echo "❌ no source_sha256 recorded"
  echo
  echo "source_sha256 is what binds the Wasm to a specific source archive."
  echo "Without it there is nothing to say which source this contract claims."
  exit 3
fi

# --- 2. image allowlist ------------------------------------------------------
if [ "$ANY_IMAGE" -eq 0 ]; then
  allowed=0
  for prefix in "${ALLOWED_IMAGE_PREFIXES[@]}"; do
    case "$BLDIMG_REC" in "$prefix"*) allowed=1 ;; esac
  done
  if [ "$allowed" -eq 0 ]; then
    echo "❌ bldimg is not on this verifier's allowlist"
    echo
    echo "  recorded: $BLDIMG_REC"
    echo "  allowed:  ${ALLOWED_IMAGE_PREFIXES[*]}"
    echo
    echo "A digest pin guarantees which bytes the image is, not that those bytes"
    echo "are honest — a hostile image can emit whatever Wasm it likes from any"
    echo "source and make this check pass. Re-run with --allow-image <prefix> if"
    echo "you have vetted it, or --any-image if you accept that risk."
    exit 5
  fi
fi

# --- 3. the deployed bytes ---------------------------------------------------
run_pinned "$BLDIMG" contract fetch --id "$CONTRACT_ID" "${net_args[@]}" \
  --out-file "/work/$WORK/deployed.wasm" >/dev/null 2>&1
DEPLOYED_HASH="$(sha256_of "$WORK/deployed.wasm")"

# --- 4. the source archive ---------------------------------------------------
ARCHIVE=""
if [ -n "$SOURCE_ARCHIVE_ARG" ]; then
  ARCHIVE="$SOURCE_ARCHIVE_ARG"
  echo "source:    $ARCHIVE (supplied)"
elif [ -n "$SOURCE_URI_REC" ]; then
  ARCHIVE="$WORK/source-archive"
  echo "source:    $SOURCE_URI_REC (downloading)"
  if ! curl -fsSL "$SOURCE_URI_REC" -o "$ARCHIVE"; then
    echo
    echo "❌ could not download the source archive"
    echo
    echo "  source_uri: $SOURCE_URI_REC"
    echo
    echo "SEP-58 treats source_uri as a retrieval hint, not a trust anchor — the"
    echo "host may have moved or deleted it. The archive is identified by its"
    echo "hash, so any copy will do: pass one with --source-archive."
    exit 6
  fi
else
  # Content-addressed: no retrieval channel recorded, so look for a local copy
  # whose bytes hash to the recorded value.
  for candidate in sources/*.tar sources/*.tar.gz sources/*.zip; do
    [ -f "$candidate" ] || continue
    if [ "$(sha256_of "$candidate")" = "$SOURCE_SHA256_REC" ]; then
      ARCHIVE="$candidate"
      break
    fi
  done
  if [ -z "$ARCHIVE" ]; then
    echo "❌ no source archive available"
    echo
    echo "  source_sha256: $SOURCE_SHA256_REC"
    echo
    echo "This contract records its source content-addressed, with no"
    echo "source_uri to download from — a deliberate SEP-58 mode for source that"
    echo "is not publicly hosted. Nothing under sources/ matches that hash, so"
    echo "obtain the archive out of band and pass it with --source-archive."
    exit 6
  fi
  echo "source:    $ARCHIVE (content-addressed match)"
fi

ARCHIVE_HASH="$(sha256_of "$ARCHIVE")"

# --- failure path 2: the archive is not the recorded source ------------------
if [ "$ARCHIVE_HASH" != "$SOURCE_SHA256_REC" ]; then
  echo
  echo "❌ source archive does not match source_sha256"
  echo
  echo "  recorded: $SOURCE_SHA256_REC"
  echo "  archive:  $ARCHIVE_HASH"
  echo "  file:     $ARCHIVE"
  echo
  echo "This is not the source the contract claims to be built from, so"
  echo "rebuilding it would answer a question nobody asked. Either the archive"
  echo "was modified or truncated in transit, or it is a different version of"
  echo "the source than the one that was built."
  exit 7
fi

# --- 5. extract; the archive must hold exactly one top-level directory -------
case "$ARCHIVE" in
  *.tar)          tar_flags="--extract" ;;
  *.tar.gz|*.tgz) tar_flags="--extract --gzip" ;;
  *) echo "❌ unsupported archive format: $ARCHIVE" >&2; exit 6 ;;
esac
cp "$ARCHIVE" "$WORK/archive.tmp"
# shellcheck disable=SC2086
run_pinned --entrypoint tar "$BLDIMG" $tar_flags \
  --file "/work/$WORK/archive.tmp" --directory "/work/$WORK/src"

TOP_LEVEL=()
while IFS= read -r d; do
  [ -n "$d" ] || continue
  TOP_LEVEL+=("$d")
done < <(find "$WORK/src" -mindepth 1 -maxdepth 1 -type d)
if [ "${#TOP_LEVEL[@]}" -ne 1 ]; then
  echo
  echo "❌ archive does not contain exactly one top-level directory"
  echo
  echo "  found: ${#TOP_LEVEL[@]}"
  echo
  echo "SEP-58 §2 requires exactly one, so the verifier knows which directory to"
  echo "mount at /source without guessing."
  exit 7
fi
SOURCE_DIR="$(cd "${TOP_LEVEL[0]}" && pwd)"

# --- 6. replay the recorded build -------------------------------------------
TOOLCHAIN="$(image_toolchain "$BLDIMG_REC")"
echo "toolchain: $TOOLCHAIN"

# SEP-58 §1: the command is the bldarg entries in order, then the bldopt
# entries. Absent any bldarg, two are assumed: `contract` then `build`.
if [ "${#BLDARG_REC[@]}" -eq 0 ]; then
  BUILD_ARGV=(contract build)
else
  BUILD_ARGV=("${BLDARG_REC[@]}")
fi
BUILD_ARGV+=("${BLDOPT_REC[@]}" "${META_REPLAY[@]}")

echo "rebuilding..."
echo
if ! run_sep58_build "$SOURCE_DIR" "$BLDIMG_REC" "$TOOLCHAIN" \
      "${BUILD_ARGV[@]}" > "$WORK/build.log" 2>&1; then
  echo "❌ the recorded build did not complete"
  echo
  tail -20 "$WORK/build.log" | sed 's/^/    /'
  echo
  echo "The source and the recorded build command do not produce a Wasm at all."
  exit 8
fi

BUILT=()
while IFS= read -r w; do
  [ -n "$w" ] || continue
  BUILT+=("$w")
done < <(find "$SOURCE_DIR/target/wasm32v1-none/release" -maxdepth 1 -name '*.wasm' 2>/dev/null)
if [ "${#BUILT[@]}" -ne 1 ]; then
  echo "❌ expected exactly one Wasm from the rebuild, found ${#BUILT[@]}"
  echo
  echo "A workspace that builds several contracts needs the specific one named"
  echo "in the recorded bldopt entries; this contract's metadata does not do so."
  exit 8
fi
REBUILT_HASH="$(sha256_of "${BUILT[0]}")"

# --- 7. compare --------------------------------------------------------------
echo "deployed:  $DEPLOYED_HASH"
echo "rebuilt:   $REBUILT_HASH"
echo

# --- failure path 3: the rebuild does not reproduce the deployed bytes ------
if [ "$REBUILT_HASH" != "$DEPLOYED_HASH" ]; then
  echo "❌ rebuild does not reproduce the deployed contract"
  echo
  echo "The recorded source archive is genuinely the one named by source_sha256,"
  echo "and it was rebuilt in the recorded image with the recorded flags — and"
  echo "the bytes still differ. So the contract's own metadata does not describe"
  echo "how the deployed Wasm was produced."
  echo
  echo "That is the case this check exists to catch: a contract can record a"
  echo "source archive it was never built from. Treat the deployed bytes as"
  echo "unverified, whatever the source says."
  exit 9
fi

echo "✅ verified — $CONTRACT_ID was built from the recorded source"
