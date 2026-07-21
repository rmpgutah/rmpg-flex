# uefi-bootsplash/common.mk
#
# Shared toolchain settings for the main app's Makefile and
# test/dummy-bootmgr/Makefile — factored out so the two build a second,
# unrelated .efi (the test-only stand-in Windows Boot Manager) without
# copy-pasting the whole CFLAGS/LDFLAGS/paths ruleset. See this project's
# top-level Makefile header comment for the full toolchain story (clang's
# x86_64-unknown-windows COFF/PE target + lld, not the ELF cross-gcc path).
ARCH        = x86_64
TARGET      = x86_64-unknown-windows
CC          = clang
LD          = clang

GNUEFI_DIR  ?= $(HOME)/.local/gnu-efi-pe
EFIINC      = $(GNUEFI_DIR)/inc
EFIINCS     = -I$(EFIINC) -I$(EFIINC)/$(ARCH) -I$(EFIINC)/protocol
EFILIB      = $(GNUEFI_DIR)/lib/libefi.a

CFLAGS      = -target $(TARGET) $(EFIINCS) -ffreestanding -fshort-wchar \
              -mno-red-zone -DGNU_EFI_USE_MS_ABI -Wall -Wextra -Wno-unused-parameter
LDFLAGS     = -target $(TARGET) -fuse-ld=lld -nostdlib \
              -Wl,-entry:efi_main -Wl,-subsystem:efi_application -Wl,/dll

# Preflight: a fresh clone that runs `make` before ./build-gnuefi-pe.sh gets a
# raw lld "cannot open .../libefi.a" linker error with no hint of the fix.
# Both Makefiles that include this file link against $(EFILIB), so check for
# it once here rather than duplicating the check in each. Skip the check for
# `make clean`, which never touches EFILIB.
ifeq ($(filter clean,$(MAKECMDGOALS)),)
ifeq ($(wildcard $(EFILIB)),)
$(error GNUEFI_DIR/libefi.a not found at $(EFILIB) — build it first with \
  ./build-gnuefi-pe.sh (from the uefi-bootsplash/ directory; see README.md's \
  "Building" section), or pass GNUEFI_DIR=/path/to/gnu-efi-pe if it lives \
  somewhere other than the default $(HOME)/.local/gnu-efi-pe)
endif
endif
