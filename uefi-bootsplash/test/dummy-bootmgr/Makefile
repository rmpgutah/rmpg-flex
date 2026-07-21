# uefi-bootsplash/test/dummy-bootmgr/Makefile
#
# Builds the test-only dummy stand-in for bootmgfw.efi, used to prove the
# SUCCESS path of src/chainload.c under QEMU (see uefi-bootsplash/Makefile's
# header comment and uefi-bootsplash/README.md's "Testing" section). Shares
# the toolchain settings with the main app's Makefile via ../../common.mk
# rather than duplicating CFLAGS/LDFLAGS/paths.
include ../../common.mk

SRCS        = dummy_bootmgr.c
OBJS        = $(SRCS:.c=.o)

BUILD_DIR   = build

all: $(BUILD_DIR)/BOOTX64.EFI

# _fltused is required by lld's PE linker whenever any linked object references
# floating point (gnu-efi's print.c does, for %f-style formatting support even
# if unused by this particular dummy_bootmgr.c) but is never actually called here.
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
