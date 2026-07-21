#!/usr/bin/env bash
# uefi-bootsplash/test/build-scratch-esp.sh
# Builds a scratch FAT32 ESP image for QEMU testing, in one of two modes:
#   notfound — no file at the Windows Boot Manager path (tests the failure path)
#   success  — the dummy stand-in bootmgfw.efi present (tests the success path)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

MODE="${1:?usage: build-scratch-esp.sh <notfound|success> <output-image-path>}"
OUT_IMAGE="${2:?usage: build-scratch-esp.sh <notfound|success> <output-image-path>}"

if [[ "$MODE" != "notfound" && "$MODE" != "success" ]]; then
  echo "unknown mode: $MODE (expected notfound or success)" >&2
  exit 1
fi

if [[ ! -f "$ROOT_DIR/build/BOOTX64.EFI" ]]; then
  echo "missing $ROOT_DIR/build/BOOTX64.EFI — run 'make' in $ROOT_DIR first" >&2
  exit 1
fi

if [[ "$MODE" == "success" && ! -f "$ROOT_DIR/test/dummy-bootmgr/build/BOOTX64.EFI" ]]; then
  echo "missing $ROOT_DIR/test/dummy-bootmgr/build/BOOTX64.EFI — run 'make' in test/dummy-bootmgr first" >&2
  exit 1
fi

# NOTE: run-qemu.sh copies the committed test/ovmf/OVMF_VARS.fd template to a
# gitignored scratch path (test/ovmf-vars-scratch.fd) and points QEMU's
# writable pflash drive at the COPY, so the committed template is never
# mutated by NVRAM boot-variable state in the first place — no reset needed
# here anymore (previously this step did `git checkout -- test/ovmf/OVMF_VARS.fd`
# before every run, which only helped when this script was used and still left
# the working tree dirty after a standalone run-qemu.sh invocation).

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

mkdir -p "$WORK_DIR/EFI/Boot"
cp "$ROOT_DIR/build/BOOTX64.EFI" "$WORK_DIR/EFI/Boot/BOOTX64.EFI"

if [[ "$MODE" == "success" ]]; then
  mkdir -p "$WORK_DIR/EFI/Microsoft/Boot"
  cp "$ROOT_DIR/test/dummy-bootmgr/build/BOOTX64.EFI" "$WORK_DIR/EFI/Microsoft/Boot/bootmgfw.efi"
fi

# NOTE: `hdiutil create` without an explicit raw format produces a compressed
# UDZO .dmg, which QEMU's `format=raw` drive cannot read as a disk (confirmed
# in Task 1/3 — `hdiutil imageinfo` shows "UDIF read-only compressed (zlib)").
# `-format UDTO` produces genuinely raw sectors, written out with a `.cdr`
# extension that we rename to the requested output path.
rm -f "$OUT_IMAGE" "${OUT_IMAGE%.img}.cdr" "${OUT_IMAGE%.img}.dmg"
hdiutil create -size 64m -fs FAT32 -volname ESP -srcfolder "$WORK_DIR" -format UDTO "${OUT_IMAGE%.img}" >/dev/null
mv "${OUT_IMAGE%.img}.cdr" "$OUT_IMAGE"

echo "wrote $OUT_IMAGE (mode: $MODE)"
