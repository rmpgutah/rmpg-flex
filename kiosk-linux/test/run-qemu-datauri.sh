#!/usr/bin/env bash
# kiosk-linux/test/run-qemu-datauri.sh
# Diagnostic harness: boots the built disk image, logs in over the serial
# console, kills the auto-started kiosk cog instance, relaunches cog against a
# guaranteed-static colored data: URL, and captures a screenshot. This isolates
# "WebKit tile-content painting is broken" from "the remote page genuinely
# renders white" (Cloudflare challenge / JS-gated SPA).
#
# NOTE: QEMU's `-serial unix:...,server,nowait` chardev services ONE client
# connection — a first version of this script drained output on one socat
# connection and sent each command over a fresh second connection, and the
# guest never saw any input at all (empty transcript, no screenshot). All
# input AND output must flow over a single persistent socat session, driven
# by a timed subshell feeding its stdin.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="${1:-$SCRIPT_DIR/boot-datauri.log}"
SCREENSHOT_FILE="${2:-$SCRIPT_DIR/datauri-screenshot.ppm}"
DISK_IMG="$ROOT_DIR/output/images/disk.img"
# Inner quotes are percent-encoded (%22) so the whole URL survives being sent
# through the guest shell inside single quotes with no nested-quoting games.
URL="${KIOSK_TEST_URL:-data:text/html,<body style=%22background:%23336699%22><h1 style=%22color:red;font-size:120px%22>KIOSK TEST</h1><div style=%22width:400px;height:200px;background:lime%22></div></body>}"

[ -f "$DISK_IMG" ] || { echo "disk image not found at $DISK_IMG — run ./build.sh first" >&2; exit 1; }

if command -v timeout >/dev/null 2>&1; then TIMEOUT_CMD="timeout"; else TIMEOUT_CMD="gtimeout"; fi

MONITOR_SOCK="$(mktemp -u /tmp/kiosk-linux-qemu-mon.XXXXXX.sock)"
SERIAL_SOCK="$(mktemp -u /tmp/kiosk-linux-qemu-ser.XXXXXX.sock)"
rm -f "$LOG_FILE" "$SCREENSHOT_FILE" "$MONITOR_SOCK" "$SERIAL_SOCK"

"$TIMEOUT_CMD" 260 qemu-system-x86_64 \
  -drive file="$DISK_IMG",if=virtio,format=raw \
  -m 1024 \
  -netdev user,id=net0 \
  -device virtio-net-pci,netdev=net0 \
  -vga none \
  -device virtio-gpu-pci \
  -serial unix:"$SERIAL_SOCK",server,nowait \
  -monitor unix:"$MONITOR_SOCK",server,nowait \
  -display none \
  -no-reboot &
QEMU_PID=$!

# Wait for QEMU to create the serial socket before connecting.
for _ in $(seq 1 50); do [ -S "$SERIAL_SOCK" ] && break; sleep 0.2; done

# Single persistent serial session: the subshell paces the whole interaction
# on its stdin side while all guest output streams to LOG_FILE.
(
  sleep 75                                     # boot + auto browser launch settle
  printf '\r'; sleep 2                         # wake login prompt
  printf 'root\r'; sleep 4                     # buildroot root login (no password)
  printf 'killall cog 2>/dev/null; sleep 1; echo KILLED_MARKER\r'; sleep 4
  printf "export XDG_RUNTIME_DIR=/tmp/xdg-runtime; cog --platform=drm '%s' >/tmp/cog2.log 2>&1 &\r" "$URL"
  sleep 35                                     # cog start + paint time
  printf 'cat /tmp/cog2.log; pidof cog && echo COG_ALIVE || echo COG_DEAD; dmesg | grep -i -E "segfault|trap|oom|killed" | tail -5\r'; sleep 4
  # Net-probe diagnostics: S98kiosk-net-marker reports NET_FAILED even on boots
  # where the browser demonstrably reaches the site over HTTPS, so print the
  # exact exit code of each candidate probe to find one that tells the truth.
  printf 'echo PROBE_A; nc -w 5 rmpgutah.us 443 </dev/null; echo rc=$?\r'; sleep 8
  printf 'echo PROBE_B; nc -w 5 -z rmpgutah.us 443; echo rc=$?\r'; sleep 8
  printf 'echo PROBE_C; cat /etc/resolv.conf; nslookup rmpgutah.us 2>&1 | tail -4; echo rc=$?\r'; sleep 8
) | socat - UNIX-CONNECT:"$SERIAL_SOCK" > "$LOG_FILE" 2>/dev/null || true

# Screendump AFTER the serial session ends (cog is still running in the
# guest); issuing it from inside the pipeline subshell above failed to
# produce a file in a real run, while this top-level form is the same one
# run-qemu-browser.sh uses successfully.
# Keep the monitor connection open long enough for QEMU to execute the
# command, and capture the monitor's echo/error output for diagnosis.
# IMPORTANT: QEMU's monitor splits `screendump` arguments on SPACES with no
# quoting mechanism — an absolute path under this repo ("/Users/.../RMPG
# Flex/...") is parsed as filename="...RMPG" + device="Flex/..." and fails
# with "Device ... not found" (observed in a real run). Dump to a space-free
# temp path, then move it into place.
DUMP_TMP="$(mktemp -u /tmp/kiosk-linux-screendump.XXXXXX.ppm)"
(echo "screendump $DUMP_TMP"; sleep 3) | socat - UNIX-CONNECT:"$MONITOR_SOCK" > "$SCRIPT_DIR/monitor-datauri.log" 2>&1 || \
  echo "WARNING: screendump failed via socat" >&2
sleep 2
[ -s "$DUMP_TMP" ] && mv "$DUMP_TMP" "$SCREENSHOT_FILE"

kill "$QEMU_PID" 2>/dev/null || true
wait 2>/dev/null || true
rm -f "$MONITOR_SOCK" "$SERIAL_SOCK"
echo "log: $LOG_FILE"
[ -s "$SCREENSHOT_FILE" ] && echo "screenshot: $SCREENSHOT_FILE" || echo "NO SCREENSHOT CAPTURED"
