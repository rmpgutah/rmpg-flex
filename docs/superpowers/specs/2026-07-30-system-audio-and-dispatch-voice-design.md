# System Audio Redesign + Dispatch Voice — Design

**Date:** 2026-07-30
**Status:** Awaiting review
**Scope:** RMPG Flex client audio — system/UI sounds and the dispatch voice announcer

---

## 1. Problem

Two separate problems surfaced in the same conversation:

1. **System/UI sounds** (`click`, `submit`, `update`, `delete`, `login`, `error`, and the
   open/close/navigate roles) are bright detuned square-wave blips generated at clean
   44.1 kHz. They don't sound like console software, and two of the roles have no sound of
   their own at all.
2. **The dispatch voice has live defects.** The voice picker is non-functional, and the
   call-update announcement renders a malformed sentence in production today. Separately,
   the notification/alert system has no voice at all.

The second set are defects producing wrong output now. The first is a preference change to
something that already works. **This spec sequences voice first.**

---

## 2. Scope

### In scope — system sounds

| Role | Current | Change |
|---|---|---|
| `click` | `click.wav` — gliding 1500→1050 Hz sine + noise | rebuild |
| `submit` | detuned square pair 1046 → 1568 Hz | rebuild |
| `update` | square 1175 Hz + sine 1568 Hz | rebuild |
| `delete` | gliding square 740→560 Hz + sub-octave | rebuild |
| `login` | sine blips → detuned C-major chord, 1.0 s | rebuild |
| `error` (WAV) | sawtooth 480 → 380 Hz | rebuild |
| `open` | **alias** of `submit.wav` | new dedicated `ui_open.wav` |
| `close` | **borrows Motorola `key_out.wav`** | new dedicated `ui_close.wav` |
| `navigate` | **alias** of `click.wav` | new dedicated `navigate.wav` |

### In scope — voice

- Fix the voice picker (`voiceCatalog.ts` ↔ Aura-2 speaker roster mismatch)
- Rewrite the call-update phrasing
- Add voice to notification alerts (`notificationTones.ts`)
- Terseness policy for panic / Priority 1

### Explicitly OUT of scope

- **Every tone in `dispatchTones.ts` is untouched.** That file is the Motorola library —
  its header declares it as "Motorola Spillman Flex / MCC7500 / P25" with frequencies
  matched to real hardware, and all 44 profiles inherit that intent.
- **`key_out.wav` is untouched.** The close role stops borrowing it; the file itself is a
  Motorola de-key sample and is left exactly as-is.
- `dispatchTones.ts`'s own `error` profile (a separate sawtooth NACK) is untouched. Only
  the `error` **WAV** used by `actionChimes.ts` for API failures is rebuilt.
- The `caution` profile's incorrect provenance comment (see §7) — noted, not changed.

---

## 3. Provenance policy

Every value in the regenerated sound library carries a tier marker in its comment:

- **`SOURCED:`** — an exact documented Motorola value, citation inline. Used for all pitch
  content.
- **`DERIVED:`** — no published spec exists; built from documented Motorola tone
  vocabulary. Used for all cadence and envelope values, because real paging timing
  (1 s + 3 s) is ~20× too long for UI feedback.

**No comment may claim "authentic Spillman Flex"** for generated audio. That claim is not
available (see §7). The honest framing is *"real Motorola tone frequencies, in
UI-appropriate cadences, through a modelled workstation playback chain."*

---

## 4. Phase 1 — Voice (defects first)

### 4.1 Fix the voice picker

**Defect.** [`voiceCatalog.ts`](../../../client/src/utils/voiceCatalog.ts) offers 14
**Edge-TTS** voice IDs (`en-US-JennyNeural`, `en-US-GuyNeural`, …). The server switched to
**Deepgram Aura-2** on Workers AI, whose speakers are a different roster entirely
(`asteria`, `luna`, `hera`, `orion`, …). `resolveAura2Voice()`
([`aiDispatcher.ts:104`](../../../src/utils/aiDispatcher.ts)) validates against
`AURA2_EN_VOICES` and coerces anything unknown to `DISPATCH_VOICE = 'asteria'`.

**Not one of the 14 catalog IDs is a valid Aura-2 speaker.** Every selection collapses to
`asteria`. Consequences:

- The picker has no effect on anything.
- Selecting a male voice (`Guy`, `Davis`, `Eric`) still produces a female voice. The UI lies.
- The requirement "actual-sounding female announcer" is currently met *by accident*, via a
  coercion fallback rather than by design.

**Fix.** Replace the catalog with the real Aura-2 English female speakers, keep
`asteria` as the pinned default, and re-point `DEFAULT_VOICE_ID`. The catalog's
`VoiceOption` shape is unchanged so the Settings picker needs no structural edit.
Migration: an existing stored `rmpg-voice-persona` holding an Edge-TTS ID already coerces
to `asteria`, so no data migration is required — behaviour is identical before and after
for anyone who never had a working selection.

### 4.2 Rewrite the call-update phrasing

**Defect.** [`voiceAlerts.ts:1212`](../../../client/src/utils/voiceAlerts.ts) builds:

```
`Update on call ${callNumber}. ${updateType}${author ? ` by ${author}` : ''}.`
```

**14 of the 16 call sites pass `''` as `callNumber`** (all in `DispatchPage.tsx`), using the
function as a generic "speak this text" channel. That renders as
*"Update on call . 5 units active. 2 available…"* — the announcer says "update on call,"
stops dead on a stray period, then reads unrelated text. Measured chain length: **6.2 s**.

**Fix — two changes:**

1. **The update announcement becomes `"Call updated."`** — bare, 1.4 s total chain
   (110 ms `info` tone + 400 ms gap + 0.8 s voice). The audio is an *attention cue*; the
   dispatcher reads detail off the screen. Approved by audition.
2. **Separate the two uses.** The 14 generic call sites are not call updates and must not be
   voiced by the update path. They get a distinct `speakDispatcherResponse(text)` entry point
   with no phrase prefix, so tool-query readbacks speak their text verbatim and call updates
   speak `"Call updated."`

This is the change that makes the malformed sentence impossible rather than merely
better-worded.

### 4.3 Add voice to notification alerts

[`notificationTones.ts`](../../../client/src/utils/notificationTones.ts) plays a tone and
stops — there is no speech on any notification. Voice is added, keeping the existing tone
mapping and applying the same terseness discipline as §4.2:

| Priority | Tone (unchanged) | Voice (new) |
|---|---|---|
| `critical` | `emergency_three` | `"Critical alert."` + detail |
| `high` | `alert` | `"High priority."` + detail |
| `normal` | `info` | detail only, no prefix |

`critical` keeps detail because a life-safety alert must be actionable without looking at a
screen. `normal` gets no prefix because the tone already carries "something happened."

Gating: reuses the existing `rmpg_notification_sounds_<user-id>` key so an operator who
muted notification sound does not suddenly get speech. A new `VoiceEventCategory` entry —
`notification` — is added so notification speech can be muted independently of the tone.

### 4.4 Terseness for panic and Priority 1

Measured production chain lengths, standard terseness:

| Alert | Tone | Gap | Voice | Total |
|---|---|---|---|---|
| Panic alert | 850 + 200 + 850 ms | 400 ms | 11.1 s | **13.4 s** |
| New call — P1 | 850 ms | 400 ms | 11.9 s | **13.1 s** |
| New call — P2 | 1060 ms | 400 ms | 8.1 s | 9.6 s |

A 13-second panic announcement occupies the channel for the whole readback while an officer
is waiting on help. `voiceAlerts.ts` already has a `currentTerseness()` adapter with
`terse` and `narrative` modes; everything above is `standard`.

**Proposal:** `panic` and `P1` force `terse` regardless of the global preference.
**This changes life-safety behaviour and needs explicit sign-off (see §8).**

---

## 5. Phase 2 — System sounds

### 5.1 Palette

Pitch content is `SOURCED` from the Midian Electronics Motorola two-tone/four-tone
signaling chart (reed-group tables) and the MDC-1200 mark/space pair. Cadence is `DERIVED`.

| Role | Pitch (SOURCED) | Source | Cadence (DERIVED) |
|---|---|---|---|
| `click` | 1513.5 Hz | Reed Group 10, tone 1 | 14 ms + noise transient |
| `navigate` | 1153.4 Hz | Reed Group 6, tone 1 | single 40 ms pip |
| `open` | 600.9 → 928.1 Hz | Reed Group 2, tones 2→9 | ascending pair, 60 ms each |
| `close` | 928.1 → 600.9 Hz | Reed Group 2, tones 9→2 | descending pair, 60 ms each |
| `submit` | 1200 → 1800 Hz | MDC-1200 mark & space | ascending pair, 55 ms each |
| `update` | 1200 + 1800 Hz | MDC-1200, stacked | 70 ms |
| `delete` | 539.0 → 330.5 Hz | Reed Group 1, tones 9→0 | descending, 55 + 90 ms |
| `error` | 368.5 → 330.5 Hz | Reed Group 1, tones 2→0 | descending, 100 ms each |
| `login` | 349.0 → 928.1 Hz | QC2 one-plus-one: Grp 1 t1 → Grp 2 t9 | 150 / 450 ms (authentic 1:3 ratio) |

**All tones hold a fixed pitch.** The current `click` and `delete` sweep between two
frequencies; a Motorola paging reed is a mechanical resonator and physically cannot do that,
so steady tones with linear edges are the faithful shape. `login` is the one role whose
real-world analogue maps cleanly onto a UI event — a QC2 page is two sequential reed tones
at a 1:3 duration ratio — so it uses real reed frequencies in the real structure,
time-compressed to 600 ms.

### 5.2 Workstation playback chain

Authentic Motorola frequencies rendered as clean 44.1 kHz sines still read as *generated*.
Real CAD application sounds are low-bitrate legacy Windows assets played through a cheap
console speaker. The chain models that, in the order a real asset suffers it:

1. **Decimate to 22.05 kHz with no anti-alias filter** — era converters aliased, and that
   aliasing is part of the sound
2. **Faint noise floor**
3. **Dither + quantize to 8-bit** — audible quantization floor
4. **Small-speaker EQ** — highpass 165 Hz (no bass from a small driver), +5 dB peak at
   2.2 kHz (plastic enclosure honk), lowpass 7 kHz
5. **Peak-normalize to −1 dBFS** — existing pipeline contract

Files are written **at 22.05 kHz / 8-bit**, not upsampled back — the asset itself is a
low-rate file, as real ones are. Side effect: ~4× smaller (`login` 62 KB → 15.5 KB).

This mirrors [`radioProcessor.ts`](../../../client/src/utils/radioProcessor.ts), which
colors TTS through a modelled P25 vocoder chain so it sounds like it came out of a radio.
This is the same idea for a workstation.

A `vintage` variant (11.025 kHz, narrower EQ) was auditioned and rejected: it thins
`submit` and `update`, whose 1800 Hz component sits near the 4.6 kHz lowpass, making the
two roles harder to distinguish.

### 5.3 Wiring

- **`generate-ui-sounds.js` is the source of truth.** The WAVs are committed build output.
  Never hand-edit the audio files.
- **`open`, `close`, `navigate` need the boot preload list updated** at
  [`main.tsx:35-36`](../../../client/src/main.tsx) or their first play falls through to
  silence — `uiClickSounds.ts` is deliberately sample-only with no synth fallback.
- **Stale comment cleanup.** [`soundAssets.ts:11-13`](../../../client/src/utils/soundAssets.ts)
  claims the `uiClickSounds.ts` synth is the fallback voice. It isn't — that module is
  sample-only and a decode miss stays silent by design. Fix the comment.
- `MAX_GAIN = 0.5` and the shared `DynamicsCompressor` limiter are unchanged. WAVs are
  peak-normalized to −1 dBFS, so gain is absolute level.

---

## 6. Testing

| Area | Test |
|---|---|
| Generator | Node test asserting each emitted WAV's sample rate, bit depth, channel count, duration, and peak == 0.891 |
| Provenance | Test asserting every frequency in the generator appears in a checked-in table of documented Motorola values, so a future edit can't silently invent one |
| Preload | Assert every key played by `uiClickSounds` / `actionChimes` appears in the `main.tsx` preload list — the failure mode that makes new sounds silently silent |
| Voice catalog | Assert every `VoiceOption.id` is a member of `AURA2_EN_VOICES`. This is the test that would have caught the picker defect |
| Call update | Assert the update path emits exactly `"Call updated."` and that the generic readback path emits its text with no prefix — pin the branch, break the fix, confirm red |
| Notification voice | Assert tone-then-speech ordering and that a muted `notification` category suppresses speech but not the tone |
| Terseness | Assert `panic` and `P1` produce terse phrasing regardless of the stored global preference |

Full client suite (`cd client && npx vitest run`) is the gate, not targeted runs — a red
test hid behind green targeted runs for four tasks in the 2026-07-24 sweep. Baseline is
clean, so any failure is caused by this change.

---

## 7. What could not be sourced — read before adding provenance claims

**There is no published specification for Spillman Flex application UI sounds.** Searches
across Motorola Solutions product docs, APX user guides, the Motorola video library, and
radio forums returned alert-tone *function* tables with no frequency values, and nothing at
all for CAD click/save/delete feedback.

**The real Spillman audio exists but is not publicly available.** It lives in
`C:\Program Files\Spillman\sounds\` on a licensed install. On both
[RadioReference](https://forums.radioreference.com/threads/spillman-cad-sounds.394554/)
[threads](https://forums.radioreference.com/threads/spillman-summit-cad-sound.312158/), the
only member with the files offers to send them by private email; nothing is posted publicly
and no filename list exists. **If RMPG has a Flex install, that folder is the whole answer**
— `soundAssets.ts:14-16` already accepts drop-in replacements under the same names with
zero code changes.

**Spillman Flex has no voice announcer.** The voice heard alongside Flex comes from
**Locution CADVoice**, a separate fire-station-alerting product. Motorola publishes a
[Flex/Locution interface fact sheet](https://www.motorolasolutions.com/content/dam/msi/docs/global-software/spillman-cad/flex_locutionInt_spec.pdf):
Flex sends call data over an interface, and Locution produces the tones and announcements.
Locution's voice is "based on a real human voice of a professional voice talent" — an
accent-neutral female voice actor, delivered as pre-recorded fragments. **It cannot be
copied** (a real person's voice identity, licensed by a third party, with no reference audio
available) and it is not Motorola's asset.

**A cadence-matching experiment failed — recorded here so it isn't retried.** Hypothesis:
Locution's signature comes from its concatenative structure, so rebuilding announcements as
independently-rendered, level-matched segments joined by fixed 190 ms gaps should sound
closer. Measured against the flowing version: duration 11.9 s → 11.7 s, level spread 0.190
vs 0.193, silent-run structure `[8,5,8,7,5,5,7]` vs `[8,5,8,6,5,5,7]`. **Effectively
identical** — the TTS already treats each sentence independently and inserts its own
boundary pauses. Do not re-attempt without a different mechanism.

**The consistency property Motorola advertises is already satisfied.**
[`tts.ts:124-131`](../../../src/routes/tts.ts) caches synthesized audio in KV keyed on
`speaker + SHA-256(text)` with a 7-day TTL, so identical phrase text returns byte-identical
audio. "Sounds the same each time" — by caching rather than pre-recording.

**An existing provenance error, noted but not changed.** The `caution` profile at
[`dispatchTones.ts:126-131`](../../../client/src/utils/dispatchTones.ts) claims to be "the
standard Motorola Quick Call II pair" at 853.1 / 960.0 Hz, each 330 ms. Against the real
reed tables, **neither frequency exists in any Motorola QC2 reed group** (nearest are
855.5 Hz in Group 5 and 928.1 Hz in Group 2), and QC2 timing is 1 s + 3 s, not 330 ms. It is
a Motorola tone and therefore out of scope — but it is a live example of why §3's tier
markers exist.

---

## 8. Open decisions requiring sign-off

1. **Terseness policy (§4.4).** Force `terse` for `panic` and `P1`? This changes
   life-safety announcement behaviour. Recommended: yes.
2. **The panic mute policy.** [`voiceAlerts.ts:270-285`](../../../client/src/utils/voiceAlerts.ts)
   carries an unimplemented TODO asking whether the per-event mute should be honored for
   `panic`. It currently **is** honored, meaning an operator can silence officer-down
   alerts. Adjacent to this work and unresolved. Options in the code comment: (a) always
   speak panic, (b) honor the toggle only for dispatchers, (c) honor it fully.
   Not implemented in this spec — needs a policy decision.
3. **Fidelity variant (§5.2).** `workstation` (22.05 kHz / 8-bit) is written in as the
   choice on the strength of the audition and the technical argument against `vintage`, but
   this was **not explicitly confirmed**. If `vintage` is preferred, only the `VARIANTS`
   constant changes.
4. **Sequencing (§9).** Voice-first is a recommendation, **not confirmed** — it follows from
   Phase 1 being live defects and Phase 2 being a preference change. Either order works;
   the phases are independent.
5. **Aura-2 speaker selection.** Choosing the announcer requires auditioning the real
   speakers (`asteria`, `athena`, `hera`, `luna`, `aurora`, `cora`, `iris`, `juno`,
   `selene`, `thalia`, `vesta`), which needs a Workers AI call — `wrangler dev --remote` or
   the deployed endpoint with a token. Until then `asteria` stays the pinned default on the
   strength of its in-code description ("calm, clear, professional female dispatcher voice").

---

## 9. Sequencing

- **PR 1 — Voice.** §4.1–4.3, plus §4.4 if signed off. Fixes live defects.
- **PR 2 — System sounds.** §5. Preference change to something already working.

The two touch almost no shared files, so they review cleanly apart. Phase 2 does not depend
on Phase 1.
