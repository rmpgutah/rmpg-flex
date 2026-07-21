# Kiosk Linux Base Image Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a minimal Buildroot-based Linux kernel + root filesystem that boots
to a working BusyBox shell prompt under QEMU, proving the toolchain for the later
graphics/RMPG-Flex/update sub-projects.

**Architecture:** A `kiosk-linux/` directory (standalone subsystem, parallel to
`uefi-bootsplash/` and `desktop/`) containing a Buildroot `defconfig`, a build wrapper
script that fetches a pinned Buildroot release and builds against that defconfig, and a
QEMU-based boot-verification test harness modeled directly on
`uefi-bootsplash/test/run-qemu.sh` / `assert-boot-log.sh`'s proven pattern.

**Tech Stack:** Buildroot (pinned release), GNU Make, QEMU (`qemu-system-x86_64`,
already installed per the UEFI splash project), Bash for wrapper/test scripts.

## Global Constraints

- QEMU/generic x86_64 target only — no real-hardware driver configuration in this plan.
- No graphics stack, no RMPG Flex/Electron, no update/A/B mechanism — this plan's ONLY
  deliverable is a kernel+initramfs that boots to a shell prompt.
- BusyBox init only — no systemd, no general-purpose distro packages beyond what's
  needed to reach a shell (this keeps the defconfig, and therefore the build, small
  and fast to iterate on).
- Reproducibility matters exactly as it did for `uefi-bootsplash/build-gnuefi-pe.sh` —
  the Buildroot version must be pinned to a specific release tag in a committed script,
  never left as "whatever the latest Buildroot happens to be" or as untracked local
  session state.
- The boot-completion signal must be a distinctive, purpose-built marker string printed
  by an init script this project controls — not a heuristic match against generic
  kernel log text, which can vary across kernel versions/Buildroot releases and would
  make the test suite brittle.
- Every new script follows the `set -euo pipefail` / clear-error-message convention
  already established in `uefi-bootsplash/test/*.sh`.
- This plan does not modify `uefi-bootsplash/`, `desktop/`, `client/`, or `src/` in any
  way — fully standalone under `kiosk-linux/`.

---

## File Structure

- **Create:** `kiosk-linux/configs/qemu_x86_64_kiosk_defconfig` — Buildroot defconfig:
  QEMU x86_64 target, BusyBox init, minimal package set, initramfs output, the custom
  rootfs overlay wired in.
- **Create:** `kiosk-linux/rootfs-overlay/etc/init.d/S99kiosk-boot-marker` — a BusyBox
  init script (Buildroot's standard `BR2_ROOTFS_OVERLAY` mechanism copies this
  directory's contents onto the target rootfs verbatim) that prints a distinctive,
  purpose-built marker string once startup reaches its end, before dropping to a shell.
- **Create:** `kiosk-linux/build.sh` — fetches a pinned Buildroot release, applies the
  defconfig via an out-of-tree build (`BR2_DEFCONFIG` + `O=`), builds, and produces
  `kiosk-linux/output/images/bzImage` + `rootfs.cpio.gz`.
- **Create:** `kiosk-linux/test/run-qemu.sh` — boots the built kernel+initramfs under
  QEMU with a serial console, capturing output to a log file.
- **Create:** `kiosk-linux/test/assert-boot-log.sh` — asserts a captured boot log
  contains an expected substring (same interface/behavior as
  `uefi-bootsplash/test/assert-boot-log.sh` — this plan reuses that exact script
  verbatim, just relocated, since its logic is generic and not UEFI-specific).
- **Create:** `kiosk-linux/README.md` — build/test instructions and this sub-project's
  explicit scope boundary (what it does and does NOT do yet).

---

### Task 1: Buildroot toolchain scaffold — boots to a shell with a real completion marker

**Files:**
- Create: `kiosk-linux/configs/qemu_x86_64_kiosk_defconfig`
- Create: `kiosk-linux/rootfs-overlay/etc/init.d/S99kiosk-boot-marker`
- Create: `kiosk-linux/build.sh`
- Create: `kiosk-linux/test/run-qemu.sh` (first version — Task 2 turns the surrounding
  manual verification into fully scripted, assertable form; this task's version just
  needs to work for your own manual verification)

**Interfaces:**
- Produces: `kiosk-linux/output/images/bzImage`, `kiosk-linux/output/images/rootfs.cpio.gz`
  — consumed by every later task's QEMU invocation. The boot marker string
  `KIOSK_LINUX_BOOT_OK` (exact text — later tasks' assertion scripts match this literal
  string) — consumed by Task 2's `assert-boot-log.sh` usage.

This task has real, unavoidable environment uncertainty (Buildroot's actual host build
dependencies, exact release-tag availability, whether this Mac's toolchain can
cross-compile a Linux kernel+userspace at all without additional host packages) —
similar in kind to `uefi-bootsplash`'s Task 1. Adapt as needed and document exactly what
you did, the same way that task's report/Makefile comments did.

- [ ] **Step 1: Install host build dependencies**

Buildroot requires a functioning host toolchain plus several standard build tools. On
macOS, Buildroot's own documentation notes Linux is the only officially supported host
— building on macOS typically requires a Linux container/VM, since Buildroot's build
process assumes a POSIX toolchain producing ELF binaries and several GNU-specific
tool behaviors that macOS's BSD userland doesn't provide, unlike `uefi-bootsplash`'s
situation (which only needed a cross-compiler, not an entire build system assuming a
Linux host). Before writing any code, verify this directly:

```bash
git clone --depth 1 https://github.com/buildroot/buildroot.git /tmp/buildroot-check
cd /tmp/buildroot-check
make qemu_x86_64_defconfig
make 2>&1 | tee /tmp/buildroot-check-build.log | head -50
```

If this fails early with host-toolchain errors characteristic of macOS/Linux
incompatibility (not just a slow build — an actual failure), STOP and report BLOCKED
with the exact error. This is a legitimate, environment-driven blocker, not something
to work around by guessing — Buildroot on macOS may require a Docker container running
a Linux userland (e.g. `docker run --rm -it -v $(pwd):/build -w /build <a Linux image
with build-essential, and rest of the documented dependency list> bash`) to actually
work, and if so, that container-based approach should become this task's actual build
mechanism, with `build.sh` shelling out to `docker run` rather than running Buildroot's
`make` directly on the host. Document clearly which situation you found and why, exactly
as `uefi-bootsplash`'s Task 1 report documented its own toolchain pivot.

- [ ] **Step 2: Write the rootfs overlay's boot-marker init script**

```sh
#!/bin/sh
# kiosk-linux/rootfs-overlay/etc/init.d/S99kiosk-boot-marker
#
# Runs last among BusyBox init's /etc/init.d/S* scripts (S99 sorts after every
# other S-prefixed script in the default numeric ordering). Prints a fixed,
# purpose-built marker to the console once startup has fully completed — this
# is what test/assert-boot-log.sh matches against, rather than any generic
# kernel/BusyBox log text, which can vary across Buildroot/kernel versions and
# would make the boot test brittle if it depended on incidental log wording.
echo "KIOSK_LINUX_BOOT_OK"
```

Make it executable in the overlay tree: `chmod +x kiosk-linux/rootfs-overlay/etc/init.d/S99kiosk-boot-marker`

- [ ] **Step 3: Write the defconfig**

Start from Buildroot's own `qemu_x86_64_defconfig` (confirmed working in Step 1) and
layer in the project-specific options. The exact mechanism for doing this is running
Buildroot's `make menuconfig`/`make busybox-menuconfig` interactively is not practical
for a non-interactive implementer — instead, start from the base defconfig file
Buildroot ships (`/tmp/buildroot-check/configs/qemu_x86_64_defconfig` from Step 1, or
wherever your actual clone lives) and layer these additions on top via Buildroot's
config-fragment mechanism (`make BR2_DEFCONFIG=<path> defconfig` accepts a plain
defconfig file — the simplest approach is to copy the base file and append/override
these specific keys):

```
# kiosk-linux/configs/qemu_x86_64_kiosk_defconfig
# Based on Buildroot's stock qemu_x86_64_defconfig — copy that file's full content
# first (see build.sh's BUILDROOT_TAG for the exact pinned version this was verified
# against), then ensure these keys are present/overridden:

BR2_x86_64=y
BR2_TOOLCHAIN_BUILDROOT_CXX=n
BR2_TARGET_GENERIC_HOSTNAME="kiosk-linux"
BR2_TARGET_GENERIC_ISSUE="RMPG Flex Kiosk Linux (sub-project 1: base image only)"
BR2_INIT_BUSYBOX=y
BR2_SYSTEM_DHCP=""
BR2_ROOTFS_OVERLAY="../../rootfs-overlay"
BR2_TARGET_ROOTFS_CPIO=y
BR2_TARGET_ROOTFS_CPIO_GZIP=y
BR2_TARGET_ROOTFS_EXT2=n
BR2_LINUX_KERNEL_DEFCONFIG="x86_64"
```

Note: `BR2_ROOTFS_OVERLAY`'s path is relative to Buildroot's own build directory (the
`O=` out-of-tree output dir this plan's `build.sh` sets up in Step 4), NOT relative to
this repo — verify and adjust the relative path once you've established `build.sh`'s
actual directory layout in the next step; the exact number of `../` segments depends on
where `O=` points relative to `kiosk-linux/rootfs-overlay`. Get this working by trial
(a wrong relative path fails loudly at `make defconfig` or `make` time with a clear
"overlay directory not found" error — this is not a silent failure mode).

- [ ] **Step 4: Write build.sh**

```bash
#!/usr/bin/env bash
# kiosk-linux/build.sh
# Fetches a pinned Buildroot release and builds the kiosk-linux defconfig,
# producing kiosk-linux/output/images/{bzImage,rootfs.cpio.gz}.
#
# Buildroot version pinned for reproducibility (see uefi-bootsplash/build-gnuefi-pe.sh
# for the same rationale applied to gnu-efi) — override on the command line if a
# specific machine already has a different checkout:
#   BUILDROOT_DIR=/path/to/existing/checkout ./build.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILDROOT_TAG="${BUILDROOT_TAG:-2024.02.9}"
BUILDROOT_DIR="${BUILDROOT_DIR:-$HOME/.local/buildroot-kiosk-linux}"
OUTPUT_DIR="$SCRIPT_DIR/output"

if [ ! -d "$BUILDROOT_DIR/.git" ]; then
  echo "Cloning Buildroot $BUILDROOT_TAG to $BUILDROOT_DIR ..."
  git clone --branch "$BUILDROOT_TAG" --depth 1 https://github.com/buildroot/buildroot.git "$BUILDROOT_DIR"
else
  echo "Using existing Buildroot checkout at $BUILDROOT_DIR"
  CURRENT_TAG="$(git -C "$BUILDROOT_DIR" describe --tags --exact-match 2>/dev/null || echo "unknown")"
  if [ "$CURRENT_TAG" != "$BUILDROOT_TAG" ]; then
    echo "WARNING: existing checkout is at '$CURRENT_TAG', expected '$BUILDROOT_TAG'." >&2
    echo "Remove $BUILDROOT_DIR to force a fresh pinned-version clone, or set BUILDROOT_TAG to match." >&2
  fi
fi

mkdir -p "$OUTPUT_DIR"

echo "Applying defconfig ..."
make -C "$BUILDROOT_DIR" O="$OUTPUT_DIR" BR2_DEFCONFIG="$SCRIPT_DIR/configs/qemu_x86_64_kiosk_defconfig" defconfig

echo "Building (this takes a while on first run) ..."
make -C "$OUTPUT_DIR"

echo "Build complete:"
ls -la "$OUTPUT_DIR/images/bzImage" "$OUTPUT_DIR/images/rootfs.cpio.gz" 2>/dev/null || {
  echo "ERROR: expected output images not found in $OUTPUT_DIR/images/ — build likely failed partway; check the make output above." >&2
  exit 1
}
```

Make executable: `chmod +x kiosk-linux/build.sh`

Adjust `BUILDROOT_TAG` if `2024.02.9` doesn't exist as a real tag on the Buildroot
GitHub mirror at the time you run this — check available tags first
(`git ls-remote --tags https://github.com/buildroot/buildroot.git | grep '2024\.02'`)
and pin to the closest genuinely-available LTS-series release, documenting in your
report which exact tag you ended up using and why if it differs from this plan's
placeholder value.

- [ ] **Step 5: Run the build**

Run: `cd kiosk-linux && ./build.sh`
Expected: completes (may take 10-30+ minutes on first run — Buildroot builds an entire
cross-toolchain from source by default) and produces
`kiosk-linux/output/images/bzImage` and `kiosk-linux/output/images/rootfs.cpio.gz`.

If Step 1's environment check already revealed macOS can't build Buildroot natively,
this step instead runs inside whatever container/VM mechanism Step 1 determined was
necessary — adapt `build.sh` accordingly and document the real invocation clearly.

- [ ] **Step 6: Write a first-pass QEMU boot check**

```bash
#!/usr/bin/env bash
# kiosk-linux/test/run-qemu.sh
# Boots the built kernel+initramfs under QEMU with a serial console, capturing
# output to a log file for assertion.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="${1:-$SCRIPT_DIR/boot.log}"
KERNEL="$ROOT_DIR/output/images/bzImage"
INITRD="$ROOT_DIR/output/images/rootfs.cpio.gz"

[ -f "$KERNEL" ] || { echo "kernel not found at $KERNEL — run ./build.sh first" >&2; exit 1; }
[ -f "$INITRD" ] || { echo "initramfs not found at $INITRD — run ./build.sh first" >&2; exit 1; }

rm -f "$LOG_FILE"

timeout 30 qemu-system-x86_64 \
  -kernel "$KERNEL" \
  -initrd "$INITRD" \
  -append "console=ttyS0" \
  -serial file:"$LOG_FILE" \
  -display none \
  -nographic \
  -no-reboot || true

echo "wrote $LOG_FILE"
```

Note: unlike `uefi-bootsplash/test/run-qemu.sh` (which backgrounds QEMU and kills it
after a `sleep`, since a UEFI app under OVMF doesn't have a native timeout mechanism
available to the test script), this script uses the `timeout` command directly, since
a plain kernel direct-boot under QEMU with no OVMF layer can be killed cleanly this way.
If `timeout` isn't available on this macOS host (it's a GNU coreutils command, not
always present by default), install it via `brew install coreutils` (provides `gtimeout`
— adjust the script to use `gtimeout` if `timeout` isn't found, checking for both).

Make executable: `chmod +x kiosk-linux/test/run-qemu.sh`

- [ ] **Step 7: Verify the boot marker appears**

Run: `cd kiosk-linux && ./test/run-qemu.sh test/boot.log && cat test/boot.log`
Expected: log contains the literal string `KIOSK_LINUX_BOOT_OK` somewhere in the
captured output, proving the full kernel → BusyBox init → your custom init script
chain executed successfully.

- [ ] **Step 8: Commit**

```bash
cd kiosk-linux
git add configs/ rootfs-overlay/ build.sh test/run-qemu.sh
git commit -m "feat(kiosk-linux): scaffold Buildroot toolchain with a working QEMU boot check"
```

Add a `.gitignore` in the same commit excluding `kiosk-linux/output/` and
`kiosk-linux/test/boot.log` (do not commit Buildroot's build output — it's large and
fully reproducible via `build.sh`).

---

### Task 2: Scriptable boot-log assertion

**Files:**
- Create: `kiosk-linux/test/assert-boot-log.sh`
- Modify: `kiosk-linux/test/run-qemu.sh` (accept a configurable log-file path
  argument if Task 1's version hardcoded one — confirm and adjust for consistency
  with how `assert-boot-log.sh` will be invoked)

**Interfaces:**
- Produces: `kiosk-linux/test/assert-boot-log.sh <log-file> <expected-substring>` —
  exit 0/PASS on match, exit 1/FAIL with the log's actual contents on mismatch. This is
  the standard verification recipe documented in Task 3's README.

- [ ] **Step 1: Write assert-boot-log.sh**

This is functionally identical to `uefi-bootsplash/test/assert-boot-log.sh` — read that
file first and reuse its exact logic (the assertion behavior is entirely generic, not
UEFI-specific):

```bash
#!/usr/bin/env bash
# kiosk-linux/test/assert-boot-log.sh
# Asserts a captured boot log contains an expected substring. Exit 0 on match,
# exit 1 with a clear diagnostic (including the log's actual contents) otherwise.
set -euo pipefail

LOG_FILE="${1:?usage: assert-boot-log.sh <log-file> <expected-substring>}"
EXPECTED="${2:?usage: assert-boot-log.sh <log-file> <expected-substring>}"

if [[ ! -f "$LOG_FILE" ]]; then
  echo "FAIL: log file not found: $LOG_FILE" >&2
  exit 1
fi

if grep -qaF -- "$EXPECTED" "$LOG_FILE"; then
  echo "PASS: found \"$EXPECTED\" in $LOG_FILE"
  exit 0
else
  echo "FAIL: did not find \"$EXPECTED\" in $LOG_FILE. Actual contents:" >&2
  cat "$LOG_FILE" >&2
  exit 1
fi
```

(`-a` flag included per `uefi-bootsplash`'s Task 4 finding that some captured serial
output can look binary-ish to `grep` without it — apply the same fix proactively here
rather than rediscovering it.)

Make executable: `chmod +x kiosk-linux/test/assert-boot-log.sh`

- [ ] **Step 2: Run the full scripted verification**

```bash
cd kiosk-linux
./test/run-qemu.sh test/boot.log
./test/assert-boot-log.sh test/boot.log "KIOSK_LINUX_BOOT_OK"
```

Expected: prints `PASS: found "KIOSK_LINUX_BOOT_OK" in test/boot.log` and exits 0.

- [ ] **Step 3: Commit**

```bash
cd kiosk-linux
git add test/assert-boot-log.sh
git commit -m "test(kiosk-linux): scriptable boot-marker assertion"
```

---

### Task 3: Documentation

**Files:**
- Create: `kiosk-linux/README.md`

**Interfaces:** None — documentation only.

- [ ] **Step 1: Write the README**

```markdown
# Kiosk Linux Base Image (sub-project 1)

A minimal Buildroot-based Linux kernel + root filesystem that boots to a working
BusyBox shell under QEMU. This is the FIRST of a multi-sub-project program exploring
a custom Linux-based kiosk OS as an alternative platform to the Windows-based Desktop
Kiosk Shell Mode / UEFI Boot Splash work already shipped elsewhere in this repo.

See [`docs/superpowers/specs/2026-07-21-kiosk-linux-base-image-design.md`](../docs/superpowers/specs/2026-07-21-kiosk-linux-base-image-design.md)
for the full design and explicit scope decisions.

## What this does NOT do yet

- No graphics/display stack (sub-project 2)
- Does not run RMPG Flex or any browser (sub-project 3)
- No update/provisioning mechanism (sub-project 4)
- No real hardware support — QEMU/generic x86_64 only (deferred until specific target
  hardware is identified)
- No connection to the existing `uefi-bootsplash/` project — that project still
  chainloads to Windows only; whether it might later chainload to this image instead
  is an undecided future integration question

## Building

Requires Buildroot's host build dependencies. **Buildroot officially supports Linux
hosts only** — see [`docs/superpowers/specs/2026-07-21-kiosk-linux-base-image-design.md`]
and this project's Task 1 implementation notes for exactly what was found to work (or
not) when building on this repo's macOS dev environment, and whether a container/VM
was required.

    cd kiosk-linux
    ./build.sh

Produces `output/images/bzImage` and `output/images/rootfs.cpio.gz`. First build takes
significantly longer than a typical build (Buildroot compiles an entire toolchain from
source).

## Testing

    ./test/run-qemu.sh test/boot.log
    ./test/assert-boot-log.sh test/boot.log "KIOSK_LINUX_BOOT_OK"

Should print `PASS`. This confirms the kernel boots, BusyBox init runs, and the
project's own boot-marker init script (`rootfs-overlay/etc/init.d/S99kiosk-boot-marker`)
executes to completion — i.e., the full chain works end to end.

## Reproducibility

The exact Buildroot release is pinned in `build.sh` (`BUILDROOT_TAG`) — do not build
against an unpinned/latest Buildroot checkout, for the same reproducibility reasons
documented in `uefi-bootsplash/build-gnuefi-pe.sh`.
```

Fill in the "Building" section's Task-1-implementation-notes reference with the ACTUAL
outcome discovered in Task 1 (native macOS build vs. container/VM requirement) — do not
leave this as a placeholder pointing vaguely at "see the design spec," since the design
spec doesn't contain that outcome (it wasn't known until Task 1 ran). Write the real,
concrete build prerequisite/command sequence a new engineer would actually need,
exactly as `uefi-bootsplash/README.md` did after ITS toolchain reality was discovered
in ITS Task 1.

- [ ] **Step 2: Commit**

```bash
cd kiosk-linux
git add README.md
git commit -m "docs(kiosk-linux): build, test, and scope-boundary documentation"
```
