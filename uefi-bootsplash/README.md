# RMPG Flex UEFI Boot Splash

A standalone UEFI application that shows an RMPG-branded splash screen at
power-on, then chainloads the Windows Boot Manager on the same EFI System
Partition (ESP). Sits ahead of Desktop Kiosk Shell Mode in the boot chain:

    Power on → this app (splash + chainload) → Windows Boot Manager → Windows
    → Kiosk Shell Mode (explorer.exe replacement) → RMPG Flex desktop

See [`docs/superpowers/specs/2026-07-21-uefi-boot-splash-design.md`](../docs/superpowers/specs/2026-07-21-uefi-boot-splash-design.md)
for the full design and scope decisions (no Secure Boot signing, no
interactivity, no multi-OS support — see that doc's Non-goals section).

## Toolchain (read this before "fixing" the Makefile)

This project does **not** use a Homebrew `gnu-efi` formula (none exists) or
the `x86_64-elf-gcc`/binutils cross-toolchain + `objcopy` ELF→PE conversion
that an earlier draft of this project's plan assumed. That combination *was*
tried first — it compiles, links, and `objcopy`s without error, and `file(1)`
even reports a correctly-shaped PE32+ EFI application — but the resulting
binary does not boot: OVMF page-faults a few instructions into execution.
The root cause is gnu-efi's own `crt0`/`_relocate()` ELF relocation walker,
which is incompatible with this modern binutils version (full writeup in the
Makefile's header comment).

What's actually built and working: **Apple clang's native
`x86_64-unknown-windows` COFF/PE target, linked with LLVM's `lld`**, producing
a native PE32+ image directly — no ELF intermediate, no `objcopy`, no custom
relocation code. The firmware's own PE loader (the same well-tested loader
every real EDK2/Windows binary goes through) handles relocations. gnu-efi is
still used, but only its portable `inc/` headers and a handful of its
`lib/*.c` helper sources (`InitializeLib`, `Print`, string/GUID/console
helpers) recompiled for this target — never its `crt0`/`entry.c`/reloc code.

## Building

Requires Xcode Command Line Tools (for Apple clang — almost certainly already
installed) plus `lld` and `qemu` from Homebrew:

    brew install lld qemu

Then produce `GNUEFI_DIR` (the recompiled gnu-efi headers/lib the Makefile
links against) with the committed helper script — this downloads gnu-efi
3.0.18 from SourceForge and rebuilds its `lib/*.c` sources for the
`x86_64-unknown-windows` target, so it needs network access the first time:

    cd uefi-bootsplash
    ./build-gnuefi-pe.sh              # produces $HOME/.local/gnu-efi-pe
    # or: ./build-gnuefi-pe.sh /path/to/custom/dir

The script is idempotent — if `$GNUEFI_DIR/lib/libefi.a` already exists it
exits immediately without rebuilding. Pass `--force` to rebuild from scratch.
`llvm-ar` (needed to archive the recompiled sources) is not provided by plain
`lld` — if the script can't find it on `PATH` or under Homebrew's `llvm` keg,
it will tell you to `brew install llvm`.

Then build the application itself:

    make
    # or, if GNUEFI_DIR lives somewhere other than the default:
    make GNUEFI_DIR=/path/to/custom/dir

This produces `build/BOOTX64.EFI` — the file name matters (see Manual
installation below): it's the well-known default UEFI boot path
(`\EFI\Boot\BOOTX64.EFI`), which is what the test harness's scratch ESP
images use in `notfound`/`success` mode, and what a real installation places
at a *non-default* path instead (see next section).

## Testing (QEMU + OVMF)

The bundled OVMF firmware (`test/ovmf/OVMF_CODE.fd` / `OVMF_VARS.fd`, copied
from Homebrew's `qemu` package) and `test/run-qemu.sh` are already committed.
Build a scratch ESP image, boot it under QEMU, then assert the serial log
contains the expected string — for both boot outcomes:

    # Not-found path: no Windows Boot Manager present, chainload should fail cleanly
    ./test/build-scratch-esp.sh notfound test/scratch-notfound.img
    ./test/run-qemu.sh test/scratch-notfound.img test/boot-notfound.log
    ./test/assert-boot-log.sh test/boot-notfound.log "Could not find Windows Boot Manager"

    # Success path: a dummy stand-in Windows Boot Manager should get chainloaded into
    ./test/build-scratch-esp.sh success test/scratch-success.img
    ./test/run-qemu.sh test/scratch-success.img test/boot-success.log
    ./test/assert-boot-log.sh test/boot-success.log "DUMMY WINDOWS BOOT MANAGER REACHED"

Both `assert-boot-log.sh` invocations should print `PASS: found "..." in ...`
and exit 0. `build-scratch-esp.sh` builds `build/BOOTX64.EFI` (this project)
and, in `success` mode, `test/dummy-bootmgr/build/BOOTX64.EFI` (a tiny stand-in
"Windows Boot Manager" built from `test/dummy-bootmgr/`) into a FAT32 scratch
ESP image at the requested path, so run `make` (and, for `success` mode,
build `test/dummy-bootmgr`) beforehand — `build-scratch-esp.sh` preflight-checks
for both build artifacts and fails with a clear message if either is missing.

This verifies the splash renders (GOP or text fallback) and that the
chainload mechanism correctly finds and executes a target file at the
well-known Windows Boot Manager path — it does **not** verify chainloading a
genuine Windows install, or how the splash actually looks on real GOP-capable
firmware. Both of those need real hardware (see the checklist below).

Note: QEMU writes live NVRAM state into `test/ovmf/OVMF_VARS.fd` during every
run. `build-scratch-esp.sh` resets it via `git checkout --` before each build,
so this happens automatically as part of the normal test sequence above — no
manual cleanup needed.

## Manual installation on a real machine

**Prerequisite: Secure Boot must be disabled** in the machine's firmware
setup (this project does not sign its `.efi` binary — see the design spec's
Non-goals). Enabling this on a machine that will run production RMPG Flex
data is a real security posture change; confirm with IT/security before doing
this on anything but a dedicated test laptop.

1. Boot the target Windows machine, open an elevated Command Prompt.
2. Copy `build/BOOTX64.EFI` onto the machine's EFI System Partition, e.g. as
   `\EFI\RMPG\rmpgboot.efi` (do NOT overwrite `\EFI\Boot\bootx64.efi` or
   `\EFI\Microsoft\Boot\bootmgfw.efi` — those must remain in place, since this
   app chainloads to the Microsoft one directly). Note the file is built and
   tested as `BOOTX64.EFI` (the default boot path used in QEMU testing above),
   but on a real Windows install it must be copied to a *non-default* path
   like the one above and registered explicitly via `bcdedit` (step 3) — it
   should not replace the existing default boot file.
3. Register it as a new firmware boot entry and set it first in boot order:

       bcdedit /copy {bootmgr} /d "RMPG Flex Boot Splash"
       # bcdedit prints the new entry's GUID — substitute it below
       bcdedit /set {<new-guid>} path \EFI\RMPG\rmpgboot.efi
       bcdedit /set {fwbootmgr} displayorder {<new-guid>} /addfirst

4. Reboot. The splash should appear briefly, then Windows should boot
   normally (the app chainloads to `\EFI\Microsoft\Boot\bootmgfw.efi`, the
   real Windows Boot Manager, once the splash has been shown).

## Real-hardware verification checklist [REAL-HARDWARE-UNVERIFIED until done]

This project's automated tests (QEMU + OVMF, and a dummy stand-in "Windows
Boot Manager" file) cannot verify the following — confirm each on a real test
machine (Secure Boot disabled) before installing on any production
patrol/dispatch machine:

- [ ] Splash renders correctly (colors, centered bar) on real GOP-capable
      firmware, not just QEMU's virtual GPU — only QEMU's virtual GPU has
      been exercised so far.
- [ ] Chainloading the REAL `\EFI\Microsoft\Boot\bootmgfw.efi` (not the
      `test/dummy-bootmgr/` stand-in used in QEMU testing) successfully boots
      into actual Windows.
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
