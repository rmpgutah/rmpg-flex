# Panasonic Toughbook FZ-55 — build requirements for a privately built OS

**Status:** research complete, hardware-unvalidated · **Date:** 2026-07-25
**Scope:** what Rocky Mountain Protective Group needs from Panasonic in order to build
its own OS image for the Toughbook FZ-55 fleet, rather than shipping Panasonic's
factory image.

Companion documents:
- [`kiosk-linux/README.md`](../kiosk-linux/README.md) — current private-OS build state
- [`docs/superpowers/specs/2026-07-25-rmpg-flex-desktop-os-program.md`](superpowers/specs/2026-07-25-rmpg-flex-desktop-os-program.md) — program plan
- [`kiosk-linux/configs/kernel-fz55.fragment`](../kiosk-linux/configs/kernel-fz55.fragment) — the hardware enablement this document audits

---

## 1. How this research was gathered — read before trusting any line below

**No Panasonic page was actually opened.** This session's remote execution environment
enforces a network policy that rejects all general outbound HTTPS at the agent proxy
(`gateway answered 403 to CONNECT`, confirmed against
`global-pc-support.connect.panasonic.com`, `connect.na.panasonic.com`, `na.panasonic.com`,
and a control host). Only the search tool — which runs outside this container — was
reachable.

Every Panasonic fact below therefore comes from **search-engine summaries of Panasonic's
pages**, not from the pages themselves. That is good enough to build a download checklist
and a hardware map; it is **not** good enough to treat a version number or a driver list
as authoritative.

Confidence tags used throughout:

| Tag | Meaning |
| --- | --- |
| `[P]` | Panasonic-hosted page — title and URL confirmed, page body **not** retrieved |
| `[PS]` | Panasonic-published spec sheet / PDF, content surfaced via search summary |
| `[R]` | Reseller, retail, or third-party listing — directionally right, not contractual |
| `[D]` | Derived engineering inference from confirmed silicon, not a Panasonic claim |

**Action for whoever picks this up on a networked machine:** work section 4's checklist
top to bottom, then replace the `[P]` tags with real page contents and correct anything
this document got wrong.

---

## 2. Identify the unit first — the FZ-55 is three different computers

Panasonic splits FZ-55 support strictly by model-suffix group. Downloading the wrong
group's package is the single most common failure in a Toughbook imaging project. The
suffix groups are confirmed by the names of Panasonic's own driver bundles `[P]`:

| Generation | Model suffixes | CPU family | Graphics | Wireless |
| --- | --- | --- | --- | --- |
| **mk1** | `FZ-55[A/B/C]` | 8th Gen Whiskey Lake-U (i5-8365U / i7-8665U) `[R]` | Intel UHD 620 `[R]` | 802.11ac `[R]` — part number unconfirmed |
| **mk2** | `FZ-55[D/E/F]` | 11th Gen Tiger Lake-UP3 (i5-1145G7 / i7-1185G7) `[R]` | Intel Iris Xe `[R]` | Intel Wi-Fi 6 **AX201**, Bluetooth 5.1 `[R]` |
| **mk3** | `FZ-55[G/J]` | 13th Gen Raptor Lake (i5-1345U / i7-1370P) `[R]` | Iris Xe, UHD on some SKUs `[R]` | Intel Wi-Fi 6E **AX211** `[PS]` |

Common to all three `[PS]`/`[R]`: 14-inch IPS direct-bonded display (HD 1366x768 or
FHD 1920x1080, up to 1,000 nits on FHD performance models), optional 10-point capacitive
multi-touch with glove/touch/pen/pen-touch modes, TPM 2.0, 1 Gbps Ethernet RJ-45, HDMI,
USB-A x2, USB-C, SD card slot, 3.5 mm audio in/out, 24-pin docking connector, dual
hot-swappable batteries (10.8 V, 6,500 mAh typical) reaching a claimed 40 hours combined,
MIL-STD-810H / IP53.

**Do this before anything else:** record the full model number from the label on each
unit in the fleet (e.g. `FZ-55GV300BM`) and the BIOS/EC versions. The build cannot be
correctly targeted without it, and a mixed mk1/mk2/mk3 fleet needs its hardware enablement
to be the *union* of all three, not the intersection.

---

## 3. What "build necessities" actually means here — two different projects

The phrase splits into two tracks. Section 4 covers both; sections 5–7 cover the one
Rocky Mountain Protective Group is actively building.

**Track A — a private *Windows* image.** Panasonic supports this explicitly and supplies
the parts. The governing rule found on Panasonic's deployment pages `[P]`: *"Panasonic
Enterprise CAB packages and One-Click Driver Bundles should ONLY be used for Custom build
image(s) (not to use with Panasonic Factory OEM image)."* That is a direct statement that
the One-Click Bundle is the correct input for a privately built image and must not be
layered onto the factory image.

**Track B — a private *Linux* OS.** This is what `kiosk-linux/` is. Panasonic publishes
**nothing** for it — no Linux drivers, no firmware bundles, no supported configuration.
Third-party reporting is consistent that Panasonic's support is Windows-only and that
Toughbook Linux enablement is a community effort `[R]`. Everything in track B must be
sourced from the mainline kernel, `linux-firmware`, and Panasonic's *spec sheets* used as
a hardware bill of materials. Section 6 is the gap analysis.

---

## 4. Download checklist — the Panasonic artifacts to pull

Run this from a machine with unrestricted internet. All URLs verified as existing pages
by title; contents not retrieved.

### 4.1 Per-model driver landing pages `[P]`

- Drivers index (start here, pick model + OS build):
  `https://global-pc-support.connect.panasonic.com/driver`
- FZ-55[G/J] mk3, Windows 11 24H2:
  `https://global-pc-support.connect.panasonic.com/driver/dr250205`
- Pre-installed drivers and applications list, FZ-55[G/J] mk3 / Win11 24H2 — **this is the
  authoritative component inventory**, pull it first:
  `https://global-pc-support.connect.panasonic.com/dldocs/86681`

### 4.2 One-Click Bundles — the custom-image driver payload `[P]`

| Target | URL |
| --- | --- |
| FZ-55[A/B/C] mk1 · Win11 24H2 | `https://global-pc-support.connect.panasonic.com/dldocs/086566` |
| FZ-55[D/E/F] mk2 · Win11 24H2 | `https://global-pc-support.connect.panasonic.com/dldocs/86572` |
| FZ-55[G/J] mk3 · Win11 24H2 | `https://global-pc-support.connect.panasonic.com/dldocs/086580` |
| FZ-55[G/J] mk3 · Win11 25H2 | `https://global-pc-support.connect.panasonic.com/dldocs/86795` |
| FZ-55[G/J] mk3 · Win11 23H2/22H2 | `https://global-pc-support.connect.panasonic.com/dldocs/085312` |
| FZ-55[G/J] mk3 · Win10 22H2 | `https://global-pc-support.connect.panasonic.com/dldocs/085600` |

Note: installing a One-Click Bundle also installs Panasonic PC Hub `[P]`. Decide
deliberately whether a private image should carry it.

### 4.3 Deployment tooling `[P]`

- Deployment Support Tools hub:
  `https://global-pc-support.connect.panasonic.com/driver/deployment-support-tools`
- Driver Pack:
  `https://global-pc-support.connect.panasonic.com/driver/deployment-support-tools/driver-pack`
- **Windows PE Driver Pack** — "only the necessary drivers required for OS deployment",
  imported into a Configuration Manager boot image via the Import Driver wizard:
  `https://global-pc-support.connect.panasonic.com/dldocs/85604`
- Tools for Microsoft Configuration Manager (former SCCM):
  `https://global-pc-support.connect.panasonic.com/driver/deployment-support-tools/tools`
- Panasonic PC Control Suite (BIOS configuration, driver installation, settings
  management; includes **Panasonic PC Command for PowerShell** for scripted BIOS setup,
  and **PC Hub** as the fleet dashboard):
  `https://docs.connect.panasonic.com/pc/toughbook-deployment-tools/`
- WMI Provider GUI — read/modify BIOS settings from Windows without scripting; useful for
  auditing a fleet's firmware config before imaging `[P]`

### 4.4 Firmware and cellular `[P]`

- BIOS / EC / firmware download notice (the index Panasonic updates when firmware moves):
  `https://global-pc-support.connect.panasonic.com/info/in250624`
- Cellular (WWAN) drivers:
  `https://connect.na.panasonic.com/toughbook/support/cellular-wwan-drivers`
- Sierra Wireless EM7455 driver package + DevUp service, covering `FZ-55[A/B/C]` and
  `FZ-55[D/E/F]`: `https://global-pc-support.connect.panasonic.com/dldocs/82238`
- FZ-55 mk3 5G module (EM9190) setup:
  `https://global-pc-support.connect.panasonic.com/driver/fz-55mk3-5g-module`

### 4.5 Reference documentation `[PS]`

- FZ-55 mk3 spec sheet:
  `https://ap.connect.panasonic.com/sites/default/files/media/document/2024-08/FZ-55_MK3_1721383393.3409_2.pdf`
- TOUGHBOOK 55 mk3 (EU edition, Nov 2025):
  `https://eu.connect.panasonic.com/sites/default/files/media/document/2025-11/TOUGHBOOK%2055%20mk3%20English.pdf`
- TOUGHBOOK 55 mk2 spec sheet:
  `https://na.panasonic.com/ns/289104_55mk2_8-21b_11573_TOUGHBOOK__55mk2_SpecSheet_070721.pdf`
- Operating instructions / reference manuals index (third-party mirror of Panasonic docs):
  `https://help.toughoutlet.com/article/795-toughbook-fz-55-specification-sheets-operating-instructions`

Panasonic's North America support line for anything the site doesn't surface:
1-800-LAPTOP-5.

---

## 5. Hardware bill of materials for the private Linux build

This is the FZ-55 restated as "what the kernel must drive". Silicon identifications marked
`[D]` are inferred from the confirmed CPU generation and are the ones most worth checking
with `lspci -nn` / `lsusb` on a real unit before trusting.

| Subsystem | Part | Linux driver | In our build? |
| --- | --- | --- | --- |
| Graphics | UHD 620 (mk1) / Iris Xe (mk2, mk3) `[R]` | `i915` + Mesa `iris` | ✅ `kernel-fz55.fragment` |
| Display backlight | Intel eDP panel `[D]` | `i915` backlight, `acpi_video` | ⚠️ untested |
| Touchscreen | 10-point capacitive digitizer `[PS]`; HID-over-I²C on Intel LPSS `[D]` | `i2c-hid-acpi` + `intel-lpss` + `hid-multitouch` | ⚠️ **`hid-multitouch` yes, I²C-HID transport missing** |
| Wired NIC | 1 Gbps Ethernet `[PS]`; Intel I219-LM class `[D]` | `e1000e` | ✅ (part number unverified) |
| Wi-Fi | AC 9560 (mk1, assumed) / AX201 (mk2) / AX211 (mk3) `[PS]`/`[R]` | `iwlwifi` + `iwlmvm` + blobs | ✅ `kernel-wifi.fragment` |
| Bluetooth | Intel, BT 5.1 `[R]` | `btintel` + `btusb` | ❌ not enabled |
| Storage | NVMe PCIe SSD, many SKUs **OPAL** self-encrypting `[R]` | `nvme` | ✅ (see OPAL note, §8) |
| 2nd storage | Universal Bay SSD xPAK `[R]` | `nvme` / `ahci` | ✅ |
| Audio | Waves MaxxAudio + tetra-array mic `[PS]`; Intel SST/HDA `[D]` | mk1 `snd-hda-intel`; mk2/mk3 need **SOF** (`sof-tgl.ri` / `sof-rpl.ri`) | ❌ no audio at all |
| SD reader | SD / microSDXC slot `[PS]` (slot type inconsistent across sources) | `sdhci-pci` | ❌ |
| USB | 2x USB-A 3.1 Gen1, 1x USB-C `[PS]` | `xhci` | ✅ |
| Batteries | Dual hot-swap, 10.8 V 6,500 mAh `[PS]` | ACPI battery, `CONFIG_ACPI_BATTERY` | ❌ **no gauge — a fielded requirement** |
| Thermals | Intel DPTF / ACPI thermal `[D]` | `CONFIG_ACPI_THERMAL`, `intel_powerclamp` | ❌ |
| Hotkeys | Panasonic ACPI hotkey interface `[D]` | `panasonic-laptop` (`drivers/platform/x86/`) — documented for Let's Note, which Toughbook is the export name of `[R]` | ❌ |
| TPM | TPM 2.0 `[PS]` | `tpm_crb` / `tpm_tis` | ❌ |
| WWAN | Sierra EM7455/EM7511 (mk1/mk2), EM9190 5G xPAK (mk3 only) `[P]`/`[R]` | `cdc_mbim` / `mhi_net` + ModemManager | ❌ |
| GPS | Dedicated GPS option on some SKUs `[R]`; also via WWAN module | `gnss` / NMEA over serial | ❌ |
| Webcam | IR webcam (Windows Hello capable) `[R]` | `uvcvideo` | ❌ |
| xPAK front/rear | fingerprint, smartcard (insertable + contactless), barcode, VGA, serial, 2nd LAN, DVD/Blu-ray `[R]` | varies — mostly USB-attached internally | ❌ |

### xPAK catalog (confirmed part numbers) `[R]`

- **Rear:** VGA+Serial+USB-A `FZ-VCN551W` · VGA+Serial+LAN `FZ-VCN552W` ·
  VGA+Serial+Fischer USB `FZ-VCN553W`
- **Front:** Fingerprint `FZ-VFP551W` · Contactless smartcard `FZ-VNF551W` ·
  Insertable smartcard `FZ-VSC551W`
- **Universal Bay / left:** Barcode `FZ-VBR551M` · Insertable smartcard `FZ-VSC552W` ·
  Blu-ray `FZ-VBD551W` · DVD `FZ-VDM551W` · 512 GB OPAL 2nd SSD `FZ-VSD55151W` ·
  1 TB OPAL 2nd SSD `FZ-VSD551T1W`
- Spare standard battery: `FZ-VZSU1HU`

The 5G EM9190 xPAK is **mk3-only**, adds roughly 2.1 inches to the width, cannot pass
through cellular, and **disables the embedded 4G modem once installed** `[R]` — a real
constraint if any unit is already provisioned on LTE.

---

## 6. Gap analysis against `kernel-fz55.fragment`

The current fragment covers i915, e1000e, NVMe/AHCI/SCSI, xHCI/USB-storage/HID/multitouch,
and VFAT. Against section 5 that leaves the following genuinely missing. Nothing here has
been compiled or booted — this is a review finding, not a tested change.

**Blocking for a usable field terminal:**

1. **Touchscreen transport.** `CONFIG_HID_MULTITOUCH` is enabled but nothing carries the
   HID reports. A modern Intel laptop digitizer is HID-over-I²C behind the LPSS controller,
   which needs `CONFIG_I2C_HID_ACPI`, `CONFIG_I2C_DESIGNWARE_PLATFORM`, and
   `CONFIG_MFD_INTEL_LPSS_PCI`/`_ACPI`. Without these the touchscreen is inert, and the
   kiosk has no keyboard by design. `[D]`
2. **Battery gauge.** `CONFIG_ACPI_BATTERY` and `CONFIG_ACPI_AC` are absent, so the
   taskbar has nothing to read and the OTA agent's "refuse to update on low battery" rule
   in the program plan cannot be implemented. Dual hot-swap batteries enumerate as two
   ACPI battery devices. `[D]`
3. **Bluetooth.** `btusb` + `btintel` are absent. Not needed for the browser kiosk; needed
   the moment any peripheral pairs.

**Important but not blocking:**

4. **Audio** — mk2/mk3 need the SOF stack plus Intel-signed firmware (`sof-tgl.ri`,
   `sof-rpl.ri`). Community-signed firmware is not an option on PCI devices; the blobs must
   come from `linux-firmware`. mk1 (Whiskey Lake) works with legacy `snd-hda-intel`. `[D]`
5. **Thermal management** — no ACPI thermal zone support means no passive throttling. In a
   vehicle in a Salt Lake City summer that is a real reliability concern, not a nicety.
6. **`panasonic-laptop`** — brightness and hotkeys. Documented against Let's Note models
   with Toughbook named as the export equivalent; FZ-55 support is **not** confirmed
   upstream. Cheap to enable, must be validated on hardware. `[R]`
7. **TPM** — `tpm_crb`. Required if disk encryption is ever sealed to the platform.
8. **SD reader** (`sdhci-pci`), **webcam** (`uvcvideo`), **GNSS**, **WWAN** — enable when
   the corresponding feature is actually scheduled.

**Firmware blobs to add to the image** beyond the 32 iwlwifi files already carried:
`intel/sof/sof-tgl.ri` + `sof-rpl.ri` and matching `sof-tplg/*` topologies (audio);
`i915/*_dmc_*.bin` (display power management — i915 modesets without it but loses DC
states and burns battery); `intel/ibt-*` (Bluetooth). `[D]`

**Wired-NIC caveat.** The fragment asserts `e1000e`. The spec sheets only say "1 Gbps
Ethernet" — no controller part number was recoverable from any Panasonic source. `e1000e`
is the right guess for an Intel I219-LM PCH NIC, but adding `CONFIG_IGC` (I225/I226) and
`CONFIG_R8169` costs a few kilobytes and removes an entire class of "boots but no network"
first-article failure. Confirm with `lspci -nn | grep -i ethernet` on a real unit.

---

## 7. Boot and firmware prerequisites

- **UEFI vs CSM.** `kiosk-linux` is currently legacy/CSM boot only, and its README already
  flags that some late FZ-55 firmware revisions have removed CSM. Confirmed adjacent fact
  from Panasonic BIOS behavior: **changing "Set CSM Support" fails while "Secure Boot" is
  enabled** `[R]` — so the order is disable Secure Boot, then change CSM, not the reverse.
  This makes the planned UEFI-native boot path a prerequisite for fleet rollout, not a
  nice-to-have.
- **BIOS entry:** hold or repeatedly tap **F2** at power-on (F11 for the boot menu) `[R]`.
- **BIOS passwords:** Toughbooks are frequently shipped to agencies with a supervisor
  password set. If these units came through a reseller or another agency, budget time for
  this — a locked BIOS blocks boot-order changes entirely.
- **Fleet-wide BIOS config** should be scripted with Panasonic PC Command for PowerShell
  or audited with WMI Provider GUI rather than touched by hand per unit `[P]`.
- **OPAL SSDs.** Many FZ-55 SKUs ship self-encrypting OPAL drives `[R]`. Imaging a locked
  OPAL drive fails in confusing ways; establish whether the drives are in a managed state
  before writing any image.

---

## 8. Lifecycle risk — act on this

**The FZ-55 mk3 has an EOL notice with final orders on September 30, 2026, and Panasonic's
named replacement is the Toughbook 56, with existing peripherals stated as backward
compatible** `[R]`.

Two consequences for this program:

1. Any additional FZ-55 units Rocky Mountain Protective Group intends to field should be
   ordered before that date, or the fleet will end up split across FZ-55 and Toughbook 56
   hardware with different silicon.
2. The private OS build should not hard-code FZ-55 assumptions where avoiding it is cheap.
   The existing fragment's "purely additive, same image boots under QEMU and on hardware"
   discipline is exactly right and should extend to the Toughbook 56 when its silicon is
   known.

Verify the EOL date directly with Panasonic sales before making a purchasing decision —
this came from a reseller page, not a Panasonic notice `[R]`.

---

## 9. Open questions requiring a physical unit

Nothing below can be resolved from documentation. These are the first-article checks.

1. Exact model suffix, BIOS version, and EC version of the units on hand.
2. `lspci -nn` and `lsusb` dumps — settles the Ethernet controller, the Wi-Fi part, the
   audio controller, and the touchscreen transport in one pass.
3. Whether CSM exists in the installed firmware revision.
4. Whether the BIOS is password-locked.
5. Whether the SSD is OPAL and in a locked state.
6. Whether `panasonic-laptop` binds at all on an FZ-55.
7. Whether both batteries enumerate independently and survive a hot swap under Linux.
8. Which digitizer touch mode (glove / touch / pen / pen-touch) the firmware defaults to,
   and whether it is settable outside Windows.

---

## Sources

Panasonic-hosted (titles/URLs confirmed by search; page bodies not retrieved from this
environment):

- [TOUGHBOOK Support — Drivers index](https://global-pc-support.connect.panasonic.com/driver)
- [FZ-55[G/J] (mk3) Windows 11 24H2](https://global-pc-support.connect.panasonic.com/driver/dr250205)
- [Pre-installed Drivers and Applications: FZ-55[G/J] (mk3) Win11 24H2](https://global-pc-support.connect.panasonic.com/dldocs/86681)
- [One-Click Bundle FZ-55[A/B/C] mk1 Win11 24H2](https://global-pc-support.connect.panasonic.com/dldocs/086566)
- [One-Click Bundle FZ-55[D/E/F] mk2 Win11 24H2](https://global-pc-support.connect.panasonic.com/dldocs/86572)
- [One-Click Bundle FZ-55[G/J] mk3 Win11 24H2](https://global-pc-support.connect.panasonic.com/dldocs/086580)
- [One-Click Bundle FZ-55[G/J] mk3 Win11 25H2](https://global-pc-support.connect.panasonic.com/dldocs/86795)
- [One-Click Bundle FZ-55[G/J] mk3 Win11 23H2/22H2](https://global-pc-support.connect.panasonic.com/dldocs/085312)
- [One-Click Bundle FZ-55[G/J] mk3 Win10 22H2](https://global-pc-support.connect.panasonic.com/dldocs/085600)
- [Deployment Support Tools](https://global-pc-support.connect.panasonic.com/driver/deployment-support-tools)
- [Driver Pack](https://global-pc-support.connect.panasonic.com/driver/deployment-support-tools/driver-pack)
- [Windows PE Driver Pack](https://global-pc-support.connect.panasonic.com/dldocs/85604)
- [Tools for Microsoft Configuration Manager](https://global-pc-support.connect.panasonic.com/driver/deployment-support-tools/tools)
- [Panasonic PC Control Suite](https://docs.connect.panasonic.com/pc/toughbook-deployment-tools/)
- [Driver/BIOS/EC/firmware download information update](https://global-pc-support.connect.panasonic.com/info/in250624)
- [Sierra Wireless EM7455 driver package (incl. FZ-55[A/B/C], FZ-55[D/E/F])](https://global-pc-support.connect.panasonic.com/dldocs/82238)
- [FZ-55 mk3 5G Module (EM9190) setup](https://global-pc-support.connect.panasonic.com/driver/fz-55mk3-5g-module)
- [Cellular (WWAN) Drivers](https://connect.na.panasonic.com/toughbook/support/cellular-wwan-drivers)
- [TOUGHBOOK Software](https://connect.na.panasonic.com/toughbook/support/software)
- [TOUGHBOOK Support Center](https://connect.na.panasonic.com/toughbook/support)
- [FZ-55 mk3 spec sheet (PDF)](https://ap.connect.panasonic.com/sites/default/files/media/document/2024-08/FZ-55_MK3_1721383393.3409_2.pdf)
- [TOUGHBOOK 55 mk3 EU spec sheet (PDF)](https://eu.connect.panasonic.com/sites/default/files/media/document/2025-11/TOUGHBOOK%2055%20mk3%20English.pdf)
- [TOUGHBOOK 55 mk2 spec sheet (PDF)](https://na.panasonic.com/ns/289104_55mk2_8-21b_11573_TOUGHBOOK__55mk2_SpecSheet_070721.pdf)
- [TOUGHBOOK 55 FAQ (PDF)](https://na.panasonic.com/ns/273186_TOUGHBOOK_55_FAQ_2020.pdf)
- [WMI Provider GUI update notes (PDF)](https://pna-b2b-storage-mkt.s3.amazonaws.com/computer/brochure/wmi_provider_gui_readme_brochure.pdf)

Third-party (used for spec cross-checks, xPAK part numbers, EOL, and BIOS behavior):

- [Rugged PC Review — Toughbook 55 Mk3](https://www.ruggedpcreview.com/3_notebooks_panasonic_55_mk3.html)
- [Windows Central — Toughbook 55 Mk3 review](https://www.windowscentral.com/hardware/laptops/panasonic-toughbook-55-review)
- [mRugged Mobile — FZ-55 mk3 EOL](https://www.mruggedmobile.com/toughbook-fz-55-mk3-models.aspx)
- [Rugged Books — Toughbook 55 Mk3 review](https://ruggedbooks.com/blogs/articles/panasonic-toughbook-55-mk3-review)
- [Tough Outlet KB — FZ-55 spec sheets / operating instructions](https://help.toughoutlet.com/article/795-toughbook-fz-55-specification-sheets-operating-instructions)
- [Ace Computers — TOUGHBOOK 55 spec sheet 04-25 (PDF)](https://acecomputers.com/wp-content/uploads/2025/06/TOUGHBOOK-55-Spec-Sheet-04-25.pdf)
- [Sierra Wireless forum — EM7455B in Toughbook FZ-55](https://forum.sierrawireless.com/t/em7455b-in-panasonic-toughbook-fz-55/24799)
- [Bob Johnson's — navigating Panasonic support](https://www.bobjohnson.com/blog/navigating-panasonics-support-manuals-drivers-and-firmware-for-toughbooks/)

Linux platform references:

- [LKDDb — CONFIG_PANASONIC_LAPTOP](https://cateee.net/lkddb/web-lkddb/PANASONIC_LAPTOP.html)
- [torvalds/linux — drivers/platform/x86/panasonic-laptop.c](https://github.com/torvalds/linux/blob/master/drivers/platform/x86/panasonic-laptop.c)
- [SOF project — overview of Intel hardware platforms](https://thesofproject.github.io/latest/getting_started/intel_debug/introduction.html)
- [Phoronix — SOF 2.2.1, Raptor Lake preparation](https://www.phoronix.com/news/Sound-Open-Firmware-2.2.1)
- [Fredrick Brennan — GNU/Linux on the Panasonic Toughbook FZ-40](https://fredrickbrennan.medium.com/how-to-install-gnu-linux-on-the-panasonic-toughbook-fz-40-fz-40ccaabkm-with-almost-b524629ef6c8)
