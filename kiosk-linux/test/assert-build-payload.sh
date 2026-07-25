#!/bin/bash
# kiosk-linux/test/assert-build-payload.sh
#
# Guards a failure mode that `bash -n` provably cannot see.
#
# build.sh runs the entire Buildroot build inside a single
# `docker run ... bash -c '<~43 KB of script>'` argument. An apostrophe
# ANYWHERE in that block — including in a prose comment — closes the outer
# single quote. If whitespace follows before the next apostrophe, the shell
# splits the argument, and `bash -c` then receives only the fragment up to that
# point as its script, silently passing the remainder as positional parameters.
# The build proceeds and stops early with no error that names the cause.
#
# Why a syntax check is not enough (measured 2026-07-25):
#   1 apostrophe          -> `bash -n` DOES fail (odd count leaves the quote open)
#   2, in a comment       -> `bash -n` reports SYNTAX OK; payload truncated,
#                            42400 bytes instead of 42883, 4 stray trailing args
#   4, spread over 3 lines-> `bash -n` reports SYNTAX OK (the real regression
#                            this test was written after)
#
# An even number of apostrophes re-balances the quoting, so the file parses
# perfectly while the container receives a truncated script. This test asserts
# on what the container ACTUALLY receives instead.
#
# Usage: kiosk-linux/test/assert-build-payload.sh
# Exit 0 = the payload arrives whole. Non-zero = it does not; the message says
# where it stopped.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_SH="$SCRIPT_DIR/../build.sh"

if [ ! -f "$BUILD_SH" ]; then
  echo "FAIL: cannot find build.sh at $BUILD_SH" >&2
  exit 1
fi

# Landmarks that must survive into the container script. Each is near the end of
# a distinct phase, so a truncation anywhere is caught by at least one of them.
# Keep these in sync with build.sh if those lines are reworded.
LANDMARKS=(
  "Applying defconfig"
  "Desktop symbols verified present in .config"
  "FZ-55 kernel symbols verified"
  "Building (this takes a while on first run)"
  "Copying final images out"
)

STUB_DIR="$(mktemp -d)"
trap 'rm -rf "$STUB_DIR"' EXIT

# A stand-in `docker` that captures the bash -c payload exactly as the shell
# built it, then exits 0 so build.sh proceeds far enough to reach the real
# invocation. Nothing is built and no container starts.
cat > "$STUB_DIR/docker" <<'STUB'
#!/bin/bash
args=("$@")
n=${#args[@]}
for ((i = 0; i < n; i++)); do
  if [[ "${args[$i]}" == "bash" && "${args[$i+1]}" == "-c" ]]; then
    printf '%s' "${args[$i+2]}" > "$PAYLOAD_OUT"
    printf '%s\n' "$((n - i - 3))" > "$PAYLOAD_OUT.trailing"
  fi
done
exit 0
STUB
chmod +x "$STUB_DIR/docker"

PAYLOAD_OUT="$STUB_DIR/payload"
export PAYLOAD_OUT

# build.sh exits non-zero at the end because the stub produced no images. That
# is expected and irrelevant: the payload was captured before then.
PATH="$STUB_DIR:$PATH" bash "$BUILD_SH" >/dev/null 2>&1 || true

if [ ! -s "$PAYLOAD_OUT" ]; then
  echo "FAIL: never observed a 'docker run ... bash -c <script>' invocation in build.sh." >&2
  echo "      If the container invocation was restructured, update this test." >&2
  exit 1
fi

bytes="$(wc -c < "$PAYLOAD_OUT" | tr -d ' ')"
trailing="$(cat "$PAYLOAD_OUT.trailing" 2>/dev/null || echo '?')"
failed=0

# Stray arguments after the script are the signature of a split, even when every
# landmark happens to survive.
if [ "$trailing" != "0" ]; then
  echo "FAIL: $trailing stray argument(s) followed the bash -c script." >&2
  echo "      The payload was split — almost certainly an apostrophe in build.sh." >&2
  failed=1
fi

for landmark in "${LANDMARKS[@]}"; do
  if ! grep -qF "$landmark" "$PAYLOAD_OUT"; then
    echo "FAIL: the container script is missing: \"$landmark\"" >&2
    failed=1
  fi
done

if [ "$failed" -ne 0 ]; then
  echo "" >&2
  echo "Payload was $bytes bytes. Find the offending apostrophe with:" >&2
  echo "  awk \"/bash -c '/,0\" kiosk-linux/build.sh | grep \\\"'\\\"" >&2
  echo "Legitimate apostrophes exist only in <<'HEREDOC' markers, where no" >&2
  echo "whitespace sits at the quote seam so the argument still concatenates." >&2
  exit 1
fi

echo "PASS: bash -c payload intact — $bytes bytes, 0 trailing args, all ${#LANDMARKS[@]} landmarks present."
