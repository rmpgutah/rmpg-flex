# FZ-55 private OS — third-party software, firmware and systems manifest

**Status:** parsed and verified against real artifacts · **Date:** 2026-07-25
**Scope:** every third-party component Rocky Mountain Protective Group depends on to
build its own OS for the Panasonic Toughbook FZ-55 and have it fully operational —
host tooling, build system, kernel, binary firmware, userspace, and the artifacts
only Panasonic can supply.

Companion documents:
- [`docs/panasonic-fz55-os-build-requirements.md`](panasonic-fz55-os-build-requirements.md) — what to obtain **from Panasonic**, and the fleet/lifecycle decisions
- [`kiosk-linux/README.md`](../kiosk-linux/README.md) — the build itself

---

## 1. How this was produced, and how much to trust it

The earlier requirements document was written from search-engine summaries because that
session's network egress was blocked at the agent proxy. **This pass had working network
and a working build environment**, so almost everything here is first-hand:

| Method | What it settled |
| --- | --- |
| Fetched Panasonic's own pages | The factory component inventory (§6) — the authoritative hardware list |
| Read the pinned Buildroot 2024.02.9 tree | Every `BR2_*` symbol name and what each firmware option actually installs |
| Read the pinned Linux 6.6.63 tree | Every `CONFIG_*` symbol's existence and dependency chain |
| Read the pinned `linux-firmware-20240115` tarball | Which blobs exist upstream, and which do **not** |
| Listed the built rootfs and kernel `.config` | What the image **actually ships**, as opposed to what the config asks for |

That last row is the one that matters most, and it is the reason for §7.

Confidence tags: `[V]` verified first-hand this session · `[P]` from a Panasonic page
retrieved this session · `[D]` engineering inference, not yet hardware-validated.

---

## 2. Layer 0 — host build environment

Buildroot supports Linux hosts only, so on the Mac this is a container problem before it
is a build problem.

| Component | Version / requirement | Notes |
| --- | --- | --- |
| Colima | any current | macOS only. `brew install colima docker` `[V]` |
| Docker CLI + daemon | any current | `docker info` must succeed before `build.sh` runs |
| Build VM sizing | **≥16 GiB RAM** (24 GiB used), ~10 cores, 60 GB disk | 8 GiB OOM-kills `cc1plus` ~40 min into WebKitGTK, and the log blames the compiler, not memory |
| Container base | Ubuntu 24.04 + Buildroot's "Mandatory packages" | `kiosk-linux/docker/Dockerfile` |
| Disk-image container | separate `--platform linux/amd64` image | Ubuntu ships no arm64 `syslinux`/`extlinux` |
| Storage | **named Docker volumes**, never host bind mounts | virtiofs/9p mangles directory permissions during kernel-tarball extraction; identical failure on WSL2 via `/mnt/c` |

Windows/WSL2 works unmodified without Colima, provided the build runs inside the WSL2
filesystem rather than `/mnt/c`.

---

## 3. Layer 1 — build system and toolchain

| Component | Pin | Role |
| --- | --- | --- |
| **Buildroot** | `2024.02.9` `[V]` | Builds the cross-toolchain, kernel, and entire userspace |
| Buildroot internal toolchain | gcc + glibc, `BR2_TOOLCHAIN_BUILDROOT_CXX=y` | C++ is mandatory — WPE WebKit hard-requires `BR2_INSTALL_LIBSTDCPP` |
| **Linux kernel** | `6.6.63` `[V]` | Selected by the Buildroot pin via `BR2_LINUX_KERNEL_LATEST_VERSION` |
| Base kernel config | in-tree `x86_64_defconfig` + 7 project fragments | See §7 for the fragment-merge trap |
| syslinux / extlinux | Buildroot `BR2_TARGET_SYSLINUX` | Legacy/CSM USB boot path |
| GRUB 2 (x86_64 EFI) | Buildroot `BR2_TARGET_GRUB2` | UEFI path + the no-USB install onto an existing NTFS volume |

**Reproducibility note.** `BR2_LINUX_KERNEL_LATEST_VERSION=y` reads as a smell but is not
one: within a pinned Buildroot release, "latest" always resolves to one specific kernel.
Confirmed — this tree resolves to 6.6.63 `[V]`.

---

## 4. Layer 2 — binary firmware

This is the part of a private OS build that cannot be compiled from source, must be
redistributed under vendor licences, and fails silently when absent.

Source: `linux-firmware` **20240115**, via Buildroot's `BR2_PACKAGE_LINUX_FIRMWARE_*`
options. Each option adds a directory or glob to a tarball that is unpacked into
`/lib/firmware`.

| Blob family | Buildroot option | Needed for | State |
| --- | --- | --- | --- |
| `iwlwifi-QuZ-a0-*` | `_IWLWIFI_QUZ` | AX201 (mk2) | ✅ shipping `[V]` |
| `iwlwifi-9000/9260-*` | `_IWLWIFI_9XXX` | AC 9560 (mk1) | ✅ shipping `[V]` |
| `iwlwifi-so-a0-gf-a0-*` | `_IWLWIFI_6E` | AX210/AX211 | ✅ shipping `[V]` |
| `iwlwifi-ty-a0-gf-a0-*` | **none — `build.sh` patches `linux-firmware.mk`** | AX211 alternate host-chipset combo | ✅ shipping `[V]` |
| `iwlwifi-8265-*` | `_IWLWIFI_8265` | older stock | ✅ shipping `[V]` |
| `i915/*_dmc_*.bin` | `_I915` | Display power management, mk2/mk3 | ✅ shipping `[V]` |
| `i915/adlp_guc_*` + `*_huc_*` | `_I915` (same option) | **mk3 GPU init** — see below | ✅ **repaired this pass** — 68 GuC files, was 0 `[V]` |
| `intel/ibt-*.sfi` + `.ddc` | `_IBT` | **All Bluetooth** | ✅ **added this pass** — 38 blobs, was 0 `[V]` |
| `intel/sof/sof-{tgl,rpl}.ri` | **does not exist in Buildroot or in linux-firmware 20240115** | mk2/mk3 DSP audio, incl. the digital mic array | ⛔ see §8 |

### The two firmware defects found

**1. Intel Bluetooth firmware was never selected.** `kernel-bluetooth.fragment` asserted
that the iwlwifi blobs cover the Bluetooth side of the combo chip because it shares an
antenna and a package. They do not — the BT radio loads its own `intel/ibt-<hw>-<fw>.sfi`
and `.ddc` pair. The built rootfs had **no `/lib/firmware/intel` directory at all** `[V]`,
so `BT_INTEL` would enumerate the radio and leave it in bootloader mode: no adapter, no
error a user would see. Panasonic's own inventory corroborates the split — it ships the
Bluetooth software as a package separate from the WLAN driver `[P]`. Fixed by adding
`BR2_PACKAGE_LINUX_FIRMWARE_IBT=y`.

**2. i915 GuC/HuC blobs are missing from the rootfs, and on mk3 that is a black screen.**
`br-firmware.tar` contains all 121 `i915/` files including 67 GuC and 23 HuC, and
`output/images/i915/` received all 125 entries — but `target/lib/firmware/i915/` has only
the 30 DMC files plus 3 symlinks `[V]`. The two install paths disagree by 88 files.

That is not cosmetic on the mk3. In 6.6.63, `uc_expand_default_options()`
(`drivers/gpu/drm/i915/gt/uc/intel_uc.c`) excludes only Tiger Lake and Rocket Lake from
GuC, then falls through to `ENABLE_GUC_LOAD_HUC | ENABLE_GUC_SUBMISSION` as the default —
so an Alder Lake-P / Raptor Lake-P mk3 **turns GuC submission on by default and needs
`i915/adlp_guc_70.1.1.bin` to bring the GPU up** `[V]`. mk1 (Gen9.5) and mk2 (Tiger Lake)
are unaffected.

Because the root cause is an install/staleness divergence rather than a wrong config
value, the durable fix is the build-time assertion described in §7 — a config edit alone
would not have caught it, and did not. After the fix the rootfs carries **254 firmware
files, up from 78** `[V]`.

### The touchscreen transport was still not built — for a third reason

PR #3025 ("complete the touch input path") added `CONFIG_I2C_HID_ACPI`, correctly
identifying that #3023 had a bus and a multitouch driver with nothing between them.
Reading the **built** `.config` shows the path was still not complete, because two
further links were missing and both fail silently:

1. `I2C_DESIGNWARE_PLATFORM` `depends on (ACPI && COMMON_CLK) || !ACPI`. With `ACPI=y`
   and `COMMON_CLK` unset on x86_64, kconfig **dropped the symbol entirely** — so there
   was no I²C bus for `I2C_HID_ACPI` to attach to. `COMMON_CLK` comes for free once
   `MFD_INTEL_LPSS_{PCI,ACPI}` is enabled, which is also what makes the LPSS controllers
   enumerate in the first place.
2. `CONFIG_PINCTRL` is a `menuconfig` gate. The per-generation Intel pinctrl drivers
   cannot be selected without it, and an I²C-HID digitizer declared with an ACPI
   `GpioInt` never probes without one.

Both are fixed. This is the same lesson as the rest of §7: the fragment said "touchscreen
enabled" for three consecutive PRs while the built kernel said otherwise, and only reading
the artifact caught it.

### Licensing

`linux-firmware` blobs are redistributable but **not** under the GPL: each family carries
its own vendor licence (`LICENCE.ibt_firmware`, `LICENSE.i915`, `LICENCE.iwlwifi_firmware`),
all of which permit redistribution as part of an OS image while forbidding modification
and reverse engineering. Buildroot records `LINUX_FIRMWARE_LICENSE = Proprietary` and
collects the licence files automatically. For an OS image distributed only to RMPG-owned
fleet hardware this is unproblematic, but the licence files must travel with the image.

---

## 5. Layer 3 — third-party userspace

All from Buildroot 2024.02.9 packages; all symbol names verified against the real tree.

| Area | Packages | Purpose |
| --- | --- | --- |
| Graphics | `mesa3d` (iris, swrast, virgl Gallium; LLVM; Vulkan swrast; GLX + GLES + EGL), `libdrm` | `iris` is the FZ-55 path (pairs with kernel `i915`); virgl/swrast keep the same image booting under QEMU |
| Display server | `xorg7`, `xserver-xorg-server` (modular), `xf86-input-libinput`, `xinit`, `xrandr`, `xsetroot`, `xdpyinfo`, `libXScrnSaver` | X.Org's built-in `modesetting` driver drives both virtio-gpu and i915 |
| Window manager | `openbox` | Windows-style decorations, alt-tab, snapping |
| Widget stack | `libgtk3` (X11), `adwaita-icon-theme`, `hicolor-icon-theme`, `shared-mime-info` | Shell, file manager and browser all GTK3 |
| Browser engines | `wpewebkit` + `cog` (kiosk, DRM platform); `webkitgtk` (desktop) | Chromium is not packaged by Buildroot and would need Google's own toolchain and a 30–100 GB tree |
| TLS / HTTP | `ca-certificates`, **`glib-networking`** | `glib-networking` is load-bearing: without the GIO TLS module every HTTPS load "succeeds" in ~50 ms and paints blank white |
| Networking | `connman` (+wifi, +client), `wpa_supplicant` (+nl80211, **+EAP**, +cli), `iw`, `wireless-regdb` | EAP is required for WPA2-Enterprise municipal/LE networks |
| Audio | `alsa-lib`, `alsa-utils` (+`amixer`, +`alsactl`, +`aplay`) | Each `alsa-utils` command is its own sub-option and must be named |
| Bluetooth | `bluez5_utils` | `bluetoothd`; inert without the IBT firmware above |
| Device management | `eudev` (`BR2_ROOTFS_DEVICE_CREATION_DYNAMIC_EUDEV`) | Required by `cog`'s DRM platform via libinput |
| Power | `acpid` | Lid/power-button events; battery gauge reads `/sys/class/power_supply` directly |
| Fonts | `liberation` (Arial/Times/Courier metric-compatible), `dejavu` | WebKit aborts outright with zero fonts installed |
| Applications | `pcmanfm`, `mupdf`, `feh`, `xterm`, `htop`, `nano`, `vim`, `mc` | |
| First-party | `rmpg-shell`, `rmpg-browser` | In-repo, not third-party |

**Available but not yet enabled:** `modem-manager`, `libmbim`, `libqmi` `[V]` — the
userspace half of WWAN. The kernel side is already configured; without ModemManager a
cellular unit has device nodes but no APN/SIM/signal management.

---

## 6. Layer 4 — what only Panasonic supplies

Retrieved this session from
`https://global-pc-support.connect.panasonic.com/driver/dr250205` (FZ-55[G/J] mk3,
Win11 24H2) `[P]`. This is the authoritative statement of what silicon is in the machine.

**Panasonic publishes nothing for Linux** — no drivers, no firmware, no supported
configuration. The value of this list to a Linux build is purely as a bill of materials:
a driver on it means the hardware is present.

Components with a direct Linux consequence:

| Panasonic factory item | Silicon | Linux driver | In our build |
| --- | --- | --- | --- |
| LAN Driver for **I219** | Intel I219 PCH NIC | `e1000e` | ✅ — confirms the earlier guess |
| **PCIe LAN (Realtek) 8111/8168** | Realtek PCIe NIC | `r8169` | ✅ (from base defconfig) |
| **USB LAN (Realtek) 8153/8152** | Dock / USB-C Ethernet | `r8152` | ➕ **added this pass** |
| Intel HID Event Filter (HID EFD) | ACPI hotkey interface | `intel_hid` | ➕ **added this pass** |
| Intel Dynamic Tuning Technology (DTT) | DPTF thermal policy | `INT340X_THERMAL` | ➕ **added this pass** |
| Intel Management Engine Software | ME / HECI | `mei`, `mei_me` | ➕ **added this pass** |
| Intel Integrated Sensor Solution | ISH sensor hub | `intel_ish_hid` | ➕ **added this pass** |
| USB Serial ×2 packages | FTDI / Prolific bridges (serial + barcode xPAK) | `ftdi_sio`, `pl2303`, `cp210x` | ➕ **added this pass** |
| Intel Serial IO Driver | LPSS I²C/UART | `MFD_INTEL_LPSS_*`, `i2c-designware` | ✅ |
| Precision TouchPad placement registry | I²C-HID touchpad | `i2c_hid_acpi` + `hid-multitouch` | ✅ (now stated explicitly) |
| BayHub SD Driver | **BayHub**, not Intel PCH | `sdhci-pci` (O2Micro/BayHub quirks) | ⚠️ `[D]` — enabled, unvalidated |
| Sound Driver (Realtek) + Waves MaxxAudio | Realtek HDA codec | `snd_hda_intel` + `snd_hda_codec_realtek` | ⚠️ see §8 |
| WLAN / Bluetooth for AX211/AX201/9560/8265 | Intel combo radio | `iwlwifi` / `btusb`+`btintel` | ✅ |
| WWAN: **EM7421 (EU), EM7511 (US/CA), EM7595 (US/CA)**, **EM9190 5G** | Sierra Wireless | `cdc_mbim`/`qmi_wwan` + ModemManager | ⚠️ kernel only |
| Fingerprint FS7600 / NB-2036 | Synaptics | `libfprint` (userspace) | ❌ not built |
| DisplayLink Mirror Driver | DisplayLink dock | none in mainline | ⛔ §8 |
| Intel GNA Driver | Gaussian Neural Accelerator | none in mainline | ⛔ §8 |
| HVCI / Secure Launch, Intel TXT ACM | Windows security features | n/a | Windows-only |

**Correction to the earlier document:** it recorded the WWAN module as the Sierra EM7455
for mk1/mk2. For the mk3 Panasonic ships **EM7421 / EM7511 / EM7595** 4G variants plus the
EM9190 5G xPAK, and warns that the 5G and 4G drivers must never both be installed `[P]`.

Panasonic's deployment tooling (One-Click Bundles, WinPE Driver Pack, PC Control Suite,
Configuration Manager tools, WMI Provider GUI) applies **only to the Windows track** and
is catalogued in the companion requirements document. The one piece worth keeping for a
Linux fleet is **Panasonic PC Command for PowerShell**, since BIOS configuration is still
done from Windows.

---

## 7. What the image actually shipped — and the mechanism that hid it

Auditing the built artifacts rather than the config produced the most consequential
finding of this pass.

> **The entire 2026-07-25 FZ-55 hardware audit (PR #3023) never reached the built
> kernel.** Bluetooth, TPM, the webcam, the SD reader, USB4/Thunderbolt, WWAN and the
> Wacom pen digitizer were all committed as `=y` in the fragments and all read **"not
> set"** in the kernel `.config` the shipped `bzImage` was built from `[V]`. Symbols from
> fragments that predated the last reconfigure were correctly `=y`, which is what makes
> the pattern unmistakable.

**Mechanism.** Buildroot tracks the `.config` variable that *lists* the fragment paths.
Nothing watches the *contents* of the fragment files. Once `linux/.stamp_configured`
exists, editing a fragment changes nothing: `merge_config.sh` is never re-run, the kernel
keeps its old `.config`, and the build reports success. This is the same failure class the
project had already hit three times — for `mesa3d`/`cairo` (X11), for `ncurses` (wide
char), for `alsa-utils` (`amixer`) — and each time it was fixed by hand for that one
package. It is a structural property of incremental Buildroot builds, not a series of
coincidences.

**Fixes applied:**

1. **Fragment-content staleness gate** (`build.sh`, before the build) — hashes the
   contents of every file named by `BR2_LINUX_KERNEL_CONFIG_FRAGMENT_FILES` and
   `BR2_PACKAGE_BUSYBOX_CONFIG_FRAGMENT_FILES`, and forces `<pkg>-reconfigure` when the
   hash changes. This closes the cause.
2. **Hardware-enablement gate** (`build.sh`, after the build) — asserts 21 kernel symbols
   against the *built* `.config` and 7 firmware globs against the *target rootfs*, and
   fails the build with remediation instructions if any are absent. This closes the class:
   it catches the GuC/DMC divergence in §4, which no config check could have caught,
   because the config was already correct.

A green build has meant "nothing errored", not "the hardware works". These two gates are
what change that.

---

## 8. Requirements with no third-party source — decide, do not assume

| Item | Situation | Recommendation |
| --- | --- | --- |
| **SOF audio firmware** | The earlier doc said the `sof-tgl.ri` / `sof-rpl.ri` blobs "must come from `linux-firmware`". They are **not in linux-firmware 20240115** — that tarball's `intel/` has only `avs/`, `catpt/`, `ice/`, `vsc/` `[V]` — and Buildroot 2024.02.9 has **no `sof-bin` package** `[V]`. SOF firmware is a separate upstream project. | Panasonic ships a plain Realtek "Sound Driver" with no Intel SST/SOF package, which indicates the codec runs in **legacy HDA mode** `[P]` — so speakers and headphones should work on `snd_hda_intel` alone. The **digital mic array is the risk**: DMICs typically hang off the PCH DSP and are SOF-only. **Scoped and decided 2026-07-25:** do not enable SOF speculatively — it is a *switch*, not an addition (the TGL/ADL entries in `intel-dsp-config.c` are compile-gated, so building SOF makes any DMIC unit stop using legacy HDA and demand firmware, turning working speakers into silence if anything mismatches). Diagnose on the first unit, then build once if needed. Firmware is `thesofproject/sof-bin` v2023.12.1, not `linux-firmware`. Design: [`2026-07-25-fz55-sof-audio-design.md`](superpowers/specs/2026-07-25-fz55-sof-audio-design.md). |
| **DisplayLink docks** | No mainline driver; the out-of-tree `evdi` module is the only option | Do not buy DisplayLink docks for this fleet. Use Thunderbolt/USB-C alt-mode docks, which `USB4` + `i915` already handle. |
| **Intel GNA** | No mainline driver | Ignore — nothing in RMPG Flex uses it. |
| **Fingerprint readers** | Kernel side is generic USB; matching needs `libfprint` + a supported sensor | Only if the fingerprint xPAK is actually purchased. Synaptics FS7600 support in `libfprint` should be confirmed before buying. |
| **Waves MaxxAudio** | Windows-only DSP tuning | No Linux equivalent; audio will be flatter. Cosmetic. |
| **`panasonic-laptop`** | Already `=y` from the base defconfig; documented for Let's Note, unconfirmed on Toughbook | Harmless. `intel_hid` (now added) is the one Panasonic's inventory actually evidences. |
| **OPAL self-encrypting drives** | `BLK_SED_OPAL` added this pass | Establish whether the fleet's drives are in a managed OPAL state **before** writing any image — a locked OPAL drive fails imaging in confusing ways. |

---

## 9. Remaining gate: first-article validation

Every `[D]` above collapses in one session with a physical unit. The single highest-value
command is `lspci -nn && lsusb`, which settles the Ethernet controller, the Wi-Fi part,
the audio controller, the SD controller and the touchscreen transport at once.

Specific to this manifest, on real hardware confirm:

1. `dmesg | grep -i "firmware"` — no `Direct firmware load ... failed` lines.
2. `hciconfig`/`bluetoothctl` — the Bluetooth adapter appears (proves the IBT fix).
3. `dmesg | grep -i guc` on an **mk3** — GuC loads, GPU initialises (proves §4 defect 2).
4. **The SOF decision** (§8). Three commands settle it, and the answer determines whether a
   whole package of work is needed or can be closed:
   ```sh
   arecord -l                                    # capture device under legacy HDA?
   ls -l /sys/firmware/acpi/tables/NHLT           # does the platform declare digital mics?
   dmesg | grep -iE "snd_hda_intel|sof|hdaudio"   # which driver actually bound
   ```
   Capture works, or no NHLT table → **SOF is not needed; close the item.** NHLT present
   *and* no working capture → the mic array is behind the PCH DSP and SOF is required. Full
   reasoning and the build plan:
   [`docs/superpowers/specs/2026-07-25-fz55-sof-audio-design.md`](superpowers/specs/2026-07-25-fz55-sof-audio-design.md).
5. `cat /sys/class/power_supply/BAT*/capacity` — both hot-swap batteries report.
6. `ls /sys/class/thermal/` — INT340X zones appear, not just the ACPI critical trip.
7. Touchscreen and pen both generate events (`evtest`).

Model suffix, BIOS version and EC version of every unit in the fleet still need recording;
the build currently targets the **union** of mk1/mk2/mk3 deliberately because that mix is
unknown.
