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
