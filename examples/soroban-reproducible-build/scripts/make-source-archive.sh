#!/usr/bin/env bash
#
# Produce the SEP-58 source archive and print its source_sha256.
#
# SEP-58 §2 requires the producer to be able to hand a verifier the *exact*
# archive bytes it hashed — either by keeping that file forever, or by
# regenerating identical bytes on demand. We do the latter, which means the
# archiving has to be reproducible, and that is fussier than it looks:
#
#   * `git archive` stamps entries with the current time when handed a tree, so
#     running it twice a second apart yields two different hashes. Its --mtime
#     flag is too new to rely on (not honoured by git 2.44).
#   * Host tar varies — GNU tar, bsdtar and Windows builds disagree about
#     defaults, and the archive bytes must not depend on who ran the script.
#
# So the tar is built by GNU tar *inside the pinned image*, with every varying
# field (mtime, uid/gid, name order, format) explicitly fixed. The file list
# comes from `git ls-files`, so only tracked files are included and build
# artefacts cannot leak in.

. "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

cd "$EXAMPLE_DIR"
mkdir -p "$(dirname "$SOURCE_ARCHIVE")"

# Tracked files only, paths relative to contract/.
mapfile -t FILES < <(git ls-files contract | sed 's|^contract/||')
if [ "${#FILES[@]}" -eq 0 ]; then
  echo "error: no tracked files under contract/ — commit the source first" >&2
  exit 1
fi

run_pinned --entrypoint tar "$BLDIMG" \
  --create \
  --file "/work/$SOURCE_ARCHIVE" \
  --directory /work/contract \
  --transform "s,^,$SOURCE_PREFIX/," \
  --sort=name \
  --mtime=@0 \
  --owner=0 --group=0 --numeric-owner \
  --format=gnu \
  --mode=go-w \
  "${FILES[@]}"

SOURCE_SHA256="$(sha256_of "$SOURCE_ARCHIVE")"

echo "archive:       $SOURCE_ARCHIVE"
echo "top-level dir: $SOURCE_PREFIX/"
echo "files:         ${#FILES[@]}"
echo "source_sha256: $SOURCE_SHA256"
