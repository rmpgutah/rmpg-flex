# FZ-55 SOF audio — design

**Date:** 2026-07-25 · **Status:** approved, not yet implemented
**Decision:** diagnose before building. Do not enable SOF speculatively.

Related:
- [`docs/fz55-third-party-build-dependencies.md`](../../fz55-third-party-build-dependencies.md) §8 — where this item was first flagged as blocked
- [`kiosk-linux/configs/kernel-audio.fragment`](../../../kiosk-linux/configs/kernel-audio.fragment) — the legacy-HDA audio config this would change

---

## 1. Problem

RMPG Flex has real audio dependencies on the FZ-55: radio PTT, panic voice, and console
alerts. The current build configures legacy Intel HD Audio only
(`snd_hda_intel` + `snd_hda_codec_realtek`). The open question is whether that is enough,
and specifically whether the FZ-55's **integrated dual-array microphone** is reachable.

If the mic array is a set of digital microphones (DMIC) wired to the PCH audio DSP rather
than to the Realtek codec, then legacy HDA cannot see it at any gain setting, and only the
Sound Open Firmware (SOF) stack can. Speakers would work; capture would not. For a patrol
terminal doing voice, silent capture is a functional failure, not a cosmetic one.

## 2. Why this is a trade, not an addition

This is the constraint that drives the whole design.

`sound/hda/intel-dsp-config.c` in the pinned 6.6.63 kernel selects between legacy HDA and
SOF from a table. The Tiger Lake and Alder Lake entries are **compile-gated**:

```c
/* Tigerlake */
#if IS_ENABLED(CONFIG_SND_SOC_SOF_TIGERLAKE)          /* line 360 */
    { .flags = FLAG_SOF | FLAG_SOF_ONLY_IF_DMIC_OR_SOUNDWIRE,
      .device = PCI_DEVICE_ID_INTEL_HDA_TGL_LP },
#endif
/* Alderlake */
#if IS_ENABLED(CONFIG_SND_SOC_SOF_ALDERLAKE)          /* line 408 */
    ...
```

Consequences, in both directions:

- **SOF not built (today).** The entries do not exist, the lookup falls through, and every
  FZ-55 generation uses legacy HDA. Speakers work. DMICs, if present, are invisible.
- **SOF built.** Any unit whose NHLT ACPI table declares DMIC or SoundWire *stops using
  legacy HDA* and requires SOF firmware and a matching topology. If either is absent or
  mismatched, the machine has **no audio at all** — it does not fall back.

So enabling SOF is a switch, not a supplement. The downside case converts working speakers
into silence.

## 3. Evidence on whether SOF is actually needed

Leaning **no**, but not conclusive:

| Evidence | Direction |
| --- | --- |
| Panasonic's factory driver inventory for the mk3 ships a plain Realtek "Sound Driver" and **no Intel SST / SOF / AVS package at all** | Suggests codec-attached analog mics — SOF unnecessary |
| Panasonic ships "Waves MaxxAudio" and "Realtek Audio Console" as Store apps on top of that one driver | Consistent with a pure HDA-codec path |
| The mk3 datasheet advertises "integrated dual-array mic w/ AI noise reduction" | Neutral — "AI noise reduction" is satisfied by Waves in software or the GNA, not necessarily a DSP mic path |
| Intel U/P-series platforms of this era *commonly* wire array mics to the PCH DSP | Suggests SOF may be needed |

The disagreement is exactly why this is decided by measurement rather than by argument.

## 4. Decision

**Diagnose first, build once.** Change nothing in the image now. Make the question cheaply
answerable on the first real unit, and keep the SOF package fully specified so that, if the
answer requires it, it is one confident build cycle rather than an exploration.

Two alternatives were considered and rejected:

- **Ship the firmware now, leave the kernel switch off.** Rejected as strictly dominated.
  Enabling SOF requires `CONFIG_SND_SOC_SOF_*=y`, which is a compile-time change and forces
  a kernel reconfigure and rebuild regardless. Pre-staging 5.2 MB of blobs that nothing
  loads therefore saves no time later, and it costs RAM on every terminal — root is an
  initramfs, so image size is resident memory. Pre-staging is real preparation only when
  the switch is a runtime one.
- **Enable SOF now and accept the risk.** Rejected: unverifiable without hardware, and the
  failure mode is total loss of audio rather than degraded audio.

## 5. The diagnostic

Added to the first-article checklist. On the first FZ-55 that boots this OS, run:

```sh
# 1. Does a capture device exist at all under legacy HDA?
arecord -l

# 2. Does the platform declare digital mics? A non-empty NHLT table is the
#    condition FLAG_SOF_ONLY_IF_DMIC_OR_SOUNDWIRE tests.
ls -l /sys/firmware/acpi/tables/NHLT 2>/dev/null && echo "NHLT present"

# 3. What did the arbitration actually choose, and what codec attached?
dmesg | grep -iE "snd_hda_intel|sof|dsp_driver|hdaudio"
cat /proc/asound/cards
```

Interpretation:

| Result | Meaning | Action |
| --- | --- | --- |
| `arecord -l` lists a capture device and it records usable audio | Mics are codec-attached | **Close this item.** SOF is not needed; do not enable it |
| No NHLT table | No digital mics | **Close this item** |
| NHLT present **and** no working capture device | DMIC array behind the PCH DSP | Execute section 6 |

Note that (1) is authoritative on its own: if capture works under legacy HDA, nothing about
SOF can improve it enough to justify the risk in section 2.

## 6. What gets built, only if the diagnostic says DMIC

### 6.1 Firmware package

Buildroot 2024.02.9 has **no `sof-bin` package** (verified against the pinned checkout), and
Intel SOF firmware is **not** in `linux-firmware-20240115` — that tarball's `intel/`
contains only `avs/`, `catpt/`, `ice/` and `vsc/`. The blobs come from the separate
`thesofproject/sof-bin` project.

- **Version:** `v2023.12.1` (5.2 MB), chosen as contemporaneous with the pinned 6.6.63
  kernel. SOF firmware and the kernel share an ABI; pairing a much newer release with an
  older kernel is the main compatibility hazard, so track the kernel pin, not "latest".
- **New package:** `kiosk-linux/package/sof-firmware/`, following the existing
  `rmpg-shell` pattern — `build.sh` copies the package definition into the Buildroot tree
  and registers it in `package/Config.in`.
- **Install only what the FZ-55 can use**, not the whole tarball:
  - `intel/sof/sof-tgl.ri` — mk2 (Tiger Lake-UP3)
  - `intel/sof/sof-adl.ri` and `intel/sof/sof-rpl.ri` — mk3 (Raptor Lake-P; both IDs exist
    in `sound/soc/sof/intel/pci-tgl.c` and which one binds is not determinable without the
    unit)
  - the matching `intel/sof-tplg/*.tplg` topologies
  - mk1 (Whiskey Lake) is out of scope — it predates the SOF-gated table entries and stays
    on legacy HDA unconditionally

### 6.2 Kernel configuration

Added to `kiosk-linux/configs/kernel-audio.fragment`. All verified to exist in 6.6.63:

```
CONFIG_SND_SOC_SOF_PCI=y
CONFIG_SND_SOC_SOF_INTEL_TOPLEVEL=y
CONFIG_SND_SOC_SOF_HDA_COMMON=y
CONFIG_SND_SOC_SOF_HDA_LINK=y
CONFIG_SND_SOC_SOF_HDA_AUDIO_CODEC=y
CONFIG_SND_SOC_SOF_TIGERLAKE=y
CONFIG_SND_SOC_SOF_ALDERLAKE=y
CONFIG_SND_SOC_INTEL_SKL_HDA_DSP_GENERIC_MACH=y
```

`SND_SOC_SOF_HDA_AUDIO_CODEC` matters specifically: it keeps the Realtek codec reachable
*through* the SOF path, so speakers survive the switch rather than being traded for mics.

### 6.3 Build gate

Extend the post-build firmware assertion in `build.sh` so that whenever
`CONFIG_SND_SOC_SOF_TIGERLAKE` or `CONFIG_SND_SOC_SOF_ALDERLAKE` is `=y`, the corresponding
`intel/sof/sof-*.ri` and at least one `intel/sof-tplg/*.tplg` must be present in the target
rootfs, and fail the build otherwise.

This is the specific protection against the section 2 failure: it makes it impossible to
ship a kernel that has switched to SOF without the firmware that switch requires. It is the
same conditional-assertion shape the existing gate uses for the i915 GuC blobs.

## 7. Failure handling and rollback

- **Rollback is a one-line revert** of the `kernel-audio.fragment` symbols plus a rebuild;
  the fragment-staleness gate guarantees the revert actually reaches the kernel.
- **A/B slots cover the field case.** If a SOF-enabled image reaches a terminal and audio is
  dead, the existing A/B boot slots roll back to the previous image without a site visit.
  The OS update must therefore be promoted through the normal staging gate, never
  auto-promoted.
- **Do not enable SOF and ship in the same cycle as unrelated changes.** If audio breaks, a
  single-variable image makes the cause unambiguous.

## 8. Verification

On hardware, after enabling:

1. `dmesg | grep -i sof` — firmware loads, no `Direct firmware load ... failed`.
2. `aplay -l` still lists the Realtek playback device (proves speakers survived the switch).
3. `arecord -l` now lists the mic array.
4. `arecord -d 5 -f cd /tmp/t.wav && aplay /tmp/t.wav` — round-trip capture is audible.
5. Radio PTT exercised end to end in the app, not just at the ALSA layer.

Failing (2) is the regression this design exists to prevent, and is an immediate revert.

## 9. Out of scope

- **mk1 SOF.** Whiskey Lake stays on legacy HDA.
- **SoundWire.** No evidence any FZ-55 SKU uses it; the same table entry covers it if a
  future unit does.
- **Waves MaxxAudio parity.** Windows-only DSP tuning with no Linux equivalent. Audio will
  be flatter; this is cosmetic and not a blocker.
- **Turning the first-article checks into a script.** Tracked separately.
