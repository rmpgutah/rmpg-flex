# UEFI Boot Splash (gnu-efi, chainload to Windows) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone gnu-efi UEFI application that draws an RMPG-branded splash
screen at power-on, waits a fixed short duration, then chainloads the Windows Boot
Manager on the same EFI System Partition — sitting ahead of the existing Kiosk Shell
Mode in the boot chain.

**Architecture:** A small freestanding C project (`uefi-bootsplash/`) built with
gnu-efi's cross-compilation toolchain, producing a single PE32+ `.efi` executable.
Three logical units — splash rendering, chainload logic, and the `efi_main` entry point
that sequences them — each in their own source file. Verified with `qemu-system-x86_64`
+ OVMF firmware against a scratch virtual ESP disk image, since no real hardware or
Windows install is available in this session's environment.

**Tech Stack:** C (freestanding, no libc), gnu-efi headers/runtime, GNU Make,
`x86_64-elf` or system `gcc`/`ld` cross-compilation flags, QEMU + OVMF for testing.

## Global Constraints

- No Secure Boot signing in this plan — build and test assumes Secure Boot disabled.
  Do not add any signing/certificate logic.
- No interactivity anywhere — no keypress handling, no boot menu, no configurable
  timing at runtime. The splash duration is a compile-time constant.
- No filesystem access beyond the one fixed, well-known chainload target path
  (`\EFI\Microsoft\Boot\bootmgfw.efi`) — no directory scanning, no multi-OS detection.
- Every failure path must print a visible, specific message to the UEFI console and
  halt (`BS->Stall` loop) — never a silent black screen, never a crash, never a reboot
  loop.
- All rendering falls back to UEFI text-mode console output if GOP is unavailable —
  the app must never fail purely because graphics mode isn't present.
- This project does not modify anything under `desktop/`, `client/`, or `src/` — it is
  fully standalone under `uefi-bootsplash/`, matching how `edge/` sits independent of
  the Worker in this repo.
- Testing constraint: chainloading a genuine Windows Boot Manager binary and any
  Secure Boot interaction cannot be verified in this session's environment — every task
  that would need that is marked **[REAL-HARDWARE-UNVERIFIED]** and must be manually
  confirmed on a real Windows machine (Secure Boot disabled) before deployment. This is
  the direct equivalent of Kiosk Shell Mode's `[WINDOWS-UNVERIFIED]` convention.

---

## File Structure

- **Create:** `uefi-bootsplash/Makefile` — cross-compilation + linking rules producing
  `build/BOOTX64.EFI`.
- **Create:** `uefi-bootsplash/src/splash.h` / `uefi-bootsplash/src/splash.c` — GOP
  detection, screen clear, wordmark bitmap-font rendering, text-mode fallback.
- **Create:** `uefi-bootsplash/src/chainload.h` / `uefi-bootsplash/src/chainload.c` —
  loaded-image/device-path lookup, `LoadImage`/`StartImage` call, error reporting.
- **Create:** `uefi-bootsplash/src/main.c` — `efi_main` entry point sequencing splash →
  stall → chainload.
- **Create:** `uefi-bootsplash/test/build-scratch-esp.sh` — builds a scratch FAT32 disk
  image containing a dummy stand-in `.efi` at the well-known chainload path, for QEMU
  testing.
- **Create:** `uefi-bootsplash/test/run-qemu.sh` — boots `build/BOOTX64.EFI` under
  `qemu-system-x86_64` + OVMF against the scratch ESP image, capturing serial console
  output to a log file for assertions.
- **Create:** `uefi-bootsplash/test/assert-boot-log.sh` — small shell script that greps
  the captured serial log for expected markers (used by both the success-path and
  not-found-path tests).
- **Create:** `uefi-bootsplash/README.md` — build instructions, manual installation
  steps (copying the `.efi` onto a real ESP + registering a firmware boot entry), and
  the manual real-hardware verification checklist.

---

### Task 1: Toolchain scaffold — a booting "hello splash" binary

**Files:**
- Create: `uefi-bootsplash/Makefile`
- Create: `uefi-bootsplash/src/main.c` (minimal version — replaced/extended in Task 3)
- Create: `uefi-bootsplash/test/run-qemu.sh`

**Interfaces:**
- Produces: `build/BOOTX64.EFI` (the build artifact every later task extends), and the
  `test/run-qemu.sh` harness — consumed by every later task's manual verification step.

This task proves the toolchain and QEMU harness work end-to-end before any real logic
is written, so later tasks debug their own code, not the build system.

- [ ] **Step 1: Install the toolchain and QEMU (one-time environment setup)**

Run:
```bash
brew install gnu-efi qemu
```

Verify:
```bash
ls /opt/homebrew/lib | grep -i efi   # or /usr/local/lib on Intel Macs — confirms gnu-efi installed
which qemu-system-x86_64
```
Expected: `libefi.a`, `crt0-efi-x86_64.o` (or similarly named files) present; a
`qemu-system-x86_64` path printed.

Also locate an OVMF firmware image (QEMU needs this to boot as UEFI rather than legacy
BIOS) — Homebrew's `qemu` formula bundles OVMF firmware files under its share
directory on most installs:
```bash
find /opt/homebrew/share/qemu -iname "*OVMF*" 2>/dev/null
```
If no OVMF file is found by that search, download the standard `OVMF_CODE.fd` /
`OVMF_VARS.fd` pair from the upstream `edk2` project's released firmware binaries (the
tianocore/edk2 project publishes these) and place them at
`uefi-bootsplash/test/ovmf/OVMF_CODE.fd` and `uefi-bootsplash/test/ovmf/OVMF_VARS.fd`.
Record in your report exactly where you sourced them from and the path you placed them
at — later tasks' `run-qemu.sh` reads from `uefi-bootsplash/test/ovmf/`.

- [ ] **Step 2: Write the minimal entry point**

```c
// uefi-bootsplash/src/main.c
#include <efi.h>
#include <efilib.h>

EFI_STATUS
EFIAPI
efi_main(EFI_HANDLE ImageHandle, EFI_SYSTEM_TABLE *SystemTable)
{
  InitializeLib(ImageHandle, SystemTable);
  Print(L"RMPG Flex boot splash — toolchain check OK\r\n");
  BS->Stall(3 * 1000 * 1000); // 3 seconds, microseconds
  return EFI_SUCCESS;
}
```

- [ ] **Step 3: Write the Makefile**

```makefile
# uefi-bootsplash/Makefile
ARCH        = x86_64
EFIINC      = $(shell brew --prefix gnu-efi)/include/efi
EFIINCS     = -I$(EFIINC) -I$(EFIINC)/$(ARCH) -I$(EFIINC)/protocol
EFILIB      = $(shell brew --prefix gnu-efi)/lib
LDS         = $(EFILIB)/elf_$(ARCH)_efi.lds
CRT0        = $(EFILIB)/crt0-efi-$(ARCH).o

CFLAGS      = $(EFIINCS) -fpic -ffreestanding -fno-stack-protector \
              -fno-stack-check -fshort-wchar -mno-red-zone -maccumulate-outgoing-args \
              -DEFI_FUNCTION_WRAPPER -Wall -Wextra
LDFLAGS     = -nostdlib -znocombreloc -T $(LDS) -shared -Bsymbolic $(CRT0)

SRCS        = src/main.c
OBJS        = $(SRCS:.c=.o)

BUILD_DIR   = build

all: $(BUILD_DIR)/BOOTX64.EFI

$(BUILD_DIR)/main.so: $(OBJS)
	mkdir -p $(BUILD_DIR)
	ld $(LDFLAGS) $(OBJS) -o $(BUILD_DIR)/main.so -lefi -lgnuefi -L$(EFILIB)

$(BUILD_DIR)/BOOTX64.EFI: $(BUILD_DIR)/main.so
	objcopy -j .text -j .sdata -j .data -j .dynamic \
	  -j .dynsym -j .rel -j .rela -j .reloc \
	  --target=efi-app-$(ARCH) $(BUILD_DIR)/main.so $@

%.o: %.c
	gcc $(CFLAGS) -c $< -o $@

clean:
	rm -f $(OBJS) $(BUILD_DIR)/main.so $(BUILD_DIR)/BOOTX64.EFI

.PHONY: all clean
```

Note: exact flag names/paths for gnu-efi installed via Homebrew can differ slightly by
Homebrew version/architecture (Apple Silicon vs Intel prefix, `x86_64-elf-gcc` cross
compiler availability, whether `objcopy` needs a `x86_64-elf-objcopy` variant instead of
the system one). If `gcc`/`ld`/`objcopy` on this Mac cannot target
`efi-app-x86_64`/produce an x86_64 ELF at all (Apple Silicon Macs' default toolchain is
ARM-native), install an x86_64 cross-binutils/cross-gcc via Homebrew (e.g.
`brew install x86_64-elf-gcc x86_64-elf-binutils` — a well-known, commonly-used
cross-toolchain tap for exactly this kind of freestanding x86_64 work) and adjust the
Makefile's `gcc`/`ld`/`objcopy` invocations to the `x86_64-elf-` prefixed versions.
Document in your report exactly which toolchain you ended up using and why, since this
is genuinely environment-dependent.

- [ ] **Step 4: Build it**

Run: `cd uefi-bootsplash && make`
Expected: `build/BOOTX64.EFI` exists, no compiler errors. If it fails due to
missing/wrong cross-toolchain, resolve per the note in Step 3 before proceeding — do
not report this task DONE with a build that doesn't produce the artifact.

- [ ] **Step 5: Write the QEMU test harness**

```bash
#!/usr/bin/env bash
# uefi-bootsplash/test/run-qemu.sh
# Boots build/BOOTX64.EFI under QEMU+OVMF against a scratch FAT image, capturing
# serial console output to a log file for assertion by the calling test.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ESP_IMAGE="${1:-$SCRIPT_DIR/scratch-esp.img}"
LOG_FILE="${2:-$SCRIPT_DIR/boot.log}"
OVMF_CODE="$SCRIPT_DIR/ovmf/OVMF_CODE.fd"
OVMF_VARS="$SCRIPT_DIR/ovmf/OVMF_VARS.fd"

[ -f "$ESP_IMAGE" ] || { echo "ESP image not found: $ESP_IMAGE (run build-scratch-esp.sh first)" >&2; exit 1; }
[ -f "$OVMF_CODE" ] || { echo "OVMF_CODE.fd not found at $OVMF_CODE" >&2; exit 1; }

rm -f "$LOG_FILE"

qemu-system-x86_64 \
  -machine q35 \
  -m 256M \
  -drive if=pflash,format=raw,readonly=on,file="$OVMF_CODE" \
  -drive if=pflash,format=raw,file="$OVMF_VARS" \
  -drive format=raw,file="$ESP_IMAGE" \
  -serial file:"$LOG_FILE" \
  -display none \
  -no-reboot \
  -no-shutdown &
QEMU_PID=$!

# Give the firmware+app time to run, then kill QEMU — this app either halts in a
# Stall loop (never exits) or successfully chainloads (also never returns), so we
# always need a timeout-based kill rather than waiting for a natural exit.
sleep 8
kill "$QEMU_PID" 2>/dev/null || true
wait "$QEMU_PID" 2>/dev/null || true

echo "wrote $LOG_FILE"
```

Make it executable: `chmod +x uefi-bootsplash/test/run-qemu.sh`

- [ ] **Step 6: Build a trivial scratch ESP and run the harness**

For this first toolchain-check task, a minimal scratch image just needs
`build/BOOTX64.EFI` copied to `\EFI\Boot\BOOTX64.EFI` (the default UEFI removable-media
boot path, which QEMU's firmware will boot automatically with no boot-entry
registration needed for a raw-disk test image). Run:

```bash
cd uefi-bootsplash
mkdir -p test/esp-root/EFI/Boot
cp build/BOOTX64.EFI test/esp-root/EFI/Boot/BOOTX64.EFI
# Create a small FAT32 image and copy the ESP root into it (adjust size as needed;
# hdiutil is macOS-native and avoids needing extra tools like mtools for this step)
hdiutil create -size 64m -fs FAT32 -volname ESP -srcfolder test/esp-root test/scratch-esp
mv test/scratch-esp.dmg test/scratch-esp.img 2>/dev/null || true
./test/run-qemu.sh test/scratch-esp.img test/boot.log
cat test/boot.log
```

Expected: `test/boot.log` contains the text `RMPG Flex boot splash — toolchain check OK`
(possibly with UEFI console formatting/newlines around it — check for the substring,
not an exact line match, since serial-console rendering can add carriage returns or
firmware banner text before it).

If `hdiutil create -fs FAT32` isn't available/doesn't produce a UEFI-bootable image
correctly, an alternative is building the FAT image directly with `mtools`
(`brew install mtools`, then `mformat`/`mcopy` against a raw file) — use whichever
approach actually produces a working image in your environment, and document which one
you used and why in your report, since this step is genuinely dependent on the exact
tool versions available.

- [ ] **Step 7: Commit**

```bash
cd uefi-bootsplash
git add Makefile src/main.c test/run-qemu.sh
git commit -m "feat(uefi-bootsplash): scaffold gnu-efi toolchain with a working QEMU boot check"
```

(Do not commit `build/`, `test/scratch-esp.img`, `test/boot.log`, or `test/esp-root/` —
add them to a new `uefi-bootsplash/.gitignore` in this same commit: entries `build/`,
`test/scratch-esp.img`, `test/boot.log`, `test/esp-root/`.)

---

### Task 2: Splash rendering (GOP + text-mode fallback)

**Files:**
- Create: `uefi-bootsplash/src/splash.h`
- Create: `uefi-bootsplash/src/splash.c`
- Modify: `uefi-bootsplash/src/main.c` (call the new splash function instead of the
  Task 1 placeholder `Print` call)
- Modify: `uefi-bootsplash/Makefile` (add `src/splash.c` to `SRCS`)

**Interfaces:**
- Produces: `void ShowBootSplash(EFI_HANDLE ImageHandle, EFI_SYSTEM_TABLE *SystemTable);`
  — consumed by `main.c`'s `efi_main` (Task 1, extended here) and by Task 3 (the
  chainload step runs immediately after this returns).

- [ ] **Step 1: Write the splash header**

```c
// uefi-bootsplash/src/splash.h
#ifndef RMPG_SPLASH_H
#define RMPG_SPLASH_H

#include <efi.h>
#include <efilib.h>

// Draws the RMPG Blue & Silver boot splash (or falls back to a text-mode
// message if the Graphics Output Protocol isn't available), then waits
// SPLASH_DURATION_SECONDS before returning. Never fails — a missing GOP
// degrades to text, it never blocks progress to the chainload step.
VOID ShowBootSplash(EFI_HANDLE ImageHandle, EFI_SYSTEM_TABLE *SystemTable);

#define SPLASH_DURATION_SECONDS 3

#endif
```

- [ ] **Step 2: Write the splash implementation**

```c
// uefi-bootsplash/src/splash.c
#include "splash.h"

// RMPG Blue & Silver theme, converted from client/src/styles/theme-palettes.css:
// --surface-base #0c1a2b (background), --brand-gold #b7c2cf (silver wordmark, in
// this theme "gold" is actually a metallic silver-blue per CLAUDE.md's Design
// tokens section — same values used here for consistency with the rest of the app).
#define BG_R 0x0c
#define BG_G 0x1a
#define BG_B 0x2b
#define FG_R 0xb7
#define FG_G 0xc2
#define FG_B 0xcf

static VOID
FillScreen(EFI_GRAPHICS_OUTPUT_PROTOCOL *Gop, UINT8 R, UINT8 G, UINT8 B)
{
  EFI_GRAPHICS_OUTPUT_BLT_PIXEL Pixel;
  Pixel.Red = R;
  Pixel.Green = G;
  Pixel.Blue = B;
  Pixel.Reserved = 0;

  Gop->Blt(Gop, &Pixel, EfiBltVideoFill, 0, 0, 0, 0,
           Gop->Mode->Info->HorizontalResolution,
           Gop->Mode->Info->VerticalResolution, 0);
}

// Draws a simple filled rectangle "wordmark" placeholder centered on screen —
// a real glyph-based renderer is a larger undertaking than this task's scope
// (a static screen, not a font engine); a solid brand-colored bar centered on
// the dark background reads clearly as a boot splash without needing a font
// table. If richer text rendering is wanted later, this is the function to
// extend.
static VOID
DrawWordmarkPlaceholder(EFI_GRAPHICS_OUTPUT_PROTOCOL *Gop)
{
  UINT32 ScreenW = Gop->Mode->Info->HorizontalResolution;
  UINT32 ScreenH = Gop->Mode->Info->VerticalResolution;
  UINT32 BarW = ScreenW / 3;
  UINT32 BarH = ScreenH / 12;
  UINT32 X = (ScreenW - BarW) / 2;
  UINT32 Y = (ScreenH - BarH) / 2;

  EFI_GRAPHICS_OUTPUT_BLT_PIXEL Pixel;
  Pixel.Red = FG_R;
  Pixel.Green = FG_G;
  Pixel.Blue = FG_B;
  Pixel.Reserved = 0;

  Gop->Blt(Gop, &Pixel, EfiBltVideoFill, 0, 0, X, Y, BarW, BarH, 0);
}

VOID
ShowBootSplash(EFI_HANDLE ImageHandle, EFI_SYSTEM_TABLE *SystemTable)
{
  (VOID)ImageHandle;
  EFI_STATUS Status;
  EFI_GRAPHICS_OUTPUT_PROTOCOL *Gop = NULL;
  EFI_GUID GopGuid = EFI_GRAPHICS_OUTPUT_PROTOCOL_GUID;

  Status = SystemTable->BootServices->LocateProtocol(&GopGuid, NULL, (VOID **)&Gop);

  if (EFI_ERROR(Status) || Gop == NULL) {
    // Text-mode fallback — GOP unavailable. Never treat this as a failure.
    Print(L"RMPG Flex\r\n");
  } else {
    FillScreen(Gop, BG_R, BG_G, BG_B);
    DrawWordmarkPlaceholder(Gop);
  }

  SystemTable->BootServices->Stall(SPLASH_DURATION_SECONDS * 1000 * 1000);
}
```

- [ ] **Step 3: Wire it into main.c**

```c
// uefi-bootsplash/src/main.c
#include <efi.h>
#include <efilib.h>
#include "splash.h"

EFI_STATUS
EFIAPI
efi_main(EFI_HANDLE ImageHandle, EFI_SYSTEM_TABLE *SystemTable)
{
  InitializeLib(ImageHandle, SystemTable);

  ShowBootSplash(ImageHandle, SystemTable);

  return EFI_SUCCESS;
}
```

- [ ] **Step 4: Add splash.c to the Makefile's SRCS**

```makefile
SRCS        = src/main.c src/splash.c
```

- [ ] **Step 5: Build and verify under QEMU**

Run: `cd uefi-bootsplash && make clean && make`
Expected: builds cleanly with no new warnings about the GOP protocol GUID/types (these
come from gnu-efi's bundled `efi/protocol/GraphicsOutput.h` — if the header/GUID name
differs slightly from what's used above, adjust to match gnu-efi's actual header;
check `find $(brew --prefix gnu-efi) -iname "*graphics*"` if the build errors on an
unknown type/macro name).

Run the QEMU harness again with the rebuilt binary (reuse Task 1's scratch ESP build
steps, copying the new `build/BOOTX64.EFI` in):
```bash
cp build/BOOTX64.EFI test/esp-root/EFI/Boot/BOOTX64.EFI
hdiutil create -size 64m -fs FAT32 -volname ESP -srcfolder test/esp-root test/scratch-esp -ov
mv test/scratch-esp.dmg test/scratch-esp.img 2>/dev/null || true
./test/run-qemu.sh test/scratch-esp.img test/boot.log
```
Since this task no longer prints to serial console when GOP succeeds (it draws to the
graphics framebuffer instead, which a `-display none` headless QEMU run won't show in
the serial log), verify success a different way: re-run with `-display none` removed
from `run-qemu.sh` (or a separate temporary invocation) and instead use QEMU's
`-vnc :0` flag or take a screenshot via QEMU's monitor (`qemu-system-x86_64 ... -monitor
stdio`, then in the monitor type `screendump splash.ppm`) to capture the actual
rendered frame, and visually confirm (via the Read tool, since `.ppm` can be converted
or you can convert to `.png` with `sips -s format png splash.ppm --out splash.png` on
macOS) that the screen shows the dark blue background with a lighter bar roughly
centered. Document the exact command sequence you used to capture this in your report,
since headless GOP verification is inherently a bit fiddly and future maintainers will
need your exact recipe.

- [ ] **Step 6: Commit**

```bash
cd uefi-bootsplash
git add src/splash.h src/splash.c src/main.c Makefile
git commit -m "feat(uefi-bootsplash): render Blue & Silver splash via GOP with text-mode fallback"
```

---

### Task 3: Chainload logic (find + launch Windows Boot Manager)

**Files:**
- Create: `uefi-bootsplash/src/chainload.h`
- Create: `uefi-bootsplash/src/chainload.c`
- Modify: `uefi-bootsplash/src/main.c` (call the chainload function after
  `ShowBootSplash` returns)
- Modify: `uefi-bootsplash/Makefile` (add `src/chainload.c` to `SRCS`)

**Interfaces:**
- Consumes: nothing from Task 2 directly (splash and chainload are sequenced, not
  data-coupled — `ShowBootSplash` returns `VOID`).
- Produces: `EFI_STATUS Chainload(EFI_HANDLE ImageHandle, EFI_SYSTEM_TABLE
  *SystemTable, CHAR16 *TargetPath);` — called from `main.c`.

- [ ] **Step 1: Write the chainload header**

```c
// uefi-bootsplash/src/chainload.h
#ifndef RMPG_CHAINLOAD_H
#define RMPG_CHAINLOAD_H

#include <efi.h>
#include <efilib.h>

// The well-known path Windows installs its own UEFI boot manager to, on the
// same EFI System Partition. Not a heuristic search — a fixed path, per this
// project's scope decision (single Windows install, no multi-OS detection).
#define WINDOWS_BOOT_MANAGER_PATH L"\\EFI\\Microsoft\\Boot\\bootmgfw.efi"

// Locates TargetPath on the same device this app itself was loaded from, and
// hands off execution to it via LoadImage/StartImage. On success, this
// function does not return (control passes to TargetPath). On failure,
// prints a specific error message to the UEFI console and returns an error
// status — the caller (main.c) is responsible for halting, never retrying
// or rebooting.
EFI_STATUS Chainload(EFI_HANDLE ImageHandle, EFI_SYSTEM_TABLE *SystemTable, CHAR16 *TargetPath);

#endif
```

- [ ] **Step 2: Write the chainload implementation**

```c
// uefi-bootsplash/src/chainload.c
#include "chainload.h"

EFI_STATUS
Chainload(EFI_HANDLE ImageHandle, EFI_SYSTEM_TABLE *SystemTable, CHAR16 *TargetPath)
{
  EFI_STATUS Status;
  EFI_LOADED_IMAGE_PROTOCOL *LoadedImage = NULL;
  EFI_GUID LoadedImageGuid = EFI_LOADED_IMAGE_PROTOCOL_GUID;
  EFI_HANDLE TargetHandle = NULL;

  Status = SystemTable->BootServices->HandleProtocol(
      ImageHandle, &LoadedImageGuid, (VOID **)&LoadedImage);
  if (EFI_ERROR(Status)) {
    Print(L"Chainload failed: could not get LoadedImageProtocol for self (status %r)\r\n", Status);
    return Status;
  }

  // Build a device path for TargetPath on the SAME device handle this app
  // was itself loaded from (LoadedImage->DeviceHandle) — this is what
  // ensures we chainload the Windows Boot Manager on the same ESP, not go
  // searching across every device in the system.
  EFI_DEVICE_PATH *TargetDevicePath = FileDevicePath(LoadedImage->DeviceHandle, TargetPath);
  if (TargetDevicePath == NULL) {
    Print(L"Chainload failed: could not build device path for %s\r\n", TargetPath);
    return EFI_NOT_FOUND;
  }

  Status = SystemTable->BootServices->LoadImage(
      FALSE, ImageHandle, TargetDevicePath, NULL, 0, &TargetHandle);
  FreePool(TargetDevicePath);

  if (EFI_ERROR(Status)) {
    Print(L"Could not find Windows Boot Manager at %s (status %r)\r\n", TargetPath, Status);
    return Status;
  }

  Print(L"Chainloading %s ...\r\n", TargetPath);
  Status = SystemTable->BootServices->StartImage(TargetHandle, NULL, NULL);

  // StartImage only returns if the started image itself returns control
  // (e.g. Windows Boot Manager encountered its own error and returned) —
  // a normal successful boot hand-off never reaches this line.
  Print(L"Windows Boot Manager returned control unexpectedly (status %r)\r\n", Status);
  return Status;
}
```

- [ ] **Step 3: Wire it into main.c with the halt-on-failure loop**

```c
// uefi-bootsplash/src/main.c
#include <efi.h>
#include <efilib.h>
#include "splash.h"
#include "chainload.h"

EFI_STATUS
EFIAPI
efi_main(EFI_HANDLE ImageHandle, EFI_SYSTEM_TABLE *SystemTable)
{
  InitializeLib(ImageHandle, SystemTable);

  ShowBootSplash(ImageHandle, SystemTable);

  Chainload(ImageHandle, SystemTable, WINDOWS_BOOT_MANAGER_PATH);

  // Only reached if Chainload failed and returned (a successful chainload
  // hands off control permanently and never comes back here). Halt visibly
  // rather than silently returning to the firmware boot menu or rebooting —
  // per this project's Global Constraint that every failure path is visible
  // and does not loop.
  Print(L"\r\nBoot splash halted after chainload failure. Power off or check firmware boot settings.\r\n");
  for (;;) {
    SystemTable->BootServices->Stall(60 * 1000 * 1000); // 60s, repeated forever
  }
}
```

- [ ] **Step 4: Add chainload.c to the Makefile's SRCS**

```makefile
SRCS        = src/main.c src/splash.c src/chainload.c
```

- [ ] **Step 5: Build and test the NOT-FOUND path under QEMU**

Build: `cd uefi-bootsplash && make clean && make`

Test the failure path first (no dummy Windows Boot Manager present yet — this is the
natural state of the Task 1/2 scratch ESP, which has no `\EFI\Microsoft\Boot\` at all):

```bash
cp build/BOOTX64.EFI test/esp-root/EFI/Boot/BOOTX64.EFI
hdiutil create -size 64m -fs FAT32 -volname ESP -srcfolder test/esp-root test/scratch-esp -ov
mv test/scratch-esp.dmg test/scratch-esp.img 2>/dev/null || true
./test/run-qemu.sh test/scratch-esp.img test/boot-notfound.log
cat test/boot-notfound.log
```

Expected: log contains `Could not find Windows Boot Manager at \EFI\Microsoft\Boot\bootmgfw.efi`
and `Boot splash halted after chainload failure` — confirming the app visibly reports
the failure and halts rather than silently hanging or looping unboundedly (it does
loop the `Stall`, but that's the deliberate, visible halt state, not a crash).

- [ ] **Step 6: Build and test the SUCCESS path under QEMU with a dummy target**

Create a trivial dummy `.efi` to stand in for `bootmgfw.efi` (reuse the Task 1 minimal
`efi_main` shape, just with different printed text, compiled as a second target):

```c
// uefi-bootsplash/test/dummy-bootmgr/dummy_bootmgr.c
#include <efi.h>
#include <efilib.h>

EFI_STATUS
EFIAPI
efi_main(EFI_HANDLE ImageHandle, EFI_SYSTEM_TABLE *SystemTable)
{
  InitializeLib(ImageHandle, SystemTable);
  Print(L"DUMMY WINDOWS BOOT MANAGER REACHED\r\n");
  SystemTable->BootServices->Stall(3 * 1000 * 1000);
  return EFI_SUCCESS;
}
```

Add a small standalone Makefile target for it (or a second Makefile in
`test/dummy-bootmgr/`, reusing the same gnu-efi build rules as the main Makefile — your
call on which is less duplicative; if you add a second Makefile, factor the shared
`CFLAGS`/`LDFLAGS`/paths into a small `uefi-bootsplash/common.mk` included by both,
rather than copy-pasting the whole ruleset twice). Build it to produce
`test/dummy-bootmgr/build/BOOTX64.EFI` (or similar).

Place the built dummy at the well-known chainload path in a fresh scratch ESP root:
```bash
mkdir -p test/esp-root/EFI/Microsoft/Boot
cp test/dummy-bootmgr/build/BOOTX64.EFI test/esp-root/EFI/Microsoft/Boot/bootmgfw.efi
hdiutil create -size 64m -fs FAT32 -volname ESP -srcfolder test/esp-root test/scratch-esp -ov
mv test/scratch-esp.dmg test/scratch-esp.img 2>/dev/null || true
./test/run-qemu.sh test/scratch-esp.img test/boot-success.log
cat test/boot-success.log
```

Expected: log contains `Chainloading \EFI\Microsoft\Boot\bootmgfw.efi ...` followed by
`DUMMY WINDOWS BOOT MANAGER REACHED` — confirming the real `LoadImage`/`StartImage`
call successfully finds and executes a target file at the well-known path on the same
device. This proves the chainload mechanism works; it does NOT prove chainloading a
genuine Windows Boot Manager binary specifically, which requires real hardware/a real
Windows install (**[REAL-HARDWARE-UNVERIFIED]** — record this explicitly in your
report).

- [ ] **Step 7: Commit**

```bash
cd uefi-bootsplash
git add src/chainload.h src/chainload.c src/main.c Makefile test/dummy-bootmgr/
git commit -m "feat(uefi-bootsplash): chainload Windows Boot Manager with visible failure handling"
```

---

### Task 4: Automated assertion scripts for both boot paths

**Files:**
- Create: `uefi-bootsplash/test/build-scratch-esp.sh`
- Create: `uefi-bootsplash/test/assert-boot-log.sh`
- Modify: `uefi-bootsplash/README.md` is NOT touched here (that's Task 5) — this task
  is scripts only, turning Task 3's manual step-by-step shell commands into repeatable,
  assertable scripts.

**Interfaces:**
- Produces: `test/build-scratch-esp.sh <notfound|success> <output-image-path>` and
  `test/assert-boot-log.sh <log-file> <expected-substring>` (exit 0 on match, exit 1
  with a clear message otherwise) — consumed by anyone re-verifying this project after
  future changes (documented as the standard verification recipe in Task 5's README).

- [ ] **Step 1: Write build-scratch-esp.sh**

```bash
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

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

mkdir -p "$WORK_DIR/EFI/Boot"
cp "$ROOT_DIR/build/BOOTX64.EFI" "$WORK_DIR/EFI/Boot/BOOTX64.EFI"

if [[ "$MODE" == "success" ]]; then
  mkdir -p "$WORK_DIR/EFI/Microsoft/Boot"
  cp "$ROOT_DIR/test/dummy-bootmgr/build/BOOTX64.EFI" "$WORK_DIR/EFI/Microsoft/Boot/bootmgfw.efi"
fi

rm -f "$OUT_IMAGE"
hdiutil create -size 64m -fs FAT32 -volname ESP -srcfolder "$WORK_DIR" "${OUT_IMAGE%.img}" -ov >/dev/null
mv "${OUT_IMAGE%.img}.dmg" "$OUT_IMAGE" 2>/dev/null || true

echo "wrote $OUT_IMAGE (mode: $MODE)"
```

Make executable: `chmod +x uefi-bootsplash/test/build-scratch-esp.sh`

- [ ] **Step 2: Write assert-boot-log.sh**

```bash
#!/usr/bin/env bash
# uefi-bootsplash/test/assert-boot-log.sh
# Asserts a captured boot log contains an expected substring. Exit 0 on match,
# exit 1 with a clear diagnostic (including the log's actual contents) otherwise.
set -euo pipefail

LOG_FILE="${1:?usage: assert-boot-log.sh <log-file> <expected-substring>}"
EXPECTED="${2:?usage: assert-boot-log.sh <log-file> <expected-substring>}"

if [[ ! -f "$LOG_FILE" ]]; then
  echo "FAIL: log file not found: $LOG_FILE" >&2
  exit 1
fi

if grep -qF -- "$EXPECTED" "$LOG_FILE"; then
  echo "PASS: found \"$EXPECTED\" in $LOG_FILE"
  exit 0
else
  echo "FAIL: did not find \"$EXPECTED\" in $LOG_FILE. Actual contents:" >&2
  cat "$LOG_FILE" >&2
  exit 1
fi
```

Make executable: `chmod +x uefi-bootsplash/test/assert-boot-log.sh`

- [ ] **Step 3: Run both scenarios end-to-end using the new scripts**

```bash
cd uefi-bootsplash
make clean && make
(cd test/dummy-bootmgr && make clean && make)  # or however Task 3's dummy build is invoked

./test/build-scratch-esp.sh notfound test/scratch-notfound.img
./test/run-qemu.sh test/scratch-notfound.img test/boot-notfound.log
./test/assert-boot-log.sh test/boot-notfound.log "Could not find Windows Boot Manager"

./test/build-scratch-esp.sh success test/scratch-success.img
./test/run-qemu.sh test/scratch-success.img test/boot-success.log
./test/assert-boot-log.sh test/boot-success.log "DUMMY WINDOWS BOOT MANAGER REACHED"
```

Expected: both `assert-boot-log.sh` invocations print `PASS` and exit 0.

- [ ] **Step 4: Update .gitignore for the new scratch artifacts**

Add to `uefi-bootsplash/.gitignore` (created in Task 1): `test/scratch-notfound.img`,
`test/scratch-success.img`, `test/boot-notfound.log`, `test/boot-success.log`.

- [ ] **Step 5: Commit**

```bash
cd uefi-bootsplash
git add test/build-scratch-esp.sh test/assert-boot-log.sh .gitignore
git commit -m "test(uefi-bootsplash): scriptable success/not-found boot assertions"
```

---

### Task 5: Documentation — build, manual installation, and real-hardware verification checklist

**Files:**
- Create: `uefi-bootsplash/README.md`

**Interfaces:** None — this is documentation only, consumed by whoever builds,
installs, or verifies this project on real hardware.

- [ ] **Step 1: Write the README**

```markdown
# RMPG Flex UEFI Boot Splash

A standalone gnu-efi application that shows an RMPG-branded splash screen at
power-on, then chainloads the Windows Boot Manager on the same EFI System
Partition. Sits ahead of Desktop Kiosk Shell Mode in the boot chain:

    Power on → this app (splash + chainload) → Windows Boot Manager → Windows
    → Kiosk Shell Mode (explorer.exe replacement) → RMPG Flex desktop

See [`docs/superpowers/specs/2026-07-21-uefi-boot-splash-design.md`](../docs/superpowers/specs/2026-07-21-uefi-boot-splash-design.md)
for the full design and scope decisions (no Secure Boot signing, no
interactivity, no multi-OS support — see that doc's Non-goals section).

## Building

Requires `gnu-efi` and (on Apple Silicon Macs) an x86_64 cross-toolchain, since
this produces an x86_64 PE32+ executable:

    brew install gnu-efi qemu
    # If the host toolchain can't target x86_64 freestanding binaries:
    brew install x86_64-elf-gcc x86_64-elf-binutils

    cd uefi-bootsplash
    make

Produces `build/BOOTX64.EFI`.

## Testing (QEMU + OVMF)

    ./test/build-scratch-esp.sh notfound test/scratch-notfound.img
    ./test/run-qemu.sh test/scratch-notfound.img test/boot-notfound.log
    ./test/assert-boot-log.sh test/boot-notfound.log "Could not find Windows Boot Manager"

    ./test/build-scratch-esp.sh success test/scratch-success.img
    ./test/run-qemu.sh test/scratch-success.img test/boot-success.log
    ./test/assert-boot-log.sh test/boot-success.log "DUMMY WINDOWS BOOT MANAGER REACHED"

Both should print `PASS`. This verifies the splash renders (GOP or text
fallback) and that the chainload mechanism correctly finds and executes a
target file at the well-known Windows Boot Manager path — it does NOT verify
chainloading a genuine Windows install, which needs real hardware (see below).

## Manual installation on a real machine

**Prerequisite: Secure Boot must be disabled** in the machine's firmware
setup (this project does not sign its `.efi` binary — see the design spec's
Non-goals). Enabling this on a machine that will run production RMPG Flex
data is a real security posture change; confirm with IT/security before doing
this on anything but a dedicated test laptop.

1. Boot the target Windows machine, open an elevated Command Prompt.
2. Copy `BOOTX64.EFI` onto the machine's EFI System Partition, e.g. as
   `\EFI\RMPG\rmpgboot.efi` (do NOT overwrite `\EFI\Boot\bootx64.efi` or
   `\EFI\Microsoft\Boot\bootmgfw.efi` — those must remain in place, since this
   app chainloads to the Microsoft one directly).
3. Register it as a new firmware boot entry and set it first in boot order:

       bcdedit /copy {bootmgr} /d "RMPG Flex Boot Splash"
       # bcdedit prints the new entry's GUID — substitute it below
       bcdedit /set {<new-guid>} path \EFI\RMPG\rmpgboot.efi
       bcdedit /set {fwbootmgr} displayorder {<new-guid>} /addfirst

4. Reboot. The splash should appear for ~3 seconds, then Windows should boot
   normally.

## Real-hardware verification checklist [REAL-HARDWARE-UNVERIFIED until done]

This project's automated tests (QEMU + a dummy stand-in file) cannot verify
the following — confirm each on a real test machine (Secure Boot disabled)
before installing on any production patrol/dispatch machine:

- [ ] Splash renders correctly (colors, centered bar) on real GOP-capable
      firmware, not just QEMU's virtual GPU.
- [ ] Chainloading the REAL `\EFI\Microsoft\Boot\bootmgfw.efi` (not a dummy)
      successfully boots into actual Windows.
- [ ] The full chain — splash → Windows boot → Kiosk Shell Mode's
      Winlogon-replaced desktop — works end-to-end on one machine.
- [ ] Disabling this boot entry (via `bcdedit /set {fwbootmgr} displayorder`
      restoring the original order, or removing the new entry with
      `bcdedit /delete {<guid>}`) cleanly restores normal Windows boot with no
      splash, in case this needs to be reverted.
- [ ] Confirm behavior with Secure Boot re-enabled: the machine should refuse
      to run the unsigned `.efi` (falling back to the standard Windows boot
      path) rather than doing anything unexpected — this project does not
      attempt to handle Secure Boot, so "safely refuses" (not "crashes" or
      "does something surprising") is the acceptance bar here, since actually
      supporting Secure Boot is out of scope (see design spec Non-goals).
```

- [ ] **Step 2: Commit**

```bash
cd uefi-bootsplash
git add README.md
git commit -m "docs(uefi-bootsplash): build, install, and real-hardware verification instructions"
```
