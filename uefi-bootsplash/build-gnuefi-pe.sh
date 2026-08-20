#!/usr/bin/env bash
# uefi-bootsplash/build-gnuefi-pe.sh
#
# Reproduces GNUEFI_DIR (default $HOME/.local/gnu-efi-pe) that uefi-bootsplash/Makefile
# links against, from a fresh checkout with no prior local state.
#
# Background (see Makefile header comment + git history for the full writeup):
# Homebrew ships no `gnu-efi` formula, and gnu-efi's own prebuilt/standard build
# is an ELF archive meant to be relocated by its own crt0/`_relocate()` walker —
# which was found (Task 1, this repo) to page-fault on boot when combined with a
# modern x86_64-elf-gcc/binutils cross toolchain on Apple Silicon. The working
# toolchain instead targets `x86_64-unknown-windows` (Apple clang's native
# COFF/PE backend + LLVM lld) and lets the firmware's own well-tested PE loader
# do relocation — so gnu-efi's crt0/entry.c/reloc code is never used, and only
# the plain lib/*.c helper sources (InitializeLib, Print, string/GUID/console
# helpers, etc.) need to be recompiled for this target and archived into a
# small libefi.a.
#
# This script:
#   1. Downloads gnu-efi 3.0.18 (the exact version Task 1 used) from SourceForge.
#   2. Compiles the exact 28 lib/*.c sources Task 1's session verified boot
#      correctly (see LIB_FILES / RUNTIME_FILES / X86_64_FILES below), each with
#      the exact clang flags from Task 1's verified build.
#   3. Archives them into $GNUEFI_DIR/lib/libefi.a via llvm-ar and copies the
#      unmodified inc/ header tree to $GNUEFI_DIR/inc.
#
# Usage:
#   ./uefi-bootsplash/build-gnuefi-pe.sh [GNUEFI_DIR]
#
# Idempotency: if GNUEFI_DIR already contains lib/libefi.a, the script exits
# early with a message rather than rebuilding — pass --force (or rm -rf the
# directory yourself) to force a clean rebuild.
#
# Requirements: Apple clang (Xcode CLT, `clang`/`llvm-ar` on PATH), `lld`
# (`brew install lld`), `curl`, `tar`.

set -euo pipefail

GNUEFI_SRC_URL="https://downloads.sourceforge.net/project/gnu-efi/gnu-efi-3.0.18.tar.bz2"
GNUEFI_VERSION="3.0.18"
TARGET="x86_64-unknown-windows"

FORCE=0
GNUEFI_DIR=""
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    *) GNUEFI_DIR="$arg" ;;
  esac
done
GNUEFI_DIR="${GNUEFI_DIR:-$HOME/.local/gnu-efi-pe}"

if [ -f "$GNUEFI_DIR/lib/libefi.a" ] && [ "$FORCE" -ne 1 ]; then
  echo "GNUEFI_DIR already built at $GNUEFI_DIR (found lib/libefi.a) — skipping." >&2
  echo "Pass --force to rebuild from scratch." >&2
  exit 0
fi

for tool in clang curl tar; do
  command -v "$tool" >/dev/null 2>&1 || { echo "error: required tool '$tool' not found on PATH" >&2; exit 1; }
done

# llvm-ar isn't always on PATH — it ships with Homebrew's `llvm` formula
# (keg-only) rather than `lld`. Fall back to common Homebrew locations before
# giving up.
LLVM_AR=""
for candidate in llvm-ar /opt/homebrew/opt/llvm/bin/llvm-ar /usr/local/opt/llvm/bin/llvm-ar; do
  if command -v "$candidate" >/dev/null 2>&1; then
    LLVM_AR="$candidate"
    break
  fi
done
if [ -z "$LLVM_AR" ]; then
  echo "error: llvm-ar not found. Install with: brew install llvm" >&2
  exit 1
fi

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "==> Downloading gnu-efi $GNUEFI_VERSION from $GNUEFI_SRC_URL"
curl -fsSL "$GNUEFI_SRC_URL" -o "$WORK_DIR/gnu-efi.tar.bz2"

echo "==> Extracting"
tar -xjf "$WORK_DIR/gnu-efi.tar.bz2" -C "$WORK_DIR"
SRC_DIR="$WORK_DIR/gnu-efi-$GNUEFI_VERSION"
[ -d "$SRC_DIR" ] || { echo "error: expected extracted directory $SRC_DIR not found" >&2; exit 1; }

rm -rf "$GNUEFI_DIR"
mkdir -p "$GNUEFI_DIR/lib" "$GNUEFI_DIR/inc"

echo "==> Copying inc/ header tree (unmodified — portable across targets)"
cp -R "$SRC_DIR/inc/." "$GNUEFI_DIR/inc/"

EFIINC="$GNUEFI_DIR/inc"
CFLAGS=(-target "$TARGET" -ffreestanding -fshort-wchar -mno-red-zone \
  -DGNU_EFI_USE_MS_ABI -Wno-unused-parameter \
  -I"$EFIINC" -I"$EFIINC/x86_64" -I"$EFIINC/protocol")

OBJ_DIR="$WORK_DIR/obj"
mkdir -p "$OBJ_DIR/runtime"

# Exactly the lib/*.c files Task 1 verified compile+link+boot successfully for
# this target (confirmed via the object files left in that session's scratch
# gnu-efi-3.0.18/pe-build/ directory). Deliberately excludes lib/entry.c,
# lib/ctors.S, and gnuefi/reloc_x86_64.c — those implement gnu-efi's own
# crt0/relocation trampoline, which this toolchain doesn't use (the PE loader
# relocates instead) and which was the actual root cause of the page-fault
# seen with the ELF cross-toolchain path.
LIB_FILES=(boxdraw cmdline console crc data debug dpath error event exit guid hand hw init lock misc pause print smbios sread str)
RUNTIME_FILES=(efirtlib rtdata rtlock rtstr vm)
X86_64_FILES=(initplat math)

OBJS=()

echo "==> Compiling lib/*.c ($TARGET)"
for name in "${LIB_FILES[@]}"; do
  src="$SRC_DIR/lib/$name.c"
  obj="$OBJ_DIR/$name.o"
  [ -f "$src" ] || { echo "error: expected source $src not found" >&2; exit 1; }
  clang "${CFLAGS[@]}" -c "$src" -o "$obj"
  OBJS+=("$obj")
done

echo "==> Compiling lib/runtime/*.c ($TARGET)"
for name in "${RUNTIME_FILES[@]}"; do
  src="$SRC_DIR/lib/runtime/$name.c"
  obj="$OBJ_DIR/runtime/$name.o"
  [ -f "$src" ] || { echo "error: expected source $src not found" >&2; exit 1; }
  clang "${CFLAGS[@]}" -c "$src" -o "$obj"
  OBJS+=("$obj")
done

echo "==> Compiling lib/x86_64/{initplat,math}.c ($TARGET)"
for name in "${X86_64_FILES[@]}"; do
  src="$SRC_DIR/lib/x86_64/$name.c"
  obj="$OBJ_DIR/$name-x86_64.o"
  [ -f "$src" ] || { echo "error: expected source $src not found" >&2; exit 1; }
  clang "${CFLAGS[@]}" -c "$src" -o "$obj"
  OBJS+=("$obj")
done

echo "==> Archiving libefi.a"
"$LLVM_AR" rcs "$GNUEFI_DIR/lib/libefi.a" "${OBJS[@]}"

echo "==> Done. GNUEFI_DIR ready at: $GNUEFI_DIR"
echo "    Build with: cd uefi-bootsplash && make GNUEFI_DIR=$GNUEFI_DIR"
