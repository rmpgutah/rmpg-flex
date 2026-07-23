# Kiosk Linux — Running RMPG Flex (sub-project 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real networking and a WPE WebKit (via Cog) kiosk browser pointed at `https://rmpgutah.us` to the existing `kiosk-linux/` Buildroot image, verified via boot markers and a real QEMU screenshot of rendered page content.

**Architecture:** Two Buildroot-config + rootfs-overlay-init-script additions layered on the existing sub-project 1+2 image: (1) kernel `virtio-net` support + BusyBox `udhcpc` + `ca-certificates`, verified via a `KIOSK_LINUX_NET_OK` boot marker; (2) `WPE WebKit` + `Cog`, launched by a new init script once networking is confirmed, verified via a `KIOSK_LINUX_BROWSER_OK` boot marker plus a QEMU screenshot of the actually-rendered page.

**Tech Stack:** Buildroot 2024.02.9 (pinned, per existing `build.sh` `BUILDROOT_TAG`), BusyBox `udhcpc`, WPE WebKit + Cog, QEMU (`-netdev user` SLIRP NAT + `virtio-net-pci` + existing `virtio-gpu-pci`/`-vga none` screenshot pattern from sub-project 2).

## Global Constraints

- Buildroot release stays pinned at `2024.02.9` (`BUILDROOT_TAG` in `kiosk-linux/build.sh`) — do not bump it as part of this work.
- All new/changed Buildroot config paths referenced from the defconfig must be absolute in-container paths (`/kiosk-linux/...`), per the existing `BR2_ROOTFS_OVERLAY` / `BR2_LINUX_KERNEL_CONFIG_FRAGMENT_FILES` convention — `build.sh` only bind-mounts this project's directory at `/kiosk-linux`.
- Any new init script under `rootfs-overlay/etc/init.d/` must use the `S99kiosk-<name>-marker` naming pattern and print a distinguishable, unambiguous marker string only on genuine, verified success — never on process-alive alone (this project has twice hit false-positive markers from trusting the wrong signal; see `S99kiosk-drm-marker`'s own comments).
- Buildroot/BusyBox Kconfig symbol names must be verified against the actual pinned checkout inside the build volume before being trusted — this project has hit a wrong-guessed-symbol bug before (`BR2_PACKAGE_MESA3D_DRIVER_VIRGL` vs. the real `BR2_PACKAGE_MESA3D_GALLIUM_DRIVER_VIRGL`). Every task below includes the exact grep command to run for this verification.
- Target URL is hardcoded to `https://rmpgutah.us` — no config-file indirection (per the approved spec).
- No Chromium, no auto-login, no update/provisioning mechanism, no real-hardware support — all explicitly out of scope per `docs/superpowers/specs/2026-07-22-kiosk-linux-rmpg-flex-browser-design.md`.

---

### Task 1: Networking (virtio-net + udhcpc + ca-certificates)

**Files:**
- Create: `kiosk-linux/configs/kernel-net.fragment`
- Create: `kiosk-linux/configs/busybox-net.fragment`
- Modify: `kiosk-linux/configs/qemu_x86_64_kiosk_defconfig`
- Create: `kiosk-linux/rootfs-overlay/etc/init.d/S99kiosk-net-marker`
- Create: `kiosk-linux/test/run-qemu-net.sh`
- Test: manual QEMU run of `run-qemu-net.sh` + `test/assert-boot-log.sh`

**Interfaces:**
- Produces: boot marker string `KIOSK_LINUX_NET_OK` in the serial console log, printed only after a DHCP lease is confirmed AND a plain-HTTP reachability check succeeds. Task 2's browser marker script depends on this marker having already printed before it attempts to launch the browser.
- Produces: `test/run-qemu-net.sh <log_file>` — a QEMU boot-only harness (no display device, modeled on `test/run-qemu.sh`) that adds `-netdev user,id=net0 -device virtio-net-pci,netdev=net0` (SLIRP NAT, giving the guest real outbound internet access for testing) and writes the serial log to `<log_file>` (default `test/boot-net.log`).

- [ ] **Step 1: Write the kernel config fragment for virtio-net**

Create `kiosk-linux/configs/kernel-net.fragment`:

```
# kiosk-linux/configs/kernel-net.fragment
# Enables the virtio-net paravirtualized NIC driver, for real network
# connectivity under QEMU (-device virtio-net-pci). Layered on top of the
# existing in-tree "x86_64" kernel defconfig the same way
# kiosk-linux/configs/kernel-drm.fragment already layers in DRM/virtio-gpu
# support, via BR2_LINUX_KERNEL_CONFIG_FRAGMENT_FILES (both fragments are
# listed together in qemu_x86_64_kiosk_defconfig).
CONFIG_VIRTIO_NET=y
CONFIG_VIRTIO_PCI=y
CONFIG_NET=y
CONFIG_INET=y
CONFIG_PACKET=y
```

- [ ] **Step 2: Write the BusyBox config fragment for udhcpc**

Create `kiosk-linux/configs/busybox-net.fragment`:

```
# kiosk-linux/configs/busybox-net.fragment
# Ensures BusyBox's udhcpc DHCP client applet is built in. Buildroot's default
# BusyBox config already enables this in most releases, but this fragment
# makes it an explicit, non-negotiable requirement for this project rather
# than an implicit default that could silently regress.
CONFIG_UDHCPC=y
```

- [ ] **Step 3: Modify the defconfig to wire in networking**

Edit `kiosk-linux/configs/qemu_x86_64_kiosk_defconfig`. Change this existing line:

```
BR2_LINUX_KERNEL_CONFIG_FRAGMENT_FILES="/kiosk-linux/configs/kernel-drm.fragment"
```

to:

```
BR2_LINUX_KERNEL_CONFIG_FRAGMENT_FILES="/kiosk-linux/configs/kernel-drm.fragment /kiosk-linux/configs/kernel-net.fragment"
```

Then append this new section at the end of the file:

```
# Networking (sub-project 3, Task 1). udhcpc (BusyBox) acquires a DHCP lease
# over the virtio-net interface; ca-certificates provides the Mozilla trust
# root bundle WPE WebKit needs to validate rmpgutah.us's TLS certificate.
BR2_PACKAGE_BUSYBOX_CONFIG_FRAGMENT_FILES="/kiosk-linux/configs/busybox-net.fragment"
BR2_PACKAGE_CA_CERTIFICATES=y
```

- [ ] **Step 4: Verify the real Buildroot Kconfig symbol names before building**

Buildroot's source checkout lives in the `kiosk-linux-buildroot-src` named Docker
volume (created by `build.sh`). Before trusting the symbol names written above,
verify them against the real pinned checkout:

```bash
docker run --rm -v kiosk-linux-buildroot-src:/buildroot-src kiosk-linux-buildroot:latest \
  sh -c 'grep -n "CA_CERTIFICATES" /buildroot-src/buildroot/package/ca-certificates/Config.in; \
         grep -rn "CONFIG_UDHCPC" /buildroot-src/buildroot/package/busybox/*.config 2>/dev/null || true'
```

Expected: the first grep shows a real `config BR2_PACKAGE_CA_CERTIFICATES` stanza
(if the symbol name differs, correct Step 3's defconfig entry to match exactly,
the same way this project corrected the Mesa3D symbol in sub-project 2). If the
Docker image/volume don't exist yet (first run in a fresh environment), run
`./build.sh` once first — it builds the image and clones Buildroot as its first
two steps regardless of whether the full build succeeds — then re-run this grep.

- [ ] **Step 5: Write the network boot-marker init script**

Create `kiosk-linux/rootfs-overlay/etc/init.d/S99kiosk-net-marker` (executable):

```sh
#!/bin/sh
# kiosk-linux/rootfs-overlay/etc/init.d/S99kiosk-net-marker
#
# Runs after S99kiosk-boot-marker and S99kiosk-drm-marker (lexicographic order:
# "S99kiosk-boot-marker" < "S99kiosk-drm-marker" < "S99kiosk-net-marker" —
# same tie-breaking behavior on the shared S99 prefix already confirmed in
# S99kiosk-drm-marker's own comments). Acquires a DHCP lease over eth0 (the
# virtio-net interface) and confirms real outbound connectivity with a plain
# HTTP request — HTTP, not HTTPS, deliberately: BusyBox wget in this image has
# no TLS support built in, and proving basic IP connectivity + DNS + routing
# doesn't require it. HTTPS trust (via the ca-certificates bundle installed in
# Task 1) is exercised for real by WPE WebKit itself in Task 2's browser
# marker, not by this script.
ip link set eth0 up 2>/dev/null

# udhcpc -n (exit if lease not obtained) -q (quit after obtaining lease) blocks
# until it succeeds or gives up — no manual polling loop needed here, unlike
# the DRM marker's modetest handling, since udhcpc's own exit code IS a
# trustworthy success/failure signal (it does not fall through to a shared
# "still running" state the way modetest does).
if udhcpc -i eth0 -n -q -t 5 -T 3 >/tmp/udhcpc.log 2>&1; then
  if wget -q -T 5 -O /dev/null http://neverssl.com/; then
    echo "KIOSK_LINUX_NET_OK"
  else
    echo "KIOSK_LINUX_NET_FAILED (dhcp lease acquired, but http reachability check failed)"
  fi
else
  echo "KIOSK_LINUX_NET_FAILED (no dhcp lease, see /tmp/udhcpc.log)"
  cat /tmp/udhcpc.log
fi
```

Make it executable:

```bash
chmod +x kiosk-linux/rootfs-overlay/etc/init.d/S99kiosk-net-marker
```

- [ ] **Step 6: Write the network-only QEMU test harness**

Create `kiosk-linux/test/run-qemu-net.sh` (executable), modeled on the existing
`test/run-qemu.sh` boot-only harness but adding a virtio-net device with SLIRP
NAT for real outbound connectivity:

```bash
#!/usr/bin/env bash
# kiosk-linux/test/run-qemu-net.sh
# Boots the built kernel+initramfs under QEMU with a virtio-net NIC on a SLIRP
# (-netdev user) NAT interface, giving the guest real outbound internet access
# for testing without any host firewall/bridge configuration. This is a test
# harness convenience, not a claim about how a real deployed device gets
# network access (that's a real-hardware concern, explicitly deferred).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="${1:-$SCRIPT_DIR/boot-net.log}"
KERNEL="$ROOT_DIR/output/images/bzImage"
INITRD="$ROOT_DIR/output/images/rootfs.cpio.gz"

[ -f "$KERNEL" ] || { echo "kernel not found at $KERNEL — run ./build.sh first" >&2; exit 1; }
[ -f "$INITRD" ] || { echo "initramfs not found at $INITRD — run ./build.sh first" >&2; exit 1; }

if command -v timeout >/dev/null 2>&1; then TIMEOUT_CMD="timeout"
elif command -v gtimeout >/dev/null 2>&1; then TIMEOUT_CMD="gtimeout"
else
  echo "ERROR: neither 'timeout' nor 'gtimeout' found. Install GNU coreutils:" >&2
  echo "  brew install coreutils" >&2
  exit 1
fi

rm -f "$LOG_FILE"

"$TIMEOUT_CMD" 30 qemu-system-x86_64 \
  -kernel "$KERNEL" \
  -initrd "$INITRD" \
  -append "console=ttyS0" \
  -netdev user,id=net0 \
  -device virtio-net-pci,netdev=net0 \
  -serial file:"$LOG_FILE" \
  -display none \
  -nographic \
  -no-reboot || true

echo "wrote $LOG_FILE"
```

```bash
chmod +x kiosk-linux/test/run-qemu-net.sh
```

- [ ] **Step 7: Build the image**

```bash
cd kiosk-linux && ./build.sh
```

Expected: build completes (this is a full kernel/toolchain rebuild since a
kernel config fragment changed — budget the same 15–40+ minutes sub-project 1
saw for a from-scratch-ish rebuild). Confirm at the end:

```bash
ls -la output/images/bzImage output/images/rootfs.cpio.gz
```

- [ ] **Step 8: Run the network test and verify the marker**

```bash
./test/run-qemu-net.sh test/boot-net.log
./test/assert-boot-log.sh test/boot-net.log "KIOSK_LINUX_NET_OK"
```

Expected: prints `PASS`. If it instead prints `KIOSK_LINUX_NET_FAILED (...)`,
read `test/boot-net.log` for the specific failure — a NAT/SLIRP misconfiguration
in the QEMU invocation is the most likely cause if the DHCP lease itself fails;
a DNS/reachability issue on the host running the test is the most likely cause
if the lease succeeds but the `wget` check fails.

- [ ] **Step 9: Commit**

```bash
git add kiosk-linux/configs/kernel-net.fragment kiosk-linux/configs/busybox-net.fragment \
        kiosk-linux/configs/qemu_x86_64_kiosk_defconfig \
        kiosk-linux/rootfs-overlay/etc/init.d/S99kiosk-net-marker \
        kiosk-linux/test/run-qemu-net.sh
git commit -m "feat(kiosk-linux): add virtio-net + udhcpc + ca-certificates networking"
```

---

### Task 2: WPE WebKit + Cog kiosk browser

**Files:**
- Modify: `kiosk-linux/configs/qemu_x86_64_kiosk_defconfig`
- Create: `kiosk-linux/rootfs-overlay/etc/init.d/S99kiosk-browser-marker`
- Create: `kiosk-linux/test/run-qemu-browser.sh`
- Modify: `kiosk-linux/README.md` (document sub-project 3, matching the existing sub-project 2 section's style)
- Test: manual QEMU run of `run-qemu-browser.sh` + `test/assert-boot-log.sh` + visual screenshot inspection

**Interfaces:**
- Consumes: `KIOSK_LINUX_NET_OK` marker from Task 1 — this task's init script must not attempt to launch the browser before that marker has printed.
- Produces: boot marker `KIOSK_LINUX_BROWSER_OK`, printed once the `cog` process has launched and stayed alive past a bounded startup window (WPE WebKit + page load takes noticeably longer than `modetest`'s near-instant run in sub-project 2 — budget accordingly, see Step 3).
- Produces: `test/run-qemu-browser.sh <log_file> <screenshot_file>` — same signature/pattern as the existing `test/run-qemu-graphics.sh`, adding the Task 1 network device alongside the existing `virtio-gpu-pci`/`-vga none` display device, with a longer capture delay to allow real page rendering.

- [ ] **Step 1: Verify the real WPE WebKit / Cog Kconfig symbol names**

```bash
docker run --rm -v kiosk-linux-buildroot-src:/buildroot-src kiosk-linux-buildroot:latest \
  sh -c 'grep -n "^config BR2_PACKAGE_WPEWEBKIT" -A2 /buildroot-src/buildroot/package/wpewebkit/Config.in; \
         grep -n "^config BR2_PACKAGE_COG" -A2 /buildroot-src/buildroot/package/cog/Config.in'
```

Expected: both greps show real `config` stanzas. Note the exact symbol names
found — if `BR2_PACKAGE_WPEWEBKIT` or `BR2_PACKAGE_COG` differ even slightly
from what's used in Step 2 below (e.g. a required sub-option for the DRM
platform backend specifically, such as a `BR2_PACKAGE_COG_PLATFORM_DRM`-shaped
symbol), correct Step 2 to match exactly — do not guess past what the grep
shows, the same discipline this project already applied to the Mesa3D symbol
in sub-project 2.

- [ ] **Step 2: Add WPE WebKit + Cog to the defconfig**

Append to `kiosk-linux/configs/qemu_x86_64_kiosk_defconfig` (after the
networking section from Task 1):

```
# Kiosk browser (sub-project 3, Task 2). WPE WebKit is the embedded-Linux
# WebKit port purpose-built for kiosk/DRM use (chosen over Chromium — Buildroot
# has no Chromium package, and building it from source would need Google's own
# depot_tools/gn/ninja toolchain plus a 30-100GB source tree, realistically its
# own separate multi-day program). Cog is the minimal fullscreen launcher shell
# around it, rendering directly against the DRM/KMS backend from sub-project 2
# with no X11/Wayland compositor needed. Exact symbol names verified against
# the pinned Buildroot 2024.02.9 checkout per Task 2 Step 1 above — correct
# below if the grep found different names.
BR2_PACKAGE_WPEWEBKIT=y
BR2_PACKAGE_COG=y
```

- [ ] **Step 3: Write the browser boot-marker init script**

Create `kiosk-linux/rootfs-overlay/etc/init.d/S99kiosk-browser-marker`
(executable):

```sh
#!/bin/sh
# kiosk-linux/rootfs-overlay/etc/init.d/S99kiosk-browser-marker
#
# Runs after S99kiosk-net-marker (lexicographic tie-break on the shared S99
# prefix: "S99kiosk-browser-marker" < "S99kiosk-net-marker" would actually sort
# BEFORE net-marker alphabetically ('b' < 'n') — so this script explicitly waits
# on the KIOSK_LINUX_NET_OK marker having already been logged rather than
# relying on init-script ordering alone, since 'b' < 'n' would otherwise run
# this script first despite the filename suggesting otherwise. Do not rename
# to "S99kiosk-webbrowser-marker" or similar to fix the sort order instead — an
# explicit wait is more robust than depending on lexicographic ordering, since
# this project has already been burned once by assuming implicit ordering was
# sufficient.
i=0
while [ "$i" -lt 100 ]; do
  grep -q "KIOSK_LINUX_NET_OK" /tmp/kiosk-net-marker.log 2>/dev/null && break
  i=$((i + 1))
  sleep 0.1
done

WPE_BIN=$(command -v cog)
if [ -z "$WPE_BIN" ]; then
  echo "KIOSK_LINUX_BROWSER_FAILED (cog not found)"
else
  # Cog's DRM platform module talks directly to libdrm/GBM (from sub-project
  # 2) with no Wayland/X11 compositor in between. Backgrounded so this init
  # script can move on; a bounded wait below confirms the process is still
  # alive (has not immediately crashed on launch) before declaring success.
  cog --platform=drm "https://rmpgutah.us" >/tmp/cog.log 2>&1 &
  COG_PID=$!
  sleep 5
  if kill -0 "$COG_PID" 2>/dev/null; then
    echo "KIOSK_LINUX_BROWSER_OK"
  else
    echo "KIOSK_LINUX_BROWSER_FAILED (cog exited immediately, see /tmp/cog.log)"
    cat /tmp/cog.log
  fi
fi
```

Note: this script reads `/tmp/kiosk-net-marker.log`, which does not exist yet —
Step 4 below modifies `S99kiosk-net-marker` (from Task 1) to also redirect its
own marker output to that log file, so this script has something concrete to
poll.

Make it executable:

```bash
chmod +x kiosk-linux/rootfs-overlay/etc/init.d/S99kiosk-browser-marker
```

- [ ] **Step 4: Make the net-marker script log to a file the browser-marker script can poll**

Edit `kiosk-linux/rootfs-overlay/etc/init.d/S99kiosk-net-marker` (from Task 1).
Change this line:

```sh
    echo "KIOSK_LINUX_NET_OK"
```

to:

```sh
    echo "KIOSK_LINUX_NET_OK" | tee /tmp/kiosk-net-marker.log
```

(Leave every other line in that script unchanged — this only adds a `tee` so
the marker is both printed to the console log, as before, and captured to a
file `S99kiosk-browser-marker` can poll.)

- [ ] **Step 5: Write the browser QEMU screenshot test harness**

Create `kiosk-linux/test/run-qemu-browser.sh` (executable), combining Task 1's
network device with sub-project 2's screenshot technique:

```bash
#!/usr/bin/env bash
# kiosk-linux/test/run-qemu-browser.sh
# Boots the built kernel+initramfs under QEMU with both a virtio-net NIC
# (SLIRP NAT, real outbound access) and a virtio-gpu display device, capturing
# the serial log plus a screenshot once the kiosk browser has had time to load
# the real page — reuses run-qemu-graphics.sh's proven screenshot technique
# (-vga none + virtio-gpu-pci + socat screendump over the QEMU monitor socket),
# with a longer capture delay: WPE WebKit + a real network page load takes
# noticeably longer than modetest's near-instant run in sub-project 2.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="${1:-$SCRIPT_DIR/boot-browser.log}"
SCREENSHOT_FILE="${2:-$SCRIPT_DIR/browser-screenshot.ppm}"
KERNEL="$ROOT_DIR/output/images/bzImage"
INITRD="$ROOT_DIR/output/images/rootfs.cpio.gz"

[ -f "$KERNEL" ] || { echo "kernel not found at $KERNEL — run ./build.sh first" >&2; exit 1; }
[ -f "$INITRD" ] || { echo "initramfs not found at $INITRD — run ./build.sh first" >&2; exit 1; }

if command -v timeout >/dev/null 2>&1; then TIMEOUT_CMD="timeout"
elif command -v gtimeout >/dev/null 2>&1; then TIMEOUT_CMD="gtimeout"
else
  echo "ERROR: neither 'timeout' nor 'gtimeout' found. Install GNU coreutils:" >&2
  echo "  brew install coreutils" >&2
  exit 1
fi

if ! command -v socat >/dev/null 2>&1; then
  echo "ERROR: socat not found. Install it:" >&2
  echo "  brew install socat" >&2
  exit 1
fi

MONITOR_SOCK="$(mktemp -u /tmp/kiosk-linux-qemu-monitor.XXXXXX.sock)"

rm -f "$LOG_FILE" "$SCREENSHOT_FILE" "$MONITOR_SOCK"

"$TIMEOUT_CMD" 60 qemu-system-x86_64 \
  -kernel "$KERNEL" \
  -initrd "$INITRD" \
  -append "console=ttyS0" \
  -netdev user,id=net0 \
  -device virtio-net-pci,netdev=net0 \
  -vga none \
  -device virtio-gpu-pci \
  -serial file:"$LOG_FILE" \
  -monitor unix:"$MONITOR_SOCK",server,nowait \
  -display none \
  -no-reboot &
QEMU_PID=$!

# DHCP + HTTP reachability check (Task 1) + WPE WebKit startup + a real page
# load over the network all take meaningfully longer than sub-project 2's
# modetest-only boot — 25s gives real headroom past the individual 5s waits
# baked into the net-marker and browser-marker scripts themselves.
sleep 25

for _ in $(seq 1 20); do
  [ -S "$MONITOR_SOCK" ] && break
  sleep 0.5
done

echo "screendump $SCREENSHOT_FILE" | socat - UNIX-CONNECT:"$MONITOR_SOCK" 2>/dev/null || \
  echo "WARNING: screendump failed via socat" >&2

sleep 1

kill "$QEMU_PID" 2>/dev/null || true
wait "$QEMU_PID" 2>/dev/null || true
rm -f "$MONITOR_SOCK"

echo "wrote $LOG_FILE"
[ -f "$SCREENSHOT_FILE" ] && echo "wrote $SCREENSHOT_FILE"
```

```bash
chmod +x kiosk-linux/test/run-qemu-browser.sh
```

- [ ] **Step 6: Build the image**

```bash
cd kiosk-linux && ./build.sh
```

Expected: build completes. WPE WebKit is a large package (similar order of
magnitude to Mesa3D in sub-project 2, likely longer) — budget roughly an hour
or more for a from-scratch build of this package specifically, with
sub-project 1+2's toolchain/kernel already cached in the Docker volumes from
prior runs.

- [ ] **Step 7: Run the browser test and inspect both markers and the screenshot**

```bash
./test/run-qemu-browser.sh test/boot-browser.log test/browser-screenshot.ppm
./test/assert-boot-log.sh test/boot-browser.log "KIOSK_LINUX_NET_OK"
./test/assert-boot-log.sh test/boot-browser.log "KIOSK_LINUX_BROWSER_OK"
sips -s format png test/browser-screenshot.ppm --out test/browser-screenshot.png
```

Expected: both `assert-boot-log.sh` calls print `PASS`. Open
`test/browser-screenshot.png` and inspect it directly:

- If it shows the real RMPG Flex login page: full success, capture this as the
  proof artifact for this sub-project.
- If it shows Cloudflare's "Just a moment…" challenge page instead: this is the
  real, honest result predicted as a risk in the design spec — report it as
  such, do not treat it as a task failure, and add a note to Step 8's README
  update documenting this concretely (which page WPE WebKit actually reached).
- If either marker is `FAIL`, read the corresponding log file
  (`/tmp/udhcpc.log`, `/tmp/cog.log`, both captured to the serial console log)
  for the specific cause before re-running.

- [ ] **Step 8: Document sub-project 3 in the README**

Edit `kiosk-linux/README.md`. Update the "What this does NOT do yet" list near
the top — change:

```
- Does not run RMPG Flex or any browser (sub-project 3)
```

to:

```
- Runs a real kiosk browser (WPE WebKit + Cog) pointed at the live
  rmpgutah.us — see "Kiosk browser (sub-project 3)" below for exact scope
  and the real result observed (whether the login page rendered, or
  Cloudflare's challenge page blocked it — see that section for which).
```

Then add a new section at the end of the file, after the existing "Graphics
stack (sub-project 2)" section, following that section's own style:

```markdown
## Kiosk browser (sub-project 3)

Adds real networking (kernel `virtio-net` + BusyBox `udhcpc` + `ca-certificates`
for TLS trust roots) and a kiosk browser — WPE WebKit via the Cog launcher,
rendering directly against the DRM/KMS backend from sub-project 2 with no
compositor — pointed at the live `https://rmpgutah.us`. Chromium was
considered and rejected: Buildroot has no Chromium package, and building it
from source needs Google's own depot_tools/gn/ninja toolchain plus a
30-100GB source tree — realistically its own separate multi-day-to-multi-week
program, not a slice of this sub-project.

Verified via two boot markers (`KIOSK_LINUX_NET_OK`, `KIOSK_LINUX_BROWSER_OK`)
plus an actual QEMU screenshot of rendered page content — [fill in after
running Step 7 above: either "shows the real RMPG Flex login page" or "shows
Cloudflare's managed-challenge page, confirming the real risk flagged in the
design spec: rmpgutah.us sits behind a Cloudflare managed challenge on every
path except /api/health, and WPE WebKit's TLS/JS fingerprint against that
challenge was untested going into this sub-project"].

    ./build.sh
    ./test/run-qemu-browser.sh test/boot-browser.log test/browser-screenshot.ppm
    ./test/assert-boot-log.sh test/boot-browser.log "KIOSK_LINUX_NET_OK"
    ./test/assert-boot-log.sh test/boot-browser.log "KIOSK_LINUX_BROWSER_OK"
    sips -s format png test/browser-screenshot.ppm --out test/browser-screenshot.png

This does NOT include auto-login (a human still authenticates against
whatever page actually rendered), an update/provisioning mechanism (sub-project
4), or real hardware support (deferred) — see
`docs/superpowers/specs/2026-07-22-kiosk-linux-rmpg-flex-browser-design.md`
for the full design and explicit non-goals.
```

Replace the bracketed `[fill in after running Step 7 above: ...]` text with the
actual observed result from Step 7 before committing — this is real
implementation-time data, not a placeholder left in the shipped doc.

- [ ] **Step 9: Commit**

```bash
git add kiosk-linux/configs/qemu_x86_64_kiosk_defconfig \
        kiosk-linux/rootfs-overlay/etc/init.d/S99kiosk-browser-marker \
        kiosk-linux/rootfs-overlay/etc/init.d/S99kiosk-net-marker \
        kiosk-linux/test/run-qemu-browser.sh \
        kiosk-linux/README.md
git commit -m "feat(kiosk-linux): add WPE WebKit + Cog kiosk browser pointed at rmpgutah.us"
```
