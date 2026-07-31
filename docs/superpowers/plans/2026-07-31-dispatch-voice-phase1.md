# Dispatch Voice (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three live dispatch-voice defects and add a distinct automated voice for alerts.

**Architecture:** `harmonia` becomes the Dispatch voice. The alert voice is the *same*
`harmonia` TTS request run through a different client-side DSP chain ("station PA") instead of
the P25 radio haze — so no second TTS engine, no server change, and cached audio is reusable
across both roles. Routing rides the `VoiceMode` parameter that `speak()` already threads,
extended with a third value.

**Tech Stack:** React 18 + TypeScript + Vite (client), Hono on Cloudflare Workers (API),
Deepgram Aura-2 via Workers AI, WebAudio (BiquadFilter + WaveShaper), Vitest.

## Global Constraints

- **Every tone in `client/src/utils/dispatchTones.ts` is out of scope.** Do not edit that file's
  `PROFILES`. Do not edit any file in `client/public/sounds/`.
- **Design tokens:** never hardcode hex. Use the `rmpg-*`/`brand-*`/`surface-*` Tailwind tokens.
  Gold only via `--field-label-color` / `--panel-header-color`.
- **Radius is 2px everywhere** — never `rounded-lg`.
- **D1 queries are async** — always `await`. (No D1 work in this plan, but applies if you add any.)
- **The full client suite is the gate:** `cd client && npx vitest run`. Not targeted runs.
  Baseline is clean (0 failures), so any red test is caused by your change.
- **Never run root and client vitest concurrently** — it fakes ~9 failures. Run serially.
- **Worker typecheck:** `npm run typecheck`. **Client typecheck:** `cd client && npx tsc --noEmit`.
- **Fresh worktree:** run `cd client && npm install --legacy-peer-deps` first, or `tsc` reports
  ~97,000 phantom "Cannot find module" errors.
- **`main` is protected** — PR required, no direct push.
- Spec: [`docs/superpowers/specs/2026-07-30-system-audio-and-dispatch-voice-design.md`](../specs/2026-07-30-system-audio-and-dispatch-voice-design.md)

## Out of Scope for this plan

- **Phase 2 (the 9 system/UI sounds)** — blocked on an undecided fidelity direction
  (workstation / clean / modern). Separate plan once decided.
- **The panic-mute policy** (spec §8.2) — an operator can currently silence officer-down
  announcements. That is a policy decision, not a code decision. `isEventEnabled()` is left
  exactly as-is by this plan.
- **Terseness policy** (spec §4.4) — the 13.1 s Priority 1 figure was measured with `asteria`;
  `harmonia` is ~37% faster, so it must be re-measured after Task 2 before deciding. Task 2
  includes the measurement, not the policy change.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/utils/aiDispatcher.ts` | Aura-2 speaker allowlist + dispatch speaker constant | Modify (1 line) |
| `client/src/utils/voiceCatalog.ts` | The voices offered in Settings | Rewrite the roster |
| `client/src/utils/radioProcessor.ts` | All shared voice DSP chains | Add `buildPaVoiceChain` |
| `client/src/utils/edgeTTS.ts` | TTS fetch + WebAudio playback graph | Add `'alert_pa'` mode + chain switch |
| `client/src/utils/voiceAlerts.ts` | Announcement phrasing + speech queue | `VoicePhrase.mode`, call-update rewrite, new category |
| `client/src/utils/notificationTones.ts` | Notification tone → now also speech | Add voice |
| `src/routes/tts.ts` | TTS endpoint | Fix melotts content-type mislabel |

---

### Task 1: Make the voice catalog match the Aura-2 roster

**Why:** `voiceCatalog.ts` offers 14 Edge-TTS ids (`en-US-JennyNeural`, …). The server uses
Deepgram Aura-2, whose speakers are a different set. `resolveAura2Voice()` coerces every
unknown name to the default, so **no selection has any effect** and picking a male voice still
yields a female one. This task makes the picker honest and adds the test that would have caught
it.

**Files:**
- Modify: `client/src/utils/voiceCatalog.ts` (replace `VOICE_CATALOG` + `DEFAULT_VOICE_ID`)
- Create: `client/src/utils/__tests__/voiceCatalog.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `VOICE_CATALOG: VoiceOption[]` (shape unchanged), `DEFAULT_VOICE_ID = 'harmonia'`,
  `getVoiceOption(id: string | null | undefined): VoiceOption`. `VoiceOption` keeps its existing
  fields: `{ id, label, gender, accent, description }`.

- [ ] **Step 1: Write the failing test**

Create `client/src/utils/__tests__/voiceCatalog.test.ts`:

```ts
// Guards the invariant that broke the picker: every catalog id must be a
// real Aura-2 speaker, or resolveAura2Voice() silently coerces it to the
// default and the user's choice does nothing.
import { describe, it, expect } from 'vitest';
import { VOICE_CATALOG, DEFAULT_VOICE_ID, getVoiceOption } from '../voiceCatalog';

// Mirrors AURA2_EN_VOICES in src/utils/aiDispatcher.ts (40 speakers).
// Intentionally duplicated: the client cannot import from the Worker tree.
const AURA2_EN_VOICES = new Set([
  'amalthea', 'andromeda', 'apollo', 'arcas', 'aries', 'asteria', 'athena', 'atlas',
  'aurora', 'callista', 'cora', 'cordelia', 'delia', 'draco', 'electra', 'harmonia',
  'helena', 'hera', 'hermes', 'hyperion', 'iris', 'janus', 'juno', 'jupiter', 'luna',
  'mars', 'minerva', 'neptune', 'odysseus', 'ophelia', 'orion', 'orpheus', 'pandora',
  'phoebe', 'pluto', 'saturn', 'thalia', 'theia', 'vesta', 'zeus',
]);

describe('voiceCatalog', () => {
  it('offers only real Aura-2 speakers', () => {
    const bad = VOICE_CATALOG.filter((v) => !AURA2_EN_VOICES.has(v.id));
    expect(bad.map((v) => v.id)).toEqual([]);
  });

  it('defaults to harmonia', () => {
    expect(DEFAULT_VOICE_ID).toBe('harmonia');
    expect(VOICE_CATALOG.some((v) => v.id === 'harmonia')).toBe(true);
  });

  it('never offers selene — it is not in the Aura-2 allowlist', () => {
    expect(VOICE_CATALOG.some((v) => v.id === 'selene')).toBe(false);
  });

  it('does not label athena female — it measured 145 Hz, male register', () => {
    const athena = VOICE_CATALOG.find((v) => v.id === 'athena');
    if (athena) expect(athena.gender).toBe('male');
  });

  it('has unique ids and non-empty labels', () => {
    const ids = VOICE_CATALOG.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(VOICE_CATALOG.every((v) => v.label.length > 0)).toBe(true);
  });

  it('coerces an unknown or stale Edge-TTS id to the default', () => {
    expect(getVoiceOption('en-US-JennyNeural').id).toBe('harmonia');
    expect(getVoiceOption(null).id).toBe('harmonia');
    expect(getVoiceOption(undefined).id).toBe('harmonia');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/__tests__/voiceCatalog.test.ts`
Expected: FAIL — "offers only real Aura-2 speakers" lists all 14 `en-US-*` ids, and
"defaults to harmonia" fails because `DEFAULT_VOICE_ID` is `'en-US-JennyNeural'`.

- [ ] **Step 3: Replace the roster**

In `client/src/utils/voiceCatalog.ts`, replace the `VOICE_CATALOG` array and
`DEFAULT_VOICE_ID` (keep the `VoiceOption` interface and `getVoiceOption` function as they
are). Update the file's header comment — it currently says "Microsoft Edge-TTS neural voices",
which is now wrong.

```ts
// ============================================================
// RMPG Flex — Dispatcher Voice Catalog
//
// Deepgram Aura-2 speakers (@cf/deepgram/aura-2-en) offered in the
// Settings UI. These ids are what the Worker's /api/tts endpoint
// expects; resolveAura2Voice() in src/utils/aiDispatcher.ts validates
// against AURA2_EN_VOICES and coerces anything unknown to the default.
//
// ⚠️ Every id here MUST be a member of AURA2_EN_VOICES. Until 2026-07-31
// this catalog listed Microsoft Edge-TTS ids ('en-US-JennyNeural', …)
// left over from the pre-Aura server. None were valid Aura-2 speakers, so
// EVERY selection silently coerced to the default and the picker did
// nothing — including offering male voices that played female.
// voiceCatalog.test.ts now enforces the invariant.
//
// Gender labels are from MEASURED median F0 (autocorrelation, 2026-07-31),
// not from the name: 'athena' measures 145 Hz (male register) despite the
// classical association. 'selene' exists in Deepgram's wider roster but
// NOT in AURA2_EN_VOICES — do not add it.
//
// The persona voice id is stored in localStorage under 'rmpg-voice-persona'
// and read at speak-time, so changes here are immediately effective.
// ============================================================

export interface VoiceOption {
  /** Aura-2 speaker name, e.g. 'harmonia'. Must be in AURA2_EN_VOICES. */
  id: string;
  /** Human-friendly display name. */
  label: string;
  /** From measured median F0 — drives the grouping in the picker. */
  gender: 'female' | 'male';
  /** Accent / locale tag for the secondary label. */
  accent: string;
  /** One-line character description shown under the name. */
  description: string;
}

export const VOICE_CATALOG: VoiceOption[] = [
  // ── Female register (measured F0 ≥ 165 Hz) ───────────────
  { id: 'harmonia', label: 'Harmonia', gender: 'female', accent: 'US', description: 'Fast, clear — default dispatcher (178 Hz)' },
  { id: 'hera',     label: 'Hera',     gender: 'female', accent: 'US', description: 'Brightest register, measured 235 Hz' },
  { id: 'ophelia',  label: 'Ophelia',  gender: 'female', accent: 'US', description: 'Bright, articulate (222 Hz)' },
  { id: 'minerva',  label: 'Minerva',  gender: 'female', accent: 'US', description: 'Clear, strong radio survival (216 Hz)' },
  { id: 'asteria',  label: 'Asteria',  gender: 'female', accent: 'US', description: 'Calm, professional, unhurried (211 Hz)' },
  { id: 'aurora',   label: 'Aurora',   gender: 'female', accent: 'US', description: 'Warm, quick (211 Hz)' },
  { id: 'luna',     label: 'Luna',     gender: 'female', accent: 'US', description: 'Even, measured (211 Hz)' },
  { id: 'juno',     label: 'Juno',     gender: 'female', accent: 'US', description: 'Steady, neutral (205 Hz)' },
  { id: 'thalia',   label: 'Thalia',   gender: 'female', accent: 'US', description: 'Conversational, brisk (200 Hz)' },
  { id: 'iris',     label: 'Iris',     gender: 'female', accent: 'US', description: 'Light, precise (195 Hz)' },
  { id: 'andromeda',label: 'Andromeda',gender: 'female', accent: 'US', description: 'Flattest affect measured — most monotone (186 Hz)' },
  { id: 'cora',     label: 'Cora',     gender: 'female', accent: 'US', description: 'Low female register, even (174 Hz)' },
  // ── Male register (measured F0 ≤ 155 Hz) ─────────────────
  { id: 'athena',   label: 'Athena',   gender: 'male',   accent: 'US', description: 'Mid-low register (measured 145 Hz)' },
  { id: 'orion',    label: 'Orion',    gender: 'male',   accent: 'US', description: 'Authoritative, command presence' },
  { id: 'atlas',    label: 'Atlas',    gender: 'male',   accent: 'US', description: 'Deep, steady' },
  { id: 'zeus',     label: 'Zeus',     gender: 'male',   accent: 'US', description: 'Deepest, most weight (105 Hz)' },
];

/** Default persona voice id — the confirmed Dispatch voice. */
export const DEFAULT_VOICE_ID = 'harmonia';
```

Leave `getVoiceOption` unchanged — it already falls back to `DEFAULT_VOICE_ID`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/__tests__/voiceCatalog.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Update the two stale localStorage defaults**

`getEdgeTTSPayload` in `client/src/utils/edgeTTS.ts:74-76` defaults both keys to
`'en-US-JennyNeural'`. Replace both with the catalog default so a user who never picked a
voice gets a valid speaker rather than relying on server-side coercion:

```ts
  const voice = voiceMode === 'spillman_flat'
    ? (localStorage.getItem('rmpg-voice-spillman') || DEFAULT_VOICE_ID)
    : (localStorage.getItem('rmpg-voice-persona') || DEFAULT_VOICE_ID);
```

Add the import at the top of `edgeTTS.ts`:

```ts
import { DEFAULT_VOICE_ID } from './voiceCatalog';
```

- [ ] **Step 6: Typecheck and run the full client suite**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: 0 type errors; all tests pass. If `edgeTTS.persona.test.ts` fails, read it — it may
assert the old `'en-US-JennyNeural'` default and need updating to `'harmonia'`.

- [ ] **Step 7: Commit**

```bash
git add client/src/utils/voiceCatalog.ts client/src/utils/__tests__/voiceCatalog.test.ts client/src/utils/edgeTTS.ts
git commit -m "fix(voice): make the voice picker actually work

voiceCatalog.ts offered 14 Microsoft Edge-TTS ids left over from the
pre-Aura server. None are valid Aura-2 speakers, so resolveAura2Voice()
coerced every selection to the default — the picker did nothing, and
choosing a male voice still played a female one.

Replaced with 16 real Aura-2 speakers, default harmonia. Gender labels
come from measured median F0, not the name: athena measures 145 Hz and is
labelled male. selene is excluded — it is in Deepgram's wider roster but
not in AURA2_EN_VOICES.

voiceCatalog.test.ts asserts every catalog id is in AURA2_EN_VOICES, which
is the test that would have caught this."
```

---

### Task 2: Switch the Dispatch voice to harmonia and re-measure announcement length

**Why:** `harmonia` is the confirmed Dispatch voice. It is also ~37% faster than `asteria`,
which invalidates the 13.1 s Priority 1 measurement the terseness policy was based on. This
task changes the voice and records fresh numbers so the policy decision has real data.

**Files:**
- Modify: `src/utils/aiDispatcher.ts:80`
- Test: `tests/aiDispatcherVoice.test.ts` (existing — extend it)

**Interfaces:**
- Consumes: nothing.
- Produces: `DISPATCH_VOICE = 'harmonia'` (module-private); `resolveAura2Voice(name, fallback?)`
  behaviour unchanged, but its default fallback is now `'harmonia'`.

- [ ] **Step 1: Write the failing test**

Append to `tests/aiDispatcherVoice.test.ts`:

```ts
import { resolveAura2Voice, AURA2_EN_VOICES } from '../src/utils/aiDispatcher';

describe('dispatch voice default', () => {
  it('defaults to harmonia', () => {
    // An unknown name coerces to DISPATCH_VOICE
    expect(resolveAura2Voice('en-US-JennyNeural')).toBe('harmonia');
    expect(resolveAura2Voice(null)).toBe('harmonia');
    expect(resolveAura2Voice('')).toBe('harmonia');
  });

  it('still honours a valid explicit speaker', () => {
    expect(resolveAura2Voice('asteria')).toBe('asteria');
    expect(resolveAura2Voice('HERA')).toBe('hera'); // case-insensitive
  });

  it('harmonia is in the allowlist', () => {
    expect(AURA2_EN_VOICES.has('harmonia')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/aiDispatcherVoice.test.ts`
Expected: FAIL — "defaults to harmonia" gets `'asteria'`.

- [ ] **Step 3: Change the constant**

`src/utils/aiDispatcher.ts:77-80` — update the comment and the value:

```ts
// Deepgram Aura-2 speaker. Confirmed Dispatch voice 2026-07-31: fastest of
// the 23 female-register speakers (5.3s on the reference line vs asteria's
// 8.4s) and tied best for intelligibility through the P25 300-3400Hz band
// (90.4% RMS retained). MUST be a valid aura-2-en speaker (see
// AURA2_EN_VOICES) — an Aura-1-only name errors the model and drops us to
// the robotic melotts fallback.
const DISPATCH_VOICE = 'harmonia';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/aiDispatcherVoice.test.ts`
Expected: PASS.

- [ ] **Step 5: Re-measure announcement length against harmonia**

The spec's §4.4 timings were measured with `asteria` and are now stale. Measure the two that
drive the terseness question. In a browser on the running app (or via a `wrangler dev --remote`
probe worker exposing the `AI` binding), synthesize these two strings with
`speaker: 'harmonia'` and record the audio duration:

1. `"Attention all units. New priority 1 call. Domestic Violence. At 3392 Mockingbird Way, Salt Lake City. Caution: weapons involved, officer safety."`
2. `"Panic alert. Officer needs immediate assistance. Officer Zamora, unit S19. Location: 3392 Mockingbird Way. All units respond."`

Total chain length = tone + 400 ms gap + voice. Tone durations are fixed:
`alarm` 850 ms, `warning` 1060 ms, `caution` 740 ms, `info` 110 ms.
So P1 total = 850 + 400 + voice₁; panic total = 850 + 200 + 850 + 400 + voice₂.

Write both numbers into spec §4.4, replacing the `asteria` figures and labelling them
`measured with harmonia 2026-07-31`. **Do not change any terseness code** — that decision is
out of scope and belongs to the operator.

- [ ] **Step 6: Run the Worker suite**

Run: `npm run typecheck && npx vitest run`
Expected: 0 type errors; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/utils/aiDispatcher.ts tests/aiDispatcherVoice.test.ts docs/superpowers/specs/2026-07-30-system-audio-and-dispatch-voice-design.md
git commit -m "feat(voice): harmonia is the Dispatch voice

Measured fastest of the 23 female-register Aura-2 speakers (5.3s vs
asteria's 8.4s on the reference line) and tied best for intelligibility
through the P25 300-3400Hz band at 90.4% RMS retained.

Also re-measures the Priority 1 and panic announcement lengths against
harmonia in the spec — the previous 13.1s/13.4s figures were taken with
asteria and are ~37% too high, which materially changes how aggressive
the terseness policy needs to be."
```

---

### Task 3: Add the station-PA voice chain and the `alert_pa` voice mode

**Why:** The automated alert voice is `harmonia` through a different DSP chain, not a second
TTS engine. This task adds the chain and the routing, with nothing consuming it yet — so it is
independently testable and reviewable.

**Files:**
- Modify: `client/src/utils/radioProcessor.ts` (add `buildPaVoiceChain`)
- Modify: `client/src/utils/edgeTTS.ts` (extend `VoiceMode`, switch the chain, skip radio-only stages)
- Create: `client/src/utils/__tests__/paVoiceChain.test.ts`

**Interfaces:**
- Consumes: `RadioChainNodes { input: AudioNode; output: AudioNode }` from `radioProcessor.ts`.
- Produces:
  - `buildPaVoiceChain(ctx: AudioContext): RadioChainNodes` — exported from `radioProcessor.ts`.
  - `VoiceMode = 'conversational' | 'spillman_flat' | 'alert_pa'` — exported from `edgeTTS.ts`.

- [ ] **Step 1: Write the failing test**

Create `client/src/utils/__tests__/paVoiceChain.test.ts`:

```ts
// The alert voice is harmonia through a "station PA" chain instead of the
// P25 radio haze. Asserts the filter topology, because the whole point of
// the separation is that it does NOT sound like radio traffic.
import { describe, it, expect, vi } from 'vitest';
import { buildPaVoiceChain } from '../radioProcessor';

function mockCtx() {
  const filters: any[] = [];
  const shapers: any[] = [];
  const ctx: any = {
    sampleRate: 48000,
    createBiquadFilter: vi.fn(() => {
      const f = { type: '', frequency: { value: 0 }, Q: { value: 0 }, gain: { value: 0 }, connect: vi.fn() };
      filters.push(f);
      return f;
    }),
    createWaveShaper: vi.fn(() => {
      const s = { curve: null as Float32Array | null, oversample: '', connect: vi.fn() };
      shapers.push(s);
      return s;
    }),
    createGain: vi.fn(() => ({ gain: { value: 1 }, connect: vi.fn() })),
  };
  return { ctx, filters, shapers };
}

describe('buildPaVoiceChain', () => {
  it('returns an input and output node', () => {
    const { ctx } = mockCtx();
    const chain = buildPaVoiceChain(ctx);
    expect(chain.input).toBeTruthy();
    expect(chain.output).toBeTruthy();
  });

  it('bandlimits to a horn speaker: 420 Hz highpass, 3100 Hz lowpass', () => {
    const { ctx, filters } = mockCtx();
    buildPaVoiceChain(ctx);
    const hp = filters.find((f) => f.type === 'highpass');
    const lp = filters.find((f) => f.type === 'lowpass');
    expect(hp?.frequency.value).toBe(420);
    expect(lp?.frequency.value).toBe(3100);
  });

  it('boosts 1.6 kHz presence and notches the 900 Hz horn honk', () => {
    const { ctx, filters } = mockCtx();
    buildPaVoiceChain(ctx);
    const peaks = filters.filter((f) => f.type === 'peaking');
    const presence = peaks.find((f) => f.frequency.value === 1600);
    const notch = peaks.find((f) => f.frequency.value === 900);
    expect(presence?.gain.value).toBeCloseTo(6.5, 1);
    expect(notch?.gain.value).toBeCloseTo(-4, 1);
  });

  it('applies a soft-clip drive curve', () => {
    const { ctx, shapers } = mockCtx();
    buildPaVoiceChain(ctx);
    expect(shapers.length).toBe(1);
    const curve = shapers[0].curve!;
    expect(curve.length).toBeGreaterThan(64);
    // tanh-shaped: monotonic, bounded, and compressive at the extremes
    expect(curve[0]).toBeLessThan(0);
    expect(curve[curve.length - 1]).toBeGreaterThan(0);
    expect(Math.abs(curve[curve.length - 1])).toBeLessThanOrEqual(1);
    expect(curve[curve.length - 1]).toBeLessThan(1);
  });

  it('does NOT bandlimit to the P25 300-3400 band — that is the radio chain', () => {
    const { ctx, filters } = mockCtx();
    buildPaVoiceChain(ctx);
    expect(filters.some((f) => f.type === 'highpass' && f.frequency.value === 300)).toBe(false);
    expect(filters.some((f) => f.type === 'lowpass' && f.frequency.value === 3400)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/__tests__/paVoiceChain.test.ts`
Expected: FAIL — `buildPaVoiceChain is not a function`.

- [ ] **Step 3: Add the chain to radioProcessor.ts**

Append to `client/src/utils/radioProcessor.ts` (after `buildRadioVoiceChain`):

```ts
// ─── Station-PA voice chain (automated ALERT voice) ──────────
// The alert voice is the SAME harmonia TTS request as dispatch, run
// through this chain instead of the P25 haze. Two separations at once:
// different timbre AND radio-vs-not-radio, so an operator can tell a
// computer alert from a dispatcher transmission instantly.
//
// Models a boxy horn/ceiling PA speaker:
//   420Hz highpass      — no bass from a horn driver
//   +6.5dB @1.6kHz Q1.3 — announcement presence
//   3100Hz lowpass      — rolled-off top
//   tanh soft drive     — mild amplifier saturation
//   -4dB @900Hz Q2.0    — notch the boxy horn honk
//
// ⚠️ NEVER chain this after buildRadioVoiceChain. The PA treatment
// REPLACES the radio haze; stacking them defeats the separation and
// sounds like a radio inside a tunnel.
export function buildPaVoiceChain(ctx: AudioContext): RadioChainNodes {
  const highpass = ctx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 420;
  highpass.Q.value = 0.707;

  const presence = ctx.createBiquadFilter();
  presence.type = 'peaking';
  presence.frequency.value = 1600;
  presence.Q.value = 1.3;
  presence.gain.value = 6.5;

  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 3100;
  lowpass.Q.value = 0.707;

  // Soft clip: tanh(x * drive) / drive, sampled into a WaveShaper curve.
  const drive = 2.4;
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * drive) / drive;
  }
  const shaper = ctx.createWaveShaper();
  shaper.curve = curve;
  shaper.oversample = '2x';

  const honkNotch = ctx.createBiquadFilter();
  honkNotch.type = 'peaking';
  honkNotch.frequency.value = 900;
  honkNotch.Q.value = 2.0;
  honkNotch.gain.value = -4;

  // Soft clipping raises perceived loudness; trim so the alert voice sits
  // at a comparable level to the dispatch path rather than jumping out.
  const trim = ctx.createGain();
  trim.gain.value = 0.85;

  highpass.connect(presence);
  presence.connect(lowpass);
  lowpass.connect(shaper);
  shaper.connect(honkNotch);
  honkNotch.connect(trim);

  return { input: highpass, output: trim };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/__tests__/paVoiceChain.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Extend `VoiceMode` and switch the chain in edgeTTS.ts**

In `client/src/utils/edgeTTS.ts`:

1. Line 26 — add the third mode:

```ts
export type VoiceMode = 'conversational' | 'spillman_flat' | 'alert_pa';
```

2. Line 21 — add `buildPaVoiceChain` to the existing import:

```ts
import { ensureRadioWorklets, buildRadioVoiceChain, buildPaVoiceChain, createRadioNoiseBed } from './radioProcessor';
```

3. Replace the intro-tone block (around lines 290-301) so `alert_pa` gets no radio key-up. The
existing code picks between `playSpillmanChime` and `playP25KeyUp`; `alert_pa` gets neither,
because a PA announcement is not a radio transmission:

```ts
    const isPa = voiceMode === 'alert_pa';
    const introDuration = isPa
      ? 0
      : voiceMode === 'spillman_flat'
        ? SPILLMAN_CHIME_DURATION
        : P25_KEYUP_DURATION;
    const voiceDelay = introDuration + (isPa ? 0 : 0.02);
    const voiceDuration = audioBuffer.duration;

    // ── 1. INTRO TONE ─────────────────────────────────────
    // alert_pa is a system announcement, not radio traffic — no key-up.
    if (!isPa) {
      if (voiceMode === 'spillman_flat') {
        playSpillmanChime(ctx, now);
      } else {
        playP25KeyUp(ctx, now);
      }
    }
```

4. Replace the chain construction (line 307) with the switch:

```ts
    // ── 2. VOICE COLORING CHAIN ───────────────────────────
    // alert_pa → station-PA chain (automated alert voice).
    // Everything else → the shared P25 haze.
    // These are mutually exclusive by design; never both.
    const { input, output } = isPa
      ? buildPaVoiceChain(ctx)
      : buildRadioVoiceChain(ctx, hasWorklets);
    source.connect(input);
    output.connect(ctx.destination);
```

5. Guard the noise bed and squelch tail. The receiver hiss and un-key tail are radio artifacts.
Wrap the `createRadioNoiseBed(...)` call and everything that connects/starts it in
`if (!isPa) { ... }`, and change the squelch-tail condition:

```ts
    if (!isPa && voiceMode !== 'spillman_flat') {
      const closeTime = now + voiceDelay + voiceDuration + 0.05;
      playP25KeyDown(ctx, closeTime);
    }
```

> **Read the surrounding code before editing.** `noiseSource` may be referenced later (e.g. in
> `source.onended`). If it is, declare it as `let noiseSource: AudioBufferSourceNode | null = null;`
> before the guard and null-check every later use, rather than moving those references inside
> the guard.

- [ ] **Step 6: Write the routing test**

Append to `client/src/utils/__tests__/paVoiceChain.test.ts`:

```ts
describe('VoiceMode', () => {
  it('includes alert_pa', async () => {
    // Type-level assertion: this file must compile with alert_pa assignable.
    const mod = await import('../edgeTTS');
    const mode: import('../edgeTTS').VoiceMode = 'alert_pa';
    expect(mode).toBe('alert_pa');
    expect(typeof mod.speak).toBe('function');
  });
});
```

- [ ] **Step 7: Typecheck and run the full client suite**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: 0 type errors; all tests pass. If a `switch (voiceMode)` elsewhere now fails
exhaustiveness, add an `alert_pa` branch that behaves like `conversational`.

- [ ] **Step 8: Commit**

```bash
git add client/src/utils/radioProcessor.ts client/src/utils/edgeTTS.ts client/src/utils/__tests__/paVoiceChain.test.ts
git commit -m "feat(voice): station-PA chain + alert_pa voice mode

The automated alert voice is the SAME harmonia request as dispatch, run
through a horn-speaker PA chain (420Hz HP / +6.5dB@1.6k / 3100Hz LP /
tanh drive / -4dB@900 notch) instead of the P25 radio haze. No second TTS
engine, no server change, and cached clips are reusable across both roles
because the difference is applied after decode.

alert_pa also skips the P25 key-up, receiver noise bed, and squelch tail
— those are radio artifacts and a PA announcement is not radio traffic.
That gives two separation axes at once: timbre and radio-vs-not.

Nothing routes to alert_pa yet; wired up in the next commits."
```

---

### Task 4: Let a phrase choose its voice mode

**Why:** `VoicePhrase` is `{ text: string }` and `speakPhrase` calls `edgeSpeak(phrase.text)`
with no mode, so everything is `'conversational'`. Announcements need to opt into `alert_pa`
per phrase.

**Files:**
- Modify: `client/src/utils/voiceAlerts.ts:111-113` (`VoicePhrase`), `:319-343` (`speakPhrase`)
- Create: `client/src/utils/__tests__/voicePhraseMode.test.ts`

**Interfaces:**
- Consumes: `VoiceMode` from `edgeTTS.ts` (Task 3).
- Produces: `VoicePhrase { text: string; mode?: VoiceMode }` (module-private, but
  `enqueuePhrases` now accepts `mode` on each entry). Default when absent: `'conversational'`.

- [ ] **Step 1: Write the failing test**

Create `client/src/utils/__tests__/voicePhraseMode.test.ts`:

```ts
// A phrase must be able to pick its voice mode so notification alerts can
// speak through the PA chain while dispatch traffic stays on the radio chain.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const speakMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../edgeTTS', () => ({
  speak: (...args: unknown[]) => speakMock(...args),
  isEdgeTTSEnabled: () => true,
  getEdgeTTSPayload: () => ({}),
}));

describe('phrase voice mode', () => {
  beforeEach(() => {
    speakMock.mockClear();
    localStorage.clear();
  });

  it('passes alert_pa through to edgeTTS.speak', async () => {
    const va = await import('../voiceAlerts');
    // announceNotification is added in Task 6; until then drive the queue
    // through the exported test seam.
    await va.__speakPhraseForTest({ text: 'Critical alert.', mode: 'alert_pa' });
    expect(speakMock).toHaveBeenCalled();
    expect(speakMock.mock.calls[0][2]).toBe('alert_pa');
  });

  it('defaults to conversational when no mode is given', async () => {
    const va = await import('../voiceAlerts');
    await va.__speakPhraseForTest({ text: 'New call.' });
    expect(speakMock.mock.calls[0][2]).toBe('conversational');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/__tests__/voicePhraseMode.test.ts`
Expected: FAIL — `__speakPhraseForTest is not a function`.

- [ ] **Step 3: Add the mode field, thread it, and export the test seam**

In `client/src/utils/voiceAlerts.ts`:

1. Add the import near the top:

```ts
import type { VoiceMode } from './edgeTTS';
```

2. Replace the `VoicePhrase` interface (line 111):

```ts
interface VoicePhrase {
  text: string;
  /** Which voice chain speaks this phrase. Absent = 'conversational'
   *  (P25 radio haze), which is what all dispatch traffic uses.
   *  'alert_pa' routes to the station-PA chain for automated alerts. */
  mode?: VoiceMode;
}
```

3. In `speakPhrase`, pass the mode (the `severity` parameter stays `undefined`):

```ts
      const { speak: edgeSpeak } = await import('./edgeTTS');
      await edgeSpeak(phrase.text, undefined, phrase.mode ?? 'conversational');
```

4. Add the test seam at the end of the file — a named export so tests can drive one phrase
without reaching into the queue:

```ts
/** Test-only seam: speak exactly one phrase, bypassing the queue.
 *  Not for production use — callers should go through the announce* API. */
export function __speakPhraseForTest(phrase: { text: string; mode?: VoiceMode }): Promise<void> {
  return speakPhrase(phrase);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/__tests__/voicePhraseMode.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Typecheck and run the full client suite**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: 0 type errors; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add client/src/utils/voiceAlerts.ts client/src/utils/__tests__/voicePhraseMode.test.ts
git commit -m "feat(voice): VoicePhrase carries a voice mode

speakPhrase called edgeSpeak(text) with no mode, so every announcement
was 'conversational' (P25 radio haze). VoicePhrase now takes an optional
mode threaded through to speak(), defaulting to 'conversational' so all
existing call sites are unchanged."
```

---

### Task 5: Fix the malformed call-update announcement

**Why:** `announceCallUpdate` builds `` `Update on call ${callNumber}. ${updateType}...` `` and
**14 of its 16 call sites pass `''` as `callNumber`**, using it as a generic "speak this text"
channel. Production says *"Update on call . 5 units active…"* — the announcer stops dead on a
stray period, then reads unrelated text. Measured chain length 6.2 s.

Two separate uses need two separate functions. Decided phrasing: bare **`"Call updated."`**
(1.4 s total chain).

**Files:**
- Modify: `client/src/utils/voiceAlerts.ts:1204-1215` (`announceCallUpdate`), add
  `speakDispatcherResponse`
- Modify: `client/src/pages/dispatch/DispatchPage.tsx` (14 call sites + the import on line 75)
- Create: `client/src/utils/__tests__/callUpdatePhrasing.test.ts`

**Interfaces:**
- Consumes: `VoicePhrase { text, mode? }` from Task 4.
- Produces:
  - `announceCallUpdate(callNumber: string, updateType: string, author?: string): Promise<void>`
    — signature unchanged for compatibility; now emits exactly `"Call updated."`
  - `speakDispatcherResponse(text: string): Promise<void>` — new; speaks `text` verbatim with
    no prefix, for dispatcher tool-query readbacks.

- [ ] **Step 1: Write the failing test**

Create `client/src/utils/__tests__/callUpdatePhrasing.test.ts`:

```ts
// Pins the exact spoken output. The bug was a template that produced
// "Update on call . <unrelated text>" whenever callNumber was empty —
// which was 14 of 16 call sites.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const spoken: string[] = [];
const speakMock = vi.fn((text: string) => { spoken.push(text); return Promise.resolve(); });
vi.mock('../edgeTTS', () => ({
  speak: (...a: unknown[]) => speakMock(a[0] as string),
  isEdgeTTSEnabled: () => true,
  getEdgeTTSPayload: () => ({}),
}));

describe('call update phrasing', () => {
  beforeEach(() => { spoken.length = 0; speakMock.mockClear(); localStorage.clear(); });

  it('says exactly "Call updated." regardless of arguments', async () => {
    const va = await import('../voiceAlerts');
    await va.announceCallUpdate('26-CFS00110', 'New note added', 'Zamora');
    await new Promise((r) => setTimeout(r, 30));
    expect(spoken).toEqual(['Call updated.']);
  });

  it('never emits the old malformed "Update on call ." text', async () => {
    const va = await import('../voiceAlerts');
    await va.announceCallUpdate('', '5 units active. 2 available.');
    await new Promise((r) => setTimeout(r, 30));
    expect(spoken.join(' ')).not.toContain('Update on call');
    expect(spoken.join(' ')).not.toMatch(/\s\./); // no space-before-period
  });

  it('speakDispatcherResponse speaks its text verbatim with no prefix', async () => {
    const va = await import('../voiceAlerts');
    await va.speakDispatcherResponse('5 units active. 2 available, 1 en route.');
    await new Promise((r) => setTimeout(r, 30));
    expect(spoken).toEqual(['5 units active. 2 available, 1 en route.']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/__tests__/callUpdatePhrasing.test.ts`
Expected: FAIL — first test gets `"Update on call 26-CFS00110. New note added by Zamora."`;
third test fails with `speakDispatcherResponse is not a function`.

- [ ] **Step 3: Rewrite the function and add the sibling**

Replace `announceCallUpdate` in `client/src/utils/voiceAlerts.ts` (line 1204):

```ts
/**
 * Announce that a call changed. Deliberately bare — the audio is an
 * ATTENTION CUE, not a data channel; the dispatcher reads detail off the
 * screen. Total chain is ~1.4s (110ms info tone + 400ms gap + 0.8s voice).
 *
 * Arguments are kept for call-site compatibility but are NOT spoken. Until
 * 2026-07-31 this built `Update on call ${callNumber}. ${updateType}`, and
 * 14 of 16 call sites passed callNumber = '' while using it as a generic
 * "speak this text" channel — so production said "Update on call ." then
 * read unrelated text. Those call sites now use speakDispatcherResponse().
 */
export async function announceCallUpdate(callNumber: string, updateType: string, author?: string): Promise<void> {
  if (!isVoiceEnabled() || !isAudioAvailable()) return;

  // Dedup still keys on the detail so repeated identical updates stay quiet.
  const dedupKey = `callupdate:${callNumber}:${updateType}`;
  if (wasRecentlyAnnounced(dedupKey)) return;
  markAnnounced(dedupKey);

  void author; // intentionally unspoken — see doc comment
  enqueuePhrases([{ text: 'Call updated.' }]);
}

/**
 * Speak a dispatcher tool-query readback verbatim — unit counts, weather,
 * priority breakdowns, stacked-call checks. No prefix, no dedup: these are
 * direct answers to an operator action, so repetition is intentional.
 */
export async function speakDispatcherResponse(text: string): Promise<void> {
  if (!isVoiceEnabled() || !isAudioAvailable()) return;
  const trimmed = text.trim();
  if (!trimmed) return;
  enqueuePhrases([{ text: trimmed }]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/__tests__/callUpdatePhrasing.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Repoint the 14 generic call sites**

In `client/src/pages/dispatch/DispatchPage.tsx`, add `speakDispatcherResponse` to the import on
line 75. Then change **every** `announceCallUpdate('', ...)` call — the ones passing an empty
first argument — to `speakDispatcherResponse(...)` with just the text.

Find them with:

```bash
grep -n "announceCallUpdate('', " client/src/pages/dispatch/DispatchPage.tsx
```

Expected: 14 matches at approximately lines 7133, 7150, 7157, 7159, 7202, 7204, 7248, 7264,
7267, 7278, 7285, 7288, 7299 (one line has two). Each becomes, for example:

```ts
// before
announceCallUpdate('', `Unit ${unit.call_sign} is currently ${statusLabel}`);
// after
speakDispatcherResponse(`Unit ${unit.call_sign} is currently ${statusLabel}`);
```

**Leave the two real call-update sites alone** — lines ~1266 and ~1311, which pass a genuine
`call_number`:

```ts
announceCallUpdate(mapped.call_number, 'New note added', data.author);
announceCallUpdate(data.call_number, `Multiple units dispatched: ${unitList}`);
```

- [ ] **Step 6: Verify no generic call sites remain**

Run: `grep -c "announceCallUpdate('', " client/src/pages/dispatch/DispatchPage.tsx`
Expected: `0`

Run: `grep -c "announceCallUpdate(" client/src/pages/dispatch/DispatchPage.tsx`
Expected: `3` — the two real sites plus the import line.

- [ ] **Step 7: Typecheck and run the full client suite**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: 0 type errors; all tests pass.

- [ ] **Step 8: Commit**

```bash
git add client/src/utils/voiceAlerts.ts client/src/pages/dispatch/DispatchPage.tsx client/src/utils/__tests__/callUpdatePhrasing.test.ts
git commit -m "fix(voice): stop announcing \"Update on call .\"

announceCallUpdate built 'Update on call \${callNumber}. \${updateType}'
and 14 of its 16 call sites passed callNumber = '', using it as a generic
speak-this-text channel. Production said 'Update on call .' then read
unrelated text — 6.2s of it.

Split into two functions: announceCallUpdate now says exactly 'Call
updated.' (1.4s chain — the audio is an attention cue, not a data
channel), and the 14 tool-query readbacks moved to the new
speakDispatcherResponse() which speaks its text verbatim with no prefix.

Tests pin the exact spoken string and assert the malformed text can no
longer be produced."
```

---

### Task 6: Give notification alerts a voice

**Why:** `notificationTones.ts` plays a tone and stops — there is no speech on any
notification. This adds the automated PA voice, mutable independently of the tone.

**Files:**
- Modify: `client/src/utils/voiceAlerts.ts` (add `'notification'` to `VoiceEventCategory`,
  add `announceNotification`)
- Modify: `client/src/utils/notificationTones.ts` (speak after the tone)
- Create: `client/src/utils/__tests__/notificationVoice.test.ts`

**Interfaces:**
- Consumes: `VoicePhrase { text, mode? }` (Task 4); `buildPaVoiceChain` routing via
  `'alert_pa'` (Task 3).
- Produces:
  - `VoiceEventCategory = 'new_call' | 'panic' | 'bolo' | 'status' | 'notification'`
  - `announceNotification(priority: string | undefined, detail: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `client/src/utils/__tests__/notificationVoice.test.ts`:

```ts
// Notification alerts had no speech at all. This pins the phrasing per
// priority, the PA voice mode, and that muting speech does NOT mute the tone.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: Array<{ text: string; mode: string }> = [];
vi.mock('../edgeTTS', () => ({
  speak: (text: string, _sev: unknown, mode: string) => { calls.push({ text, mode }); return Promise.resolve(); },
  isEdgeTTSEnabled: () => true,
  getEdgeTTSPayload: () => ({}),
}));
const playSound = vi.fn();
vi.mock('../dispatchTones', () => ({ playSound, playToneAsync: vi.fn().mockResolvedValue(undefined) }));

describe('notification voice', () => {
  beforeEach(() => { calls.length = 0; playSound.mockClear(); localStorage.clear(); });

  it('prefixes critical with "Critical alert." and keeps the detail', async () => {
    const va = await import('../voiceAlerts');
    await va.announceNotification('critical', 'Officer down, unit S19.');
    await new Promise((r) => setTimeout(r, 30));
    expect(calls[0].text).toBe('Critical alert. Officer down, unit S19.');
  });

  it('prefixes high with "High priority."', async () => {
    const va = await import('../voiceAlerts');
    await va.announceNotification('high', 'Warrant hit on John Meyers.');
    await new Promise((r) => setTimeout(r, 30));
    expect(calls[0].text).toBe('High priority. Warrant hit on John Meyers.');
  });

  it('speaks normal priority with no prefix — the tone already says "something happened"', async () => {
    const va = await import('../voiceAlerts');
    await va.announceNotification('normal', 'Call 26-CFS00110 assigned to unit S19.');
    await new Promise((r) => setTimeout(r, 30));
    expect(calls[0].text).toBe('Call 26-CFS00110 assigned to unit S19.');
  });

  it('speaks through the alert_pa chain, not the radio chain', async () => {
    const va = await import('../voiceAlerts');
    await va.announceNotification('critical', 'Officer down.');
    await new Promise((r) => setTimeout(r, 30));
    expect(calls[0].mode).toBe('alert_pa');
  });

  it('stays silent when the notification category is muted', async () => {
    const va = await import('../voiceAlerts');
    va.setEventEnabled('notification', false);
    await va.announceNotification('critical', 'Officer down.');
    await new Promise((r) => setTimeout(r, 30));
    expect(calls.length).toBe(0);
  });

  it('still plays the TONE when only the voice is muted', async () => {
    const nt = await import('../notificationTones');
    const va = await import('../voiceAlerts');
    va.setEventEnabled('notification', false);
    nt.playNotificationTone('critical', 'Officer down.');
    await new Promise((r) => setTimeout(r, 30));
    expect(playSound).toHaveBeenCalledWith('emergency_three');
    expect(calls.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/__tests__/notificationVoice.test.ts`
Expected: FAIL — `announceNotification is not a function`.

- [ ] **Step 3: Add the category and the announcement**

In `client/src/utils/voiceAlerts.ts`:

1. Line 253 — extend the union:

```ts
export type VoiceEventCategory = 'new_call' | 'panic' | 'bolo' | 'status' | 'notification';
```

2. Line 255 — add the key to `EVENT_KEYS`:

```ts
const EVENT_KEYS: Record<VoiceEventCategory, string> = {
  new_call:     'rmpg-voice-ev-new-call',
  panic:        'rmpg-voice-ev-panic',
  bolo:         'rmpg-voice-ev-bolo',
  status:       'rmpg-voice-ev-status',
  notification: 'rmpg-voice-ev-notification',
};
```

3. Add the function near the other `announce*` exports:

```ts
/**
 * Speak a notification alert through the automated station-PA voice.
 *
 * Called by notificationTones.playNotificationTone AFTER its tone, so the
 * operator hears tone-then-speech. Muting the 'notification' category
 * silences the speech only — the tone is governed by the separate
 * rmpg_notification_sounds_<user-id> preference, so an operator can keep
 * the tone and drop the speech.
 *
 * Prefixes carry priority because an operator may not be looking at the
 * screen. 'normal' gets no prefix: the info pip already means "something
 * happened", so a prefix would be noise.
 */
export async function announceNotification(priority: string | undefined, detail: string): Promise<void> {
  if (!isVoiceEnabled() || !isAudioAvailable()) return;
  if (!isEventEnabled('notification')) return;

  const text = detail.trim();
  if (!text) return;

  const prefix = priority === 'critical' ? 'Critical alert. '
    : priority === 'high' ? 'High priority. '
    : '';

  enqueuePhrases([{ text: `${prefix}${text}`, mode: 'alert_pa' }]);
}
```

- [ ] **Step 4: Call it from notificationTones.ts**

In `client/src/utils/notificationTones.ts`, replace `playNotificationTone` with a version that
takes an optional detail and speaks it after the tone. Keep the existing tone mapping exactly:

```ts
/**
 * Play the notification tone and, when a detail string is supplied, follow
 * it with the automated station-PA voice.
 *
 * The tone honours rmpg_notification_sounds_<user-id> (this module's own
 * toggle). The SPEECH honours the 'notification' VoiceEventCategory, so the
 * two are independently mutable. Tone mapping is unchanged:
 *   critical → emergency_three (Motorola emergency warble)
 *   high     → alert           (P25 three-pip)
 *   normal   → info            (MDT acknowledge pip)
 */
export function playNotificationTone(priority?: string, detail?: string): void {
  if (!isNotificationSoundEnabled()) return;
  try {
    if (priority === 'critical') playSound('emergency_three');
    else if (priority === 'high') playSound('alert');
    else playSound('info');
  } catch { /* audio is a nicety */ }

  // Voice is additive and independently gated — a tone failure must not
  // suppress the announcement, and vice versa.
  if (detail && detail.trim()) {
    void import('./voiceAlerts')
      .then((m) => m.announceNotification(priority, detail))
      .catch(() => { /* voice module unavailable; tone already played */ });
  }
}
```

> The dynamic import mirrors the existing pattern in `voiceAlerts.ts` (`speakPhrase` imports
> `edgeTTS` dynamically) and avoids a static `notificationTones → voiceAlerts` cycle, since
> `voiceAlerts` already imports `playSound` from `dispatchTones`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/__tests__/notificationVoice.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Check existing callers still compile**

`playNotificationTone` gained an optional second parameter, so existing one-argument calls are
still valid. Confirm and see which could pass detail:

```bash
grep -rn "playNotificationTone(" client/src --include=*.ts --include=*.tsx | grep -v notificationTones.ts
```

Passing detail at those sites is **not** part of this task — the plumbing lands first, silent
by default. Note the call sites in the PR body as follow-up.

- [ ] **Step 7: Typecheck and run the full client suite**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: 0 type errors; all tests pass. `notificationRouting.test.ts` exists — if it asserts
the old one-argument signature, update it.

- [ ] **Step 8: Commit**

```bash
git add client/src/utils/voiceAlerts.ts client/src/utils/notificationTones.ts client/src/utils/__tests__/notificationVoice.test.ts
git commit -m "feat(voice): speak notification alerts in the automated PA voice

notificationTones played a tone and stopped — no notification had any
speech. playNotificationTone now takes an optional detail string and
follows the tone with announceNotification(), which speaks through the
alert_pa station-PA chain so a system alert never sounds like a
dispatcher transmission.

Prefixes carry priority for eyes-off operation ('Critical alert.',
'High priority.'); normal gets none because the info pip already means
'something happened'. Tone mapping is unchanged.

Speech is gated by a new 'notification' VoiceEventCategory, separate from
the tone's own preference, so the two are independently mutable."
```

---

### Task 7: Fix the melotts content-type mislabel

**Why:** Found while probing for the alert voice: `@cf/myshell-ai/melotts` returns **WAV**, but
`tts.ts:51`'s comment says "melotts output → raw MP3 bytes" and `audioResponse()` serves it as
`audio/mpeg`. It works today only because `decodeAudioData()` sniffs the container and ignores
the header — anything that trusted the content-type would break. Small, real, and independent
of the voice work.

**Files:**
- Modify: `src/routes/tts.ts` (comment at ~line 51, `audioResponse` signature and callers)
- Create: `tests/ttsContentType.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `audioResponse(bytes: Uint8Array, cache: 'HIT' | 'MISS', engine: string, contentType?: string): Response`
  — new optional 4th parameter, defaulting to `'audio/mpeg'` so Aura-2 callers are unchanged.

- [ ] **Step 1: Write the failing test**

Create `tests/ttsContentType.test.ts`:

```ts
// melotts returns WAV, not MP3. Serving it as audio/mpeg works only because
// decodeAudioData sniffs the container; the header is a lie and would break
// any consumer that trusted it.
import { describe, it, expect } from 'vitest';

/** Sniff a real container from magic bytes. */
export function sniffAudio(bytes: Uint8Array): 'wav' | 'mp3' | 'unknown' {
  const a = (i: number) => bytes[i];
  if (bytes.length > 12
    && a(0) === 0x52 && a(1) === 0x49 && a(2) === 0x46 && a(3) === 0x46   // RIFF
    && a(8) === 0x57 && a(9) === 0x41 && a(10) === 0x56 && a(11) === 0x45 // WAVE
  ) return 'wav';
  if (bytes.length > 3 && a(0) === 0x49 && a(1) === 0x44 && a(2) === 0x33) return 'mp3'; // ID3
  if (bytes.length > 2 && a(0) === 0xff && (a(1) & 0xe0) === 0xe0) return 'mp3';         // frame sync
  return 'unknown';
}

function wavBytes(): Uint8Array {
  const b = new Uint8Array(16);
  b.set([0x52, 0x49, 0x46, 0x46], 0);  // RIFF
  b.set([0x57, 0x41, 0x56, 0x45], 8);  // WAVE
  return b;
}
function mp3Bytes(): Uint8Array {
  return new Uint8Array([0xff, 0xfb, 0x90, 0x00, 0, 0, 0, 0]);
}

describe('tts content type', () => {
  it('sniffs WAV and MP3 correctly', () => {
    expect(sniffAudio(wavBytes())).toBe('wav');
    expect(sniffAudio(mp3Bytes())).toBe('mp3');
  });

  it('maps a sniffed container to the right content-type', async () => {
    const { contentTypeFor } = await import('../src/routes/tts');
    expect(contentTypeFor(wavBytes())).toBe('audio/wav');
    expect(contentTypeFor(mp3Bytes())).toBe('audio/mpeg');
    // Unknown falls back to mpeg — the historical behaviour, never silent.
    expect(contentTypeFor(new Uint8Array([1, 2, 3, 4]))).toBe('audio/mpeg');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ttsContentType.test.ts`
Expected: FAIL — `contentTypeFor` is not exported from `src/routes/tts.ts`.

- [ ] **Step 3: Add the sniffer and use it**

In `src/routes/tts.ts`:

1. Fix the wrong comment at ~line 51:

```ts
// base64 (melotts output) → raw audio bytes. NOTE: melotts returns WAV,
// not MP3 — verified live 2026-07-31. This comment previously claimed MP3,
// and the response was served as audio/mpeg regardless; it only worked
// because the client's decodeAudioData() sniffs the container. Use
// contentTypeFor() so the header matches the actual bytes.
```

2. Add the exported helper next to it:

```ts
/**
 * Content-type from the actual container bytes rather than an assumption.
 * Aura-2 returns MP3; melotts returns WAV. Unknown input falls back to
 * audio/mpeg — the historical behaviour, so a new model never 500s here.
 */
export function contentTypeFor(bytes: Uint8Array): 'audio/wav' | 'audio/mpeg' {
  if (bytes.length > 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45
  ) return 'audio/wav';
  return 'audio/mpeg';
}
```

3. Give `audioResponse` an optional content-type and use it. Find the existing definition at
~line 59 and add the parameter:

```ts
function audioResponse(
  bytes: Uint8Array,
  cache: 'HIT' | 'MISS',
  engine: string,
  contentType: string = 'audio/mpeg',
): Response {
```

Inside it, replace the hardcoded `'audio/mpeg'` in the headers with `contentType`.

4. At the final `return audioResponse(bytes, 'MISS', engine);` (~line 157), pass the sniffed
type:

```ts
  return audioResponse(bytes, 'MISS', engine, contentTypeFor(bytes));
```

5. Leave the two cache-HIT returns as-is unless the cached bytes are also sniffed — if you
want them correct too, pass `contentTypeFor(new Uint8Array(cached))` there as well. Do it;
it's one expression and the cache can hold melotts audio.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ttsContentType.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Run Worker typecheck, unit and integration suites**

Run: `npm run typecheck && npx vitest run && npm run test:worker`
Expected: 0 type errors; all suites pass.

- [ ] **Step 6: Commit**

```bash
git add src/routes/tts.ts tests/ttsContentType.test.ts
git commit -m "fix(tts): serve the content-type the bytes actually are

melotts returns WAV, not MP3 — verified live against
@cf/myshell-ai/melotts. tts.ts claimed 'melotts output → raw MP3 bytes'
in a comment and audioResponse() served everything as audio/mpeg. It
worked only because the client's decodeAudioData() sniffs the container
and ignores the header, so any consumer that trusted the content-type
would have broken.

Adds contentTypeFor() which sniffs RIFF/WAVE and passes the real type
through, including on cache hits. Unknown containers still fall back to
audio/mpeg so a future model never 500s here."
```

---

### Task 8: Verify the whole path end to end in a real browser

**Why:** Every previous task used mocked WebAudio. jsdom has no audio engine, so nothing so far
proves the PA chain actually sounds different from the radio chain, or that dispatch traffic
still speaks. This task is manual verification with recorded evidence.

**Files:**
- Modify: `docs/superpowers/specs/2026-07-30-system-audio-and-dispatch-voice-design.md`
  (record results)

- [ ] **Step 1: Start the dev servers**

```bash
cd client && npm run dev
```

In a second shell: `npm run dev` (wrangler on 8787). Log in with a real account so `/api/tts`
has a JWT — the endpoint is `auth: 'required'` (`src/routesConfig.ts:613`).

- [ ] **Step 2: Confirm the picker now works**

Open Settings → voice persona. Confirm the list shows Aura-2 names (`Harmonia`, `Hera`,
`Asteria`, …) and **not** `Jenny`/`Aria`/`Guy`. Select `Zeus`, trigger any voice alert, and
confirm you hear a **male** voice. Before this change every selection played female.

- [ ] **Step 3: Compare the two chains by ear**

In the browser console:

```js
const { speak } = await import('/src/utils/edgeTTS.ts');
await speak('Critical alert. Officer down, unit S19.', undefined, 'conversational'); // radio
await new Promise(r => setTimeout(r, 1500));
await speak('Critical alert. Officer down, unit S19.', undefined, 'alert_pa');       // PA
```

Expected: the first has a P25 key-up chirp, band-limited radio character, faint hiss, and a
squelch tail. The second has **none of those** — no chirp, no hiss, no tail — and sounds boxy
and forward, like a ceiling speaker. If the second still chirps or hisses, the `isPa` guards in
Task 3 Step 5 were not applied to every stage.

- [ ] **Step 4: Confirm the call-update fix**

Trigger a dispatcher tool query that used to route through `announceCallUpdate('', …)` — e.g.
the unit-status or priority-breakdown readback on `DispatchPage`. Expected: it reads the text
directly with **no** "update on call" preamble and no stray pause. Then add a note to a call and
confirm you hear exactly **"Call updated."**

- [ ] **Step 5: Confirm notification speech and independent muting**

```js
const nt = await import('/src/utils/notificationTones.ts');
nt.playNotificationTone('critical', 'Officer down, unit S19, 3392 Mockingbird Way.');
```

Expected: `emergency_three` warble, then the PA voice. Then:

```js
const va = await import('/src/utils/voiceAlerts.ts');
va.setEventEnabled('notification', false);
nt.playNotificationTone('critical', 'Officer down.');
```

Expected: tone **only**, no speech. Re-enable with `va.setEventEnabled('notification', true)`.

- [ ] **Step 6: Record the results in the spec**

Add a short "Phase 1 verification 2026-XX-XX" block to the spec stating what was heard for each
of steps 2–5, and the two `harmonia` announcement durations from Task 2 Step 5. **State plainly
if anything did not work** rather than recording a pass.

- [ ] **Step 7: Run every gate serially**

```bash
npm run typecheck
npx vitest run
npm run test:worker
cd client && npx tsc --noEmit
cd client && npx vitest run
cd client && npx vite build
```

Never run root and client vitest concurrently — it fakes ~9 failures.

- [ ] **Step 8: Commit and open the PR**

```bash
git add docs/superpowers/specs/2026-07-30-system-audio-and-dispatch-voice-design.md
git commit -m "docs: record Phase 1 voice verification results"
git push -u origin HEAD
gh pr create -R rmpgutah/rmpg-flex --title "fix(voice): repair the voice picker, call-update phrasing, and add the automated PA alert voice" --body "$(cat <<'EOF'
## What

Phase 1 of the system-audio spec — three live defects plus the automated alert voice.

**Defects fixed**
1. **The voice picker did nothing.** `voiceCatalog.ts` offered 14 Microsoft Edge-TTS ids left
   over from the pre-Aura server. None are valid Aura-2 speakers, so `resolveAura2Voice()`
   coerced every selection to the default — and picking a male voice played a female one.
2. **`"Update on call ."`** — `announceCallUpdate` built a template around a call number that
   14 of its 16 call sites passed as `''`, so production announced "update on call", stopped on
   a stray period, then read unrelated text. 6.2 s of it.
3. **melotts content-type mislabel** — it returns WAV while the code claimed MP3 and served
   `audio/mpeg`. Worked only because `decodeAudioData()` sniffs.

**Added**
- `harmonia` is the Dispatch voice (measured fastest of the 23 female-register speakers, 5.3 s
  vs asteria's 8.4 s; tied best P25-band intelligibility at 90.4% RMS retained).
- An automated **station-PA** alert voice: the *same* harmonia request through a different
  client-side DSP chain, so no second TTS engine, no server change, and cached audio is
  reusable across both roles. `alert_pa` also skips the P25 key-up, noise bed, and squelch
  tail — a PA announcement is not radio traffic.
- Notification alerts speak for the first time, mutable independently of their tone.

## Out of scope

- Every tone in `dispatchTones.ts` is untouched. `client/public/sounds/` is untouched.
- **Phase 2** (the 9 system/UI sounds) — blocked on an undecided fidelity direction.
- **The panic-mute policy** — an operator can still silence officer-down announcements.
  That is a policy decision; `isEventEnabled()` is unchanged here.
- **Terseness policy** — the spec's timings were re-measured against harmonia (≈37% faster),
  but no terseness code changed.

## Verification

All gates run serially: Worker typecheck + vitest + Miniflare, client typecheck + vitest +
build. Manual browser verification of both voice chains, the picker, the call-update phrasing,
and independent notification muting — results recorded in the spec.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**1. Spec coverage**

| Spec § | Requirement | Task |
|---|---|---|
| 4.1 | Fix the voice picker | Task 1 |
| §8.5 | `harmonia` as Dispatch voice | Task 2 |
| 4.2 | Call-update phrasing + split the two uses | Task 5 |
| 4.3 | Notification voice + `notification` category | Task 6 |
| 4.4 | Terseness — **deliberately not implemented**; re-measured only | Task 2 Step 5, and stated in Out of Scope |
| §8.6 | Alert voice = harmonia + PA chain; `VoicePhrase.mode`; no `/api/tts` change | Tasks 3, 4, 6 |
| §7 | melotts WAV/MP3 mislabel | Task 7 |
| §5 | Phase 2 system sounds | **Not covered — out of scope, blocked on the fidelity decision** |
| §8.2 | Panic-mute policy | **Not covered — policy decision, stated in Out of Scope** |
| §6 | Testing table | Tasks 1, 3, 4, 5, 6, 7 each ship their tests; Task 8 is the manual gate |

Two spec sections are deliberately uncovered and both are named in Out of Scope with reasons.

**2. Placeholder scan** — no TBD/TODO/"handle edge cases"/"similar to Task N". Every code step
has real code. Task 5 Step 5 gives the grep command and expected match count rather than
listing 14 near-identical edits, and shows the before/after shape.

**3. Type consistency**

- `VoiceMode` — defined Task 3, consumed Tasks 4 and 6 as `'alert_pa'`. Consistent.
- `VoicePhrase { text, mode? }` — defined Task 4, consumed Task 6. Consistent.
- `buildPaVoiceChain(ctx) → RadioChainNodes` — defined Task 3, consumed Task 3 Step 5.
- `VoiceEventCategory` — extended Task 6; `EVENT_KEYS` updated in the same step, so the
  `Record<VoiceEventCategory, string>` stays exhaustive.
- `announceCallUpdate` keeps its 3-arg signature (Task 5), so the two surviving call sites need
  no edit.
- `contentTypeFor(bytes) → 'audio/wav' | 'audio/mpeg'` and `audioResponse(..., contentType?)` —
  both defined Task 7 and used only there.
- `__speakPhraseForTest` — introduced Task 4, used only by Task 4's test.

One inconsistency found and fixed while reviewing: Task 6's test originally called
`playNotificationTone('critical')` with one argument while asserting speech; the tone-only
assertion now passes the detail string explicitly so the test matches the two-argument
signature the task introduces.
