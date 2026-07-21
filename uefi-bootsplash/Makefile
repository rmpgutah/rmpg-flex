# uefi-bootsplash/Makefile
#
# Builds a freestanding x86_64 UEFI application against gnu-efi headers.
#
# Toolchain (see README.md in this directory for the full writeup and the exact
# recipe used to produce GNUEFI_DIR below):
#   - This targets Apple clang (ships with Xcode CLT) in its `x86_64-unknown-windows`
#     COFF/PE mode, linked with LLVM's `lld` (`brew install lld`), producing a
#     native PE32+ image directly.
#   - Why not the x86_64-elf-gcc/binutils cross toolchain + objcopy ELF->PE
#     conversion described in the original brief? That path was tried first and
#     DOES compile/link/objcopy without error, producing a file `file(1)`
#     correctly reports as a PE32+ EFI application — but it does not actually
#     boot: OVMF crashes with a page fault a few instructions after entry. Root
#     cause narrowed to gnu-efi's `crt0`-driven ELF->PE flow: `_start` calls
#     `_relocate()` (in `gnuefi/reloc_x86_64.c`) to manually walk ELF
#     `R_X86_64_RELATIVE` dynamic relocations and patch addresses in place
#     before jumping to `_entry`/`efi_main` — a scheme designed for Linux-hosted
#     binutils and, on this cross toolchain/binutils version, it corrupts a
#     function pointer that `_entry`'s constructor-running code (`ctors()` in
#     `lib/entry.c`) then jumps through, producing exactly the observed
#     out-of-range #PF. Homebrew also ships no `gnu-efi` formula for either
#     path, so gnu-efi 3.0.18 had to be built from source either way.
#   - Switching to clang's native COFF/PE backend + lld sidesteps `_relocate()`
#     entirely: the firmware's own PE loader applies base relocations (the
#     well-tested path every real EDK2/Windows PE loader uses), `efi_main` is
#     linked directly as the PE entry point (`-Wl,-entry:efi_main`), and no
#     crt0/reloc trampoline is involved at all. Confirmed booting cleanly under
#     QEMU+OVMF (see test/boot.log after running test/run-qemu.sh).
#   - GNUEFI_DIR below points at a small archive of gnu-efi's lib/*.c sources
#     (InitializeLib, Print, string/GUID helpers, etc.) recompiled for this
#     `x86_64-unknown-windows` target — override on the command line if yours
#     lives elsewhere:
#       make GNUEFI_DIR=/path/to/gnu-efi-pe
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

SRCS        = src/main.c
OBJS        = $(SRCS:.c=.o)

BUILD_DIR   = build

all: $(BUILD_DIR)/BOOTX64.EFI

# _fltused is required by lld's PE linker whenever any linked object references
# floating point (gnu-efi's print.c does, for %f-style formatting support even
# if unused by this particular main.c) but is never actually called here.
$(BUILD_DIR)/fltused.o: | $(BUILD_DIR)
	echo 'int _fltused = 1;' > $(BUILD_DIR)/fltused.c
	$(CC) -target $(TARGET) -ffreestanding -c $(BUILD_DIR)/fltused.c -o $@

$(BUILD_DIR)/BOOTX64.EFI: $(OBJS) $(BUILD_DIR)/fltused.o | $(BUILD_DIR)
	$(LD) $(LDFLAGS) $(OBJS) $(BUILD_DIR)/fltused.o $(EFILIB) -o $@

$(BUILD_DIR):
	mkdir -p $(BUILD_DIR)

%.o: %.c
	$(CC) $(CFLAGS) -c $< -o $@

clean:
	rm -f $(OBJS) $(BUILD_DIR)/BOOTX64.EFI $(BUILD_DIR)/fltused.o $(BUILD_DIR)/fltused.c

.PHONY: all clean
