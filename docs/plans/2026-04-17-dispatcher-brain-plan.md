# Dispatcher Brain Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship a unified, rule-based "Dispatcher Brain" that adds proactive coaching, broader event voice coverage, multi-turn conversational dialog, and per-user voice personas on top of the existing voice stack.

**Architecture:** A new `client/src/utils/dispatcherBrain.ts` module orchestrates existing primitives (`voiceChannel`, `voiceAlerts`, `edgeTTS`, `conversationMemory`). Pure rule-based, no LLM. A single prioritized speak-queue enforces cooldowns and severity preemption. Four phases land behind a `voice_brain_enabled` user flag so each deploy is independently revertable.

**Tech Stack:** React 18 + TypeScript + Vite (client), Express 5 + better-sqlite3 (server), Edge-TTS neural voices, WebSocket (ws), vitest on both sides. See `docs/plans/2026-04-17-dispatcher-brain-design.md` for the full design.

---

## Phase 1 — Persona + Terseness + Transcript Pane

Ships independently. Adds user-facing voice customization and the ARIA-capable transcript drawer; no brain/rules yet.

---

### Task 1.1: DB migration for voice persona columns

**Files:**
- Modify: `server/src/models/database.ts` (add after the last `addCol('users', ...)` line — search for `addCol('users',` and append)

**Step 1: Add the three addCol calls**

Locate the block of `addCol('users', ...)` calls in `database.ts` and append:

```ts
addCol('users', 'voice_persona', "TEXT DEFAULT 'en-US-JennyNeural'");
addCol('users', 'voice_rate', 'REAL DEFAULT 1.0');
addCol('users', 'voice_pitch', 'REAL DEFAULT 0');
addCol('users', 'voice_terseness', "TEXT DEFAULT 'standard'");
```

**Step 2: Verify migration runs cleanly**

Run: `cd server && npx tsx -e "import('./src/models/database').then(m => { m.initDb(); console.log('OK'); })"`
Expected: `OK` and no errors. A second run should also succeed (idempotent).

**Step 3: Commit**

```bash
git add server/src/models/database.ts
git commit -m "feat(voice): add persona/rate/pitch/terseness columns to users"
```

---

### Task 1.2: Server endpoint for reading/updating persona

**Files:**
- Create: `server/src/routes/voicePersona.ts`
- Modify: `server/src/index.ts` (mount the route — search for the existing `app.use('/api/voice'` mount and add the new one nearby)
- Test: `server/src/routes/__tests__/voicePersona.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../../index';
import { signTestToken } from '../../../tests/helpers/auth';

describe('voicePersona route', () => {
  let token: string;
  beforeAll(() => { token = signTestToken({ id: 1, role: 'officer' }); });

  it('GET /api/voice-persona returns defaults', async () => {
    const res = await request(app).get('/api/voice-persona').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.voice_persona).toBe('en-US-JennyNeural');
    expect(res.body.voice_terseness).toBe('standard');
  });

  it('PUT /api/voice-persona updates fields', async () => {
    const res = await request(app)
      .put('/api/voice-persona')
      .set('Authorization', `Bearer ${token}`)
      .send({ voice_persona: 'en-US-GuyNeural', voice_terseness: 'terse', voice_rate: 1.1 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('PUT rejects invalid voice_terseness', async () => {
    const res = await request(app)
      .put('/api/voice-persona')
      .set('Authorization', `Bearer ${token}`)
      .send({ voice_terseness: 'screamy' });
    expect(res.status).toBe(400);
  });
});
```

**Step 2: Run to verify FAIL**

Run: `cd server && npx vitest run src/routes/__tests__/voicePersona.test.ts`
Expected: FAIL ("Cannot find module").

**Step 3: Implement `voicePersona.ts`**

```ts
import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken } from '../middleware/auth';

const router = Router();
router.use(authenticateToken);

const VALID_TERSENESS = new Set(['narrative', 'standard', 'terse']);

router.get('/', (req: Request, res: Response) => {
  const db = getDb();
  const row = db.prepare(
    'SELECT voice_persona, voice_rate, voice_pitch, voice_terseness FROM users WHERE id = ?'
  ).get((req as any).user.id);
  res.json(row ?? {});
});

router.put('/', (req: Request, res: Response) => {
  const { voice_persona, voice_rate, voice_pitch, voice_terseness } = req.body ?? {};
  if (voice_terseness != null && !VALID_TERSENESS.has(voice_terseness)) {
    return res.status(400).json({ error: 'invalid voice_terseness' });
  }
  if (voice_rate != null && (voice_rate < 0.7 || voice_rate > 1.4)) {
    return res.status(400).json({ error: 'voice_rate out of range' });
  }
  if (voice_pitch != null && (voice_pitch < -20 || voice_pitch > 20)) {
    return res.status(400).json({ error: 'voice_pitch out of range' });
  }
  const db = getDb();
  const sets: string[] = [];
  const vals: any[] = [];
  for (const [k, v] of Object.entries({ voice_persona, voice_rate, voice_pitch, voice_terseness })) {
    if (v !== undefined) { sets.push(`${k} = ?`); vals.push(v); }
  }
  if (sets.length === 0) return res.json({ success: true });
  vals.push((req as any).user.id);
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  res.json({ success: true });
});

export default router;
```

Mount in `server/src/index.ts` next to the `app.use('/api/voice', ...)` line:

```ts
import voicePersonaRouter from './routes/voicePersona';
app.use('/api/voice-persona', voicePersonaRouter);
```

**Step 4: Run to verify PASS**

Run: `cd server && npx vitest run src/routes/__tests__/voicePersona.test.ts`
Expected: 3 tests pass.

**Step 5: Commit**

```bash
git add server/src/routes/voicePersona.ts server/src/index.ts server/src/routes/__tests__/voicePersona.test.ts
git commit -m "feat(voice): persona read/write API endpoint"
```

---

### Task 1.3: Client persona store hook

**Files:**
- Create: `client/src/hooks/useVoicePersona.ts`
- Test: `client/src/hooks/__tests__/useVoicePersona.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useVoicePersona } from '../useVoicePersona';

vi.mock('../useApi', () => ({
  apiFetch: vi.fn(async (path: string) => {
    if (path === '/api/voice-persona') return { voice_persona: 'en-US-JennyNeural', voice_rate: 1.0, voice_pitch: 0, voice_terseness: 'standard' };
    return {};
  }),
}));

describe('useVoicePersona', () => {
  beforeEach(() => { localStorage.clear(); });

  it('loads from server and writes through to localStorage', async () => {
    const { result } = renderHook(() => useVoicePersona());
    await waitFor(() => expect(result.current.persona.voiceId).toBe('en-US-JennyNeural'));
    expect(localStorage.getItem('rmpg-voice-persona')).toBe('en-US-JennyNeural');
  });

  it('optimistically updates localStorage on setPersona', async () => {
    const { result } = renderHook(() => useVoicePersona());
    await waitFor(() => expect(result.current.persona).toBeDefined());
    act(() => { result.current.setPersona({ terseness: 'terse' }); });
    expect(localStorage.getItem('rmpg-voice-terseness')).toBe('terse');
  });
});
```

**Step 2: Run to verify FAIL**

Run: `cd client && npx vitest run src/hooks/__tests__/useVoicePersona.test.ts`
Expected: FAIL (module not found).

**Step 3: Implement `useVoicePersona.ts`**

```ts
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from './useApi';

export interface VoicePersona {
  voiceId: string;
  rate: number;
  pitch: number;
  terseness: 'narrative' | 'standard' | 'terse';
}

const LS = {
  voiceId:   'rmpg-voice-persona',
  rate:      'rmpg-voice-rate',
  pitch:     'rmpg-voice-pitch',
  terseness: 'rmpg-voice-terseness',
};

const DEFAULT: VoicePersona = { voiceId: 'en-US-JennyNeural', rate: 1.0, pitch: 0, terseness: 'standard' };

function readLocal(): VoicePersona {
  return {
    voiceId:   localStorage.getItem(LS.voiceId)   ?? DEFAULT.voiceId,
    rate:      Number(localStorage.getItem(LS.rate)  ?? DEFAULT.rate),
    pitch:     Number(localStorage.getItem(LS.pitch) ?? DEFAULT.pitch),
    terseness: (localStorage.getItem(LS.terseness) as VoicePersona['terseness']) ?? DEFAULT.terseness,
  };
}

function writeLocal(p: Partial<VoicePersona>) {
  if (p.voiceId   !== undefined) localStorage.setItem(LS.voiceId, p.voiceId);
  if (p.rate      !== undefined) localStorage.setItem(LS.rate, String(p.rate));
  if (p.pitch     !== undefined) localStorage.setItem(LS.pitch, String(p.pitch));
  if (p.terseness !== undefined) localStorage.setItem(LS.terseness, p.terseness);
}

export function useVoicePersona() {
  const [persona, setPersonaState] = useState<VoicePersona>(readLocal);

  useEffect(() => {
    apiFetch<any>('/api/voice-persona').then((row) => {
      if (!row) return;
      const next: VoicePersona = {
        voiceId:   row.voice_persona ?? DEFAULT.voiceId,
        rate:      row.voice_rate    ?? DEFAULT.rate,
        pitch:     row.voice_pitch   ?? DEFAULT.pitch,
        terseness: row.voice_terseness ?? DEFAULT.terseness,
      };
      writeLocal(next);
      setPersonaState(next);
    }).catch(() => {/* offline: keep localStorage */});
  }, []);

  const setPersona = useCallback((patch: Partial<VoicePersona>) => {
    const next = { ...readLocal(), ...patch };
    writeLocal(patch);
    setPersonaState(next);
    const serverPatch: any = {};
    if (patch.voiceId   !== undefined) serverPatch.voice_persona = patch.voiceId;
    if (patch.rate      !== undefined) serverPatch.voice_rate = patch.rate;
    if (patch.pitch     !== undefined) serverPatch.voice_pitch = patch.pitch;
    if (patch.terseness !== undefined) serverPatch.voice_terseness = patch.terseness;
    apiFetch('/api/voice-persona', { method: 'PUT', body: JSON.stringify(serverPatch) }).catch(() => {});
  }, []);

  return { persona, setPersona };
}
```

**Step 4: Run to verify PASS**

Run: `cd client && npx vitest run src/hooks/__tests__/useVoicePersona.test.ts`
Expected: 2 tests pass.

**Step 5: Commit**

```bash
git add client/src/hooks/useVoicePersona.ts client/src/hooks/__tests__/useVoicePersona.test.ts
git commit -m "feat(voice): useVoicePersona hook with server + localStorage sync"
```

---

### Task 1.4: Edge-TTS integration reads persona

**Files:**
- Modify: `client/src/utils/edgeTTS.ts` (find the `speak()` function, extend to use persona voice/rate/pitch)
- Test: `client/src/utils/__tests__/edgeTTS.persona.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getEdgeTTSPayload } from '../edgeTTS';

describe('edgeTTS persona', () => {
  beforeEach(() => { localStorage.clear(); });

  it('uses Jenny by default', () => {
    const payload = getEdgeTTSPayload('hello');
    expect(payload.voice).toBe('en-US-JennyNeural');
    expect(payload.rate).toBe(1.0);
  });

  it('uses persona from localStorage', () => {
    localStorage.setItem('rmpg-voice-persona', 'en-US-GuyNeural');
    localStorage.setItem('rmpg-voice-rate', '1.2');
    const payload = getEdgeTTSPayload('hello');
    expect(payload.voice).toBe('en-US-GuyNeural');
    expect(payload.rate).toBe(1.2);
  });
});
```

**Step 2: Run to verify FAIL**

Run: `cd client && npx vitest run src/utils/__tests__/edgeTTS.persona.test.ts`
Expected: FAIL (`getEdgeTTSPayload` not exported).

**Step 3: Extract & export `getEdgeTTSPayload` helper in `edgeTTS.ts`**

Add near the top, exported:

```ts
export function getEdgeTTSPayload(text: string): { text: string; voice: string; rate: number; pitch: number } {
  const voice = localStorage.getItem('rmpg-voice-persona') || 'en-US-JennyNeural';
  const rate  = Number(localStorage.getItem('rmpg-voice-rate')  ?? '1.0');
  const pitch = Number(localStorage.getItem('rmpg-voice-pitch') ?? '0');
  return { text, voice, rate, pitch };
}
```

Then inside the existing `speak()` body, replace the current `fetch` body builder with `JSON.stringify(getEdgeTTSPayload(text))`. Review `speak()` in `edgeTTS.ts` to find the right spot (around line 410).

**Step 4: Update the server `tts.ts` route to accept `rate`/`pitch`**

Open `server/src/routes/tts.ts`. The POST handler at line 49 currently reads `text` + `voice`. Extend the destructure to also read `rate` and `pitch` and forward to the `edge-tts-universal` call. Example (based on existing shape — verify):

```ts
const { text, voice = 'en-US-JennyNeural', rate = 1.0, pitch = 0 } = req.body ?? {};
// existing edge-tts call: pass rate as "+N%" / "-N%" formatted; consult edge-tts-universal README
```

Use context7 or the lib source if the rate/pitch parameter shape is unclear. The upstream API uses string params like `"+10%"`.

**Step 5: Run all voice tests**

Run: `cd client && npx vitest run src/utils/__tests__/ src/hooks/__tests__/useVoicePersona.test.ts`
Expected: all pass.

**Step 6: Commit**

```bash
git add client/src/utils/edgeTTS.ts client/src/utils/__tests__/edgeTTS.persona.test.ts server/src/routes/tts.ts
git commit -m "feat(voice): edgeTTS honors persona voice/rate/pitch from localStorage"
```

---

### Task 1.5: Terseness-aware narrative composer

**Files:**
- Create: `client/src/utils/narrativeRenderer.ts`
- Test: `client/src/utils/__tests__/narrativeRenderer.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { renderCallNarrative } from '../narrativeRenderer';

const CALL = {
  call_number: 'CN-26-0457',
  priority: 1,
  incident_type: 'domestic disturbance',
  location_address: '123 Main Street',
  apartment: '4B',
  zone_code: 'Delta-2',
  beat_code: '14',
  suspect_description: 'white male, 30s, black hoodie',
  assigned_units: ['3-Adam'],
};

describe('renderCallNarrative', () => {
  it('narrative mode includes all slot values', () => {
    const t = renderCallNarrative(CALL, 'narrative');
    expect(t).toContain('priority one');
    expect(t).toContain('domestic disturbance');
    expect(t).toContain('123 Main Street');
    expect(t).toContain('apartment 4B');
    expect(t).toContain('Delta-2');
    expect(t).toContain('suspect');
    expect(t).toContain('3-Adam');
  });

  it('standard mode drops description + apartment words', () => {
    const t = renderCallNarrative(CALL, 'standard');
    expect(t).toContain('P1 domestic');
    expect(t).toContain('123 Main');
    expect(t).toContain('Delta-2-14');
    expect(t).toContain('3-Adam');
    expect(t).not.toContain('suspect');
  });

  it('terse mode is brief and uses shorthand', () => {
    const t = renderCallNarrative(CALL, 'terse');
    expect(t).toContain('P1 domestic, 123 Main, 3-Adam');
    expect(t.length).toBeLessThan(60);
  });
});
```

**Step 2: Run to verify FAIL**

Run: `cd client && npx vitest run src/utils/__tests__/narrativeRenderer.test.ts`
Expected: FAIL (module not found).

**Step 3: Implement `narrativeRenderer.ts`**

```ts
export type Terseness = 'narrative' | 'standard' | 'terse';

export interface CallSlots {
  call_number?: string;
  priority?: number;
  incident_type?: string;
  location_address?: string;
  apartment?: string;
  zone_code?: string;
  beat_code?: string;
  suspect_description?: string;
  vehicle_description?: string;
  assigned_units?: string[];
}

function priorityWord(p?: number): string {
  if (p === 1) return 'priority one';
  if (p === 2) return 'priority two';
  if (p === 3) return 'priority three';
  return '';
}

function shortStreet(addr?: string): string {
  if (!addr) return '';
  return addr.replace(/\b(Street|Avenue|Boulevard|Road|Drive|Lane|Court)\b/gi, (m) => m[0]);
}

export function renderCallNarrative(call: CallSlots, mode: Terseness): string {
  if (mode === 'terse') {
    const parts: string[] = [];
    if (call.priority) parts.push(`P${call.priority} ${call.incident_type ?? ''}`.trim());
    if (call.location_address) parts.push(shortStreet(call.location_address));
    if (call.assigned_units?.length) parts.push(call.assigned_units.join(', '));
    return parts.filter(Boolean).join(', ');
  }

  if (mode === 'standard') {
    const parts: string[] = [];
    if (call.priority) parts.push(`P${call.priority} ${call.incident_type ?? ''}`.trim());
    if (call.location_address) parts.push(shortStreet(call.location_address));
    if (call.zone_code && call.beat_code) parts.push(`${call.zone_code}-${call.beat_code}`);
    else if (call.zone_code) parts.push(call.zone_code);
    if (call.assigned_units?.length) parts.push(call.assigned_units.join(', '));
    return parts.filter(Boolean).join(', ');
  }

  // narrative
  const parts: string[] = ['New call'];
  if (call.priority) parts.push(priorityWord(call.priority));
  if (call.incident_type) parts.push(call.incident_type);
  if (call.location_address) {
    let loc = `at ${call.location_address}`;
    if (call.apartment) loc += `, apartment ${call.apartment}`;
    parts.push(loc);
  }
  if (call.zone_code) {
    let geo = `zone ${call.zone_code}`;
    if (call.beat_code) geo += ` beat ${call.beat_code}`;
    parts.push(geo);
  }
  if (call.suspect_description) parts.push(`Suspect is ${call.suspect_description}`);
  if (call.vehicle_description) parts.push(`Vehicle: ${call.vehicle_description}`);
  if (call.assigned_units?.length) parts.push(`Unit ${call.assigned_units.join(', ')} assigned`);
  return parts.join(', ') + '.';
}
```

**Step 4: Run to verify PASS**

Run: `cd client && npx vitest run src/utils/__tests__/narrativeRenderer.test.ts`
Expected: 3 tests pass.

**Step 5: Commit**

```bash
git add client/src/utils/narrativeRenderer.ts client/src/utils/__tests__/narrativeRenderer.test.ts
git commit -m "feat(voice): terseness-aware call narrative renderer"
```

---

### Task 1.6: Wire `announceNewCall` / `announceDispatchEvent` to use renderer

**Files:**
- Modify: `client/src/utils/voiceAlerts.ts` (functions `announceNewCall` at ~670 and `announceDispatchEvent` at ~609)

**Step 1: Write a failing test**

Create `client/src/utils/__tests__/voiceAlerts.terseness.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const speakSpy = vi.fn();
vi.mock('../edgeTTS', () => ({ speak: speakSpy, announceWithSeverity: speakSpy, clearQueue: vi.fn() }));

import { announceNewCall } from '../voiceAlerts';

describe('voiceAlerts honors terseness', () => {
  beforeEach(() => { speakSpy.mockClear(); localStorage.clear(); });

  it('terse mode produces a short spoken line', async () => {
    localStorage.setItem('rmpg-voice-terseness', 'terse');
    await announceNewCall({ call_number: 'CN-1', priority: 1, incident_type: 'domestic', location_address: '123 Main St', assigned_units: ['3A'] });
    const spoken = speakSpy.mock.calls.map((c) => c[0]).join(' ');
    expect(spoken).toMatch(/P1 domestic/);
    expect(spoken.length).toBeLessThan(100);
  });

  it('narrative mode produces a longer line', async () => {
    localStorage.setItem('rmpg-voice-terseness', 'narrative');
    await announceNewCall({ call_number: 'CN-2', priority: 1, incident_type: 'domestic', location_address: '123 Main St', assigned_units: ['3A'] });
    const spoken = speakSpy.mock.calls.map((c) => c[0]).join(' ');
    expect(spoken).toMatch(/priority one/);
    expect(spoken).toMatch(/New call/);
  });
});
```

**Step 2: Run to verify FAIL**

Run: `cd client && npx vitest run src/utils/__tests__/voiceAlerts.terseness.test.ts`
Expected: FAIL.

**Step 3: Update `announceNewCall` in `voiceAlerts.ts` to delegate phrasing to the renderer**

At the top of `voiceAlerts.ts` add:

```ts
import { renderCallNarrative, type Terseness } from './narrativeRenderer';
function currentTerseness(): Terseness {
  return (localStorage.getItem('rmpg-voice-terseness') as Terseness) || 'standard';
}
```

In `announceNewCall`, replace the inline template string with:

```ts
const text = renderCallNarrative(call, currentTerseness());
await speak(text);
```

Do the same for `announceDispatchEvent`.

**Step 4: Run to verify PASS**

Run: `cd client && npx vitest run src/utils/__tests__/voiceAlerts.terseness.test.ts`
Expected: 2 pass.

**Step 5: Commit**

```bash
git add client/src/utils/voiceAlerts.ts client/src/utils/__tests__/voiceAlerts.terseness.test.ts
git commit -m "feat(voice): voiceAlerts uses terseness-aware narrative renderer"
```

---

### Task 1.7: Settings UI — Voice tab with preview

**Files:**
- Create: `client/src/components/settings/VoicePersonaSettings.tsx`
- Modify: `client/src/pages/SettingsPage.tsx` (or whatever page hosts user preferences — confirm path before editing)

**Step 1: Locate the settings page**

Run: `grep -rn "User Preferences\|SettingsPage\|settings" client/src/pages/ --include="*.tsx" | head -10`
Identify the active settings page and the pattern for tabs.

**Step 2: Create `VoicePersonaSettings.tsx`**

```tsx
import { useVoicePersona } from '../../hooks/useVoicePersona';
import { speak } from '../../utils/edgeTTS';
import PanelTitleBar from '../PanelTitleBar';

const VOICES = [
  { id: 'en-US-JennyNeural', label: 'Female — Calm' },
  { id: 'en-US-AriaNeural',  label: 'Female — Crisp' },
  { id: 'en-US-GuyNeural',   label: 'Male — Baritone' },
  { id: 'en-US-DavisNeural', label: 'Male — Tactical' },
];

const SAMPLE = 'Priority one domestic at 123 Main Street, Delta 2-14, 3 Adam responding.';

export default function VoicePersonaSettings() {
  const { persona, setPersona } = useVoicePersona();

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="VOICE PERSONA" />

      <div className="space-y-3 bg-[#141414] border border-[#222222] p-3">
        <label className="block">
          <span className="text-xs text-[#888]">Dispatcher voice</span>
          <select
            value={persona.voiceId}
            onChange={(e) => setPersona({ voiceId: e.target.value })}
            className="w-full bg-[#0a0a0a] border border-[#222] text-sm p-1 mt-1"
          >
            {VOICES.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        </label>

        <label className="block">
          <span className="text-xs text-[#888]">Terseness</span>
          <div className="flex gap-2 mt-1">
            {(['narrative', 'standard', 'terse'] as const).map(t => (
              <button
                key={t}
                onClick={() => setPersona({ terseness: t })}
                className={`px-3 py-1 text-xs border ${persona.terseness === t ? 'border-[#d4a017] text-[#d4a017]' : 'border-[#222] text-[#888]'}`}
              >{t}</button>
            ))}
          </div>
        </label>

        <label className="block">
          <span className="text-xs text-[#888]">Rate: {persona.rate.toFixed(2)}</span>
          <input type="range" min="0.7" max="1.4" step="0.05"
            value={persona.rate}
            onChange={(e) => setPersona({ rate: Number(e.target.value) })}
            className="w-full" />
        </label>

        <label className="block">
          <span className="text-xs text-[#888]">Pitch: {persona.pitch}</span>
          <input type="range" min="-20" max="20" step="1"
            value={persona.pitch}
            onChange={(e) => setPersona({ pitch: Number(e.target.value) })}
            className="w-full" />
        </label>

        <button
          onClick={() => speak(SAMPLE)}
          className="px-3 py-1 text-xs bg-[#1a1a1a] border border-[#d4a017] text-[#d4a017]"
        >PREVIEW</button>
      </div>
    </div>
  );
}
```

**Step 3: Mount in the settings page**

Add a new tab or section that renders `<VoicePersonaSettings />`. Match whatever tab pattern the existing settings page uses. If unsure, ask the user.

**Step 4: Visual verification**

Start dev server (`npm run dev`), navigate to settings, click PREVIEW for each voice + terseness combo. Confirm you hear the selected voice and the sample line length shrinks with tighter terseness.

**Step 5: Commit**

```bash
git add client/src/components/settings/VoicePersonaSettings.tsx client/src/pages/SettingsPage.tsx
git commit -m "feat(voice): Voice tab in settings with preview"
```

---

### Task 1.8: Transcript pane + `useDispatchTranscript` hook

**Files:**
- Create: `client/src/hooks/useDispatchTranscript.ts`
- Create: `client/src/components/DispatcherTranscript.tsx`
- Modify: `client/src/components/Layout.tsx` (mount the drawer near the status bar; keybind `T`)
- Test: `client/src/hooks/__tests__/useDispatchTranscript.test.ts`

**Step 1: Write failing test**

```ts
import { describe, it, expect, act } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDispatchTranscript, pushTranscriptEntry } from '../useDispatchTranscript';

describe('useDispatchTranscript', () => {
  it('entries propagate to subscribers', () => {
    const { result } = renderHook(() => useDispatchTranscript());
    act(() => { pushTranscriptEntry({ text: 'hello', severity: 'normal', source: 'system' }); });
    expect(result.current.entries.at(-1)?.text).toBe('hello');
  });

  it('caps at 100 entries', () => {
    for (let i = 0; i < 150; i++) pushTranscriptEntry({ text: `e${i}`, severity: 'normal', source: 'system' });
    const { result } = renderHook(() => useDispatchTranscript());
    expect(result.current.entries.length).toBeLessThanOrEqual(100);
  });
});
```

**Step 2: Run to verify FAIL**

Run: `cd client && npx vitest run src/hooks/__tests__/useDispatchTranscript.test.ts`
Expected: FAIL.

**Step 3: Implement the hook**

```ts
import { useEffect, useState } from 'react';
import type { AlertSeverity } from '../utils/alertSeverity';

export interface TranscriptEntry {
  id: string;
  ts: number;
  text: string;
  severity: AlertSeverity;
  source: 'system' | 'officer' | 'rule';
  ruleId?: string;
}

const MAX = 100;
let buffer: TranscriptEntry[] = [];
const listeners = new Set<(b: TranscriptEntry[]) => void>();

export function pushTranscriptEntry(entry: Omit<TranscriptEntry, 'id' | 'ts'>): void {
  const full: TranscriptEntry = { ...entry, id: crypto.randomUUID(), ts: Date.now() };
  buffer = [...buffer, full].slice(-MAX);
  listeners.forEach((fn) => fn(buffer));
}

export function useDispatchTranscript() {
  const [entries, setEntries] = useState<TranscriptEntry[]>(buffer);
  useEffect(() => {
    const fn = (b: TranscriptEntry[]) => setEntries(b);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  return { entries };
}
```

**Step 4: Implement `DispatcherTranscript.tsx`**

```tsx
import { useState, useEffect } from 'react';
import { useDispatchTranscript } from '../hooks/useDispatchTranscript';

const SEV_COLOR: Record<string, string> = {
  critical: '#ff3b30',
  high:     '#ff9500',
  normal:   '#34c759',
  low:      '#888888',
};

export default function DispatcherTranscript() {
  const { entries } = useDispatchTranscript();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 't' || e.key === 'T') {
        const target = e.target as HTMLElement;
        if (['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
        setOpen((v) => !v);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const critical = entries.filter((e) => e.severity === 'critical');

  return (
    <>
      <div
        aria-live="polite"
        aria-atomic="false"
        style={{ position: 'absolute', left: -9999, width: 1, height: 1, overflow: 'hidden' }}
      >
        {entries.slice(-3).map((e) => <div key={e.id}>{e.text}</div>)}
      </div>
      <div
        aria-live="assertive"
        style={{ position: 'absolute', left: -9999, width: 1, height: 1, overflow: 'hidden' }}
      >
        {critical.slice(-1).map((e) => <div key={e.id}>{e.text}</div>)}
      </div>

      {open && (
        <div className="fixed bottom-6 right-2 w-[420px] max-h-[40vh] overflow-y-auto bg-[#0a0a0a] border border-[#222] text-xs z-50">
          <div className="flex justify-between p-2 border-b border-[#222] bg-[#141414]">
            <span className="text-[#d4a017]">TRANSCRIPT</span>
            <button onClick={() => setOpen(false)} className="text-[#888]">×</button>
          </div>
          <ul>
            {entries.map((e) => (
              <li key={e.id} className="flex gap-2 px-2 py-[2px] border-b border-[#1a1a1a]">
                <span style={{ color: SEV_COLOR[e.severity] }}>●</span>
                <span className="text-[#888]">{new Date(e.ts).toLocaleTimeString()}</span>
                <span className="text-[#ddd] flex-1">{e.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
```

**Step 5: Mount in `Layout.tsx`**

Import and render `<DispatcherTranscript />` once, near the status bar element.

**Step 6: Hook the transcript into `speak()`**

In `client/src/utils/edgeTTS.ts`, at the top of `speak()` (line ~410), call:

```ts
import { pushTranscriptEntry } from '../hooks/useDispatchTranscript';
// inside speak(text, severity?):
pushTranscriptEntry({ text, severity: severity ?? 'normal', source: 'system' });
```

**Step 7: Run the test**

Run: `cd client && npx vitest run src/hooks/__tests__/useDispatchTranscript.test.ts`
Expected: 2 tests pass.

**Step 8: Commit**

```bash
git add client/src/hooks/useDispatchTranscript.ts client/src/components/DispatcherTranscript.tsx client/src/components/Layout.tsx client/src/utils/edgeTTS.ts client/src/hooks/__tests__/useDispatchTranscript.test.ts
git commit -m "feat(voice): transcript pane with ARIA live regions, keybind T"
```

---

### Task 1.9: Manual QA + Phase 1 deploy checkpoint

**Step 1: Run full test suites**

```bash
cd client && npx vitest run
cd server && npx vitest run
cd client && npx tsc --noEmit
```
Expected: all green on both sides.

**Step 2: Manual checklist**

- Open Settings → Voice tab; switch each of 4 voices and press PREVIEW — confirm different voice audible
- Switch terseness to `terse`, create a new call — confirm spoken line is short
- Switch to `narrative`, create a new call — confirm spoken line includes "priority one", "zone", etc.
- Press `T` — transcript drawer opens; each new spoken line appears
- Reload page — voice settings persist (localStorage + server)

**Step 3: Deploy to VPS**

```bash
bash deploy/deploy.sh
curl -sf https://rmpgutah.us/api/health
grep CACHE_NAME client/public/sw.js                            # bump before deploying
ssh root@194.113.64.90 'grep CACHE_NAME /opt/rmpg-flex/client/dist/sw.js'
```
Remember to bump `CACHE_NAME` in `client/public/sw.js` before deploying.

---

## Phase 2 — Rules Engine + Event Coverage

Adds the brain skeleton, the rule registry, and the six new WS broadcasts. Rules fire only when `voice_brain_enabled` flag is on (user-scoped).

---

### Task 2.1: Brain feature flag column

**Files:**
- Modify: `server/src/models/database.ts`

**Step 1: Add column**

Append to the `users` addCol block:

```ts
addCol('users', 'voice_brain_enabled', 'INTEGER DEFAULT 0');
```

**Step 2: Extend `/api/voice-persona` route to read/write the flag**

Modify both the GET select list and the PUT validator list to include `voice_brain_enabled` (validate as 0|1).

**Step 3: Update the existing tests** (`server/src/routes/__tests__/voicePersona.test.ts`) to cover reading/writing the flag. Add a test case for `voice_brain_enabled: 1`.

**Step 4: Run tests + commit**

```bash
cd server && npx vitest run src/routes/__tests__/voicePersona.test.ts
git add server/src/models/database.ts server/src/routes/voicePersona.ts server/src/routes/__tests__/voicePersona.test.ts
git commit -m "feat(voice): voice_brain_enabled user flag"
```

---

### Task 2.2: Speak-queue primitive

**Files:**
- Create: `client/src/utils/speakQueue.ts`
- Test: `client/src/utils/__tests__/speakQueue.test.ts`

**Step 1: Write failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { enqueueSpeech, __resetQueueForTest } from '../speakQueue';

const speakMock = vi.fn(async () => {});
vi.mock('../edgeTTS', () => ({ speak: (...args: any[]) => speakMock(...args) }));

describe('speakQueue', () => {
  beforeEach(() => { speakMock.mockClear(); __resetQueueForTest(); });

  it('critical preempts normal', async () => {
    enqueueSpeech({ text: 'normal a', severity: 'normal', ruleId: 'x', entityKey: '1' });
    enqueueSpeech({ text: 'critical b', severity: 'critical', ruleId: 'y', entityKey: '2' });
    await new Promise((r) => setTimeout(r, 10));
    expect(speakMock.mock.calls[0][0]).toBe('critical b');
  });

  it('same ruleId + entityKey inside cooldown is dropped', async () => {
    enqueueSpeech({ text: 'first', severity: 'normal', ruleId: 'dup', entityKey: 'e1', cooldownMs: 10000 });
    enqueueSpeech({ text: 'second', severity: 'normal', ruleId: 'dup', entityKey: 'e1', cooldownMs: 10000 });
    await new Promise((r) => setTimeout(r, 10));
    expect(speakMock).toHaveBeenCalledTimes(1);
  });
});
```

**Step 2: Run to verify FAIL**

**Step 3: Implement `speakQueue.ts`**

```ts
import { speak } from './edgeTTS';
import type { AlertSeverity } from './alertSeverity';

interface SpeechItem {
  text: string;
  severity: AlertSeverity;
  ruleId: string;
  entityKey: string;
  cooldownMs?: number;
}

const SEV_RANK: Record<AlertSeverity, number> = { critical: 0, high: 1, normal: 2, low: 3 };
const queue: SpeechItem[] = [];
const lastSpoken = new Map<string, number>();        // key `${ruleId}|${entityKey}` → ms
let draining = false;
let lastNonCriticalAt = 0;
const GLOBAL_LOW_GAP_MS = 6000;

export function enqueueSpeech(item: SpeechItem): void {
  const key = `${item.ruleId}|${item.entityKey}`;
  const last = lastSpoken.get(key);
  const cd = item.cooldownMs ?? 0;
  if (last != null && Date.now() - last < cd) return;      // dedup/cooldown
  queue.push(item);
  queue.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);
  drain();
}

async function drain() {
  if (draining) return;
  draining = true;
  try {
    while (queue.length) {
      const next = queue.shift()!;
      if (next.severity !== 'critical') {
        const gap = Date.now() - lastNonCriticalAt;
        if (gap < GLOBAL_LOW_GAP_MS) await new Promise((r) => setTimeout(r, GLOBAL_LOW_GAP_MS - gap));
      }
      await speak(next.text, next.severity);
      lastSpoken.set(`${next.ruleId}|${next.entityKey}`, Date.now());
      if (next.severity !== 'critical') lastNonCriticalAt = Date.now();
    }
  } finally {
    draining = false;
  }
}

export function __resetQueueForTest() {
  queue.length = 0;
  lastSpoken.clear();
  lastNonCriticalAt = 0;
  draining = false;
}
```

**Step 4: Run to verify PASS + commit**

```bash
cd client && npx vitest run src/utils/__tests__/speakQueue.test.ts
git add client/src/utils/speakQueue.ts client/src/utils/__tests__/speakQueue.test.ts
git commit -m "feat(voice): priority speak-queue with cooldown + preemption"
```

---

### Task 2.3: Rule type + registry

**Files:**
- Create: `client/src/utils/dispatcherRules/types.ts`
- Create: `client/src/utils/dispatcherRules/registry.ts`
- Test: `client/src/utils/__tests__/dispatcherRulesRegistry.test.ts`

**Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest';
import { findRules, registerRule } from '../dispatcherRules/registry';

describe('dispatcherRules registry', () => {
  it('returns rules matching an event type', () => {
    registerRule({
      id: 'test-rule',
      trigger: 'event',
      eventTypes: ['call_created'],
      match: () => true,
      severity: 'normal',
      cooldownMs: 0,
      compose: () => 'hi',
    });
    const hits = findRules({ kind: 'event', type: 'call_created', ctx: {} as any });
    expect(hits.some((r) => r.id === 'test-rule')).toBe(true);
  });
});
```

**Step 2: Run to verify FAIL**

**Step 3: Implement**

`types.ts`:

```ts
import type { AlertSeverity } from '../alertSeverity';

export interface BrainContext {
  lastCall?:   { id: string; call_number: string; location: string; type: string };
  lastUnit?:   { call_sign: string; officer_name?: string };
  lastPerson?: { id: number; first_name: string; last_name: string };
  lastPlate?:  { plate: string; state: string };
  currentUserCallSign?:   string;
  currentUserOnSceneAt?:  number;
  currentUserGeofence?:   { beat: string; inBeat: boolean };
  transcript: Array<{ text: string; source: 'system' | 'officer'; ts: number }>;
  // payload for the currently-matching event (rule closure sees this)
  event?: { type: string; payload: any };
}

export interface DispatcherRule {
  id: string;
  trigger: 'event' | 'timer' | 'state';
  eventTypes?: string[];
  match: (ctx: BrainContext) => boolean;
  severity: AlertSeverity;
  cooldownMs: number;
  compose: (ctx: BrainContext) => string;
  followUp?: 'listen' | 'none';
  entityKey?: (ctx: BrainContext) => string;  // defaults to 'global'
}

export type TriggerEnvelope =
  | { kind: 'event'; type: string; ctx: BrainContext }
  | { kind: 'timer'; ctx: BrainContext }
  | { kind: 'state'; ctx: BrainContext };
```

`registry.ts`:

```ts
import type { DispatcherRule, TriggerEnvelope } from './types';
const rules: DispatcherRule[] = [];
export function registerRule(r: DispatcherRule) { rules.push(r); }
export function registerRules(rs: DispatcherRule[]) { rules.push(...rs); }
export function __clearRulesForTest() { rules.length = 0; }
export function findRules(env: TriggerEnvelope): DispatcherRule[] {
  return rules.filter((r) => {
    if (r.trigger !== env.kind) return false;
    if (env.kind === 'event' && r.eventTypes && !r.eventTypes.includes(env.type)) return false;
    return r.match(env.ctx);
  });
}
```

**Step 4: Run + commit**

```bash
cd client && npx vitest run src/utils/__tests__/dispatcherRulesRegistry.test.ts
git add client/src/utils/dispatcherRules/ client/src/utils/__tests__/dispatcherRulesRegistry.test.ts
git commit -m "feat(voice): dispatcher rule types + registry"
```

---

### Task 2.4: Event rules (6 rules)

**Files:**
- Create: `client/src/utils/dispatcherRules/events.ts`
- Test: `client/src/utils/__tests__/dispatcherRules.events.test.ts`

**Step 1: Write the test file with one test per rule**

For each of the 6 rules (`citation-issued`, `incident-created`, `warrant-entered`, `evidence-logged`, `arrest-booked`, `hr-approval`), assert:
- `match` returns true given an event of the correct type + populated payload
- `compose` produces text containing the key identifier

Example shape:

```ts
import { describe, it, expect } from 'vitest';
import { EVENT_RULES } from '../dispatcherRules/events';

function findRule(id: string) { return EVENT_RULES.find(r => r.id === id)!; }

describe('event rules', () => {
  it('citation-issued speaks citation number + issuer', () => {
    const rule = findRule('citation-issued');
    const ctx: any = { event: { type: 'citation_created', payload: { citation_number: 'RN-26-0142', officer_call_sign: '4-Bravo', fine_amount: 85 } } };
    expect(rule.match(ctx)).toBe(true);
    expect(rule.compose(ctx)).toContain('RN-26-0142');
    expect(rule.compose(ctx)).toContain('4-Bravo');
  });
  // … repeat for the other 5 rules …
});
```

**Step 2: Run to verify FAIL**

**Step 3: Implement `events.ts`**

```ts
import type { DispatcherRule } from './types';

export const EVENT_RULES: DispatcherRule[] = [
  {
    id: 'citation-issued',
    trigger: 'event',
    eventTypes: ['citation_created'],
    match: (ctx) => !!ctx.event?.payload?.citation_number,
    severity: 'low',
    cooldownMs: 0,
    entityKey: (ctx) => ctx.event?.payload?.citation_number ?? 'global',
    compose: (ctx) => {
      const p = ctx.event!.payload;
      const fine = p.fine_amount ? `, $${p.fine_amount} fine` : '';
      return `Citation ${p.citation_number} issued by ${p.officer_call_sign ?? 'unit unknown'}${fine}.`;
    },
  },
  {
    id: 'incident-created',
    trigger: 'event',
    eventTypes: ['incident_created'],
    match: (ctx) => !!ctx.event?.payload?.incident_number,
    severity: 'low',
    cooldownMs: 0,
    entityKey: (ctx) => ctx.event?.payload?.incident_number ?? 'global',
    compose: (ctx) => {
      const p = ctx.event!.payload;
      const from = p.source_call ? ` from call ${p.source_call}` : '';
      return `Incident ${p.incident_number} opened${from}.`;
    },
  },
  {
    id: 'warrant-entered',
    trigger: 'event',
    eventTypes: ['warrant_entered'],
    match: (ctx) => !!ctx.event?.payload?.subject_name,
    severity: 'normal',
    cooldownMs: 0,
    entityKey: (ctx) => ctx.event?.payload?.warrant_id ?? 'global',
    compose: (ctx) => {
      const p = ctx.event!.payload;
      const bail = p.bail_amount ? `, $${p.bail_amount} bail` : '';
      return `New warrant on ${p.subject_name}, ${p.offense_class ?? 'offense class unknown'}${bail}.`;
    },
  },
  {
    id: 'evidence-logged',
    trigger: 'event',
    eventTypes: ['evidence_logged'],
    match: (ctx) => !!ctx.event?.payload?.tag_number,
    severity: 'low',
    cooldownMs: 0,
    entityKey: (ctx) => ctx.event?.payload?.tag_number ?? 'global',
    compose: (ctx) => {
      const p = ctx.event!.payload;
      return `Evidence tag ${p.tag_number} logged for case ${p.case_number ?? 'unknown'}.`;
    },
  },
  {
    id: 'arrest-booked',
    trigger: 'event',
    eventTypes: ['arrest_created'],
    match: (ctx) => !!ctx.event?.payload?.subject_name,
    severity: 'normal',
    cooldownMs: 0,
    entityKey: (ctx) => ctx.event?.payload?.arrest_id ?? 'global',
    compose: (ctx) => {
      const p = ctx.event!.payload;
      const by = p.officer_call_sign ? `, by ${p.officer_call_sign}` : '';
      return `Arrest booked: ${p.subject_name}, ${p.charge ?? 'charges pending'}${by}.`;
    },
  },
  {
    id: 'hr-approval',
    trigger: 'event',
    eventTypes: ['leave_approved'],
    match: (ctx) => !!ctx.event?.payload?.officer_name,
    severity: 'low',
    cooldownMs: 0,
    entityKey: (ctx) => ctx.event?.payload?.leave_id ?? 'global',
    compose: (ctx) => `Leave request approved for ${ctx.event!.payload.officer_name}.`,
  },
];
```

**Step 4: Run + commit**

```bash
cd client && npx vitest run src/utils/__tests__/dispatcherRules.events.test.ts
git add client/src/utils/dispatcherRules/events.ts client/src/utils/__tests__/dispatcherRules.events.test.ts
git commit -m "feat(voice): event rules — citations, incidents, warrants, evidence, arrests, HR"
```

---

### Task 2.5: Brain core — event fan-in

**Files:**
- Create: `client/src/utils/dispatcherBrain.ts`
- Test: `client/src/utils/__tests__/dispatcherBrain.test.ts`

**Step 1: Write failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleDispatchEvent, __resetBrainForTest } from '../dispatcherBrain';
import { registerRule, __clearRulesForTest } from '../dispatcherRules/registry';

const enqueue = vi.fn();
vi.mock('../speakQueue', () => ({ enqueueSpeech: (...a: any[]) => enqueue(...a) }));

describe('dispatcherBrain', () => {
  beforeEach(() => {
    enqueue.mockClear();
    __resetBrainForTest();
    __clearRulesForTest();
  });

  it('ignores events when brain is disabled', () => {
    registerRule({ id: 't', trigger: 'event', eventTypes: ['x'], match: () => true, severity: 'normal', cooldownMs: 0, compose: () => 'hi' });
    handleDispatchEvent('x', {});
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('fires matching rule when enabled', () => {
    localStorage.setItem('rmpg-voice-brain-enabled', '1');
    registerRule({ id: 't', trigger: 'event', eventTypes: ['x'], match: () => true, severity: 'normal', cooldownMs: 0, compose: () => 'hi' });
    handleDispatchEvent('x', {});
    expect(enqueue).toHaveBeenCalledOnce();
    expect(enqueue.mock.calls[0][0].text).toBe('hi');
  });
});
```

**Step 2: Run to verify FAIL**

**Step 3: Implement `dispatcherBrain.ts`**

```ts
import { findRules } from './dispatcherRules/registry';
import { enqueueSpeech } from './speakQueue';
import type { BrainContext } from './dispatcherRules/types';

let ctx: BrainContext = { transcript: [] };

export function __resetBrainForTest() { ctx = { transcript: [] }; localStorage.removeItem('rmpg-voice-brain-enabled'); }
export function setCurrentUser(callSign: string) { ctx.currentUserCallSign = callSign; }
export function getBrainContext(): BrainContext { return ctx; }

function isEnabled(): boolean {
  return localStorage.getItem('rmpg-voice-brain-enabled') === '1';
}

export function handleDispatchEvent(type: string, payload: any) {
  if (!isEnabled()) return;
  ctx.event = { type, payload };
  // Update last-mentioned slots
  if (payload?.call_number) ctx.lastCall = { id: payload.id ?? payload.call_number, call_number: payload.call_number, location: payload.location_address ?? '', type: payload.incident_type ?? '' };
  if (payload?.unit_call_sign || payload?.call_sign) ctx.lastUnit = { call_sign: payload.unit_call_sign ?? payload.call_sign };

  const matched = findRules({ kind: 'event', type, ctx });
  for (const r of matched) {
    const text = r.compose(ctx);
    enqueueSpeech({
      text,
      severity: r.severity,
      ruleId: r.id,
      entityKey: r.entityKey?.(ctx) ?? 'global',
      cooldownMs: r.cooldownMs,
    });
  }
  ctx.event = undefined;
}
```

**Step 4: Run + commit**

```bash
cd client && npx vitest run src/utils/__tests__/dispatcherBrain.test.ts
git add client/src/utils/dispatcherBrain.ts client/src/utils/__tests__/dispatcherBrain.test.ts
git commit -m "feat(voice): dispatcher brain event dispatch with enable flag"
```

---

### Task 2.6: Wire brain to WebSocket context

**Files:**
- Modify: `client/src/contexts/WebSocketContext.tsx` (or wherever the WS message handler lives; confirm via grep)

**Step 1: Locate the WS handler**

Run: `grep -rn "onmessage\|message.*JSON.parse" client/src/contexts/ client/src/hooks/ --include="*.tsx" --include="*.ts" | head -10`

**Step 2: In the WS message handler, add:**

```ts
import { handleDispatchEvent } from '../utils/dispatcherBrain';
import { registerRules } from '../utils/dispatcherRules/registry';
import { EVENT_RULES } from '../utils/dispatcherRules/events';
// once, app init:
registerRules(EVENT_RULES);

// in the message handler:
if (msg.type === 'dispatch_update' && msg.data?.action) {
  handleDispatchEvent(msg.data.action, msg.data);
}
```

The exact shape depends on the existing handler — inspect and match.

**Step 3: Manual smoke**

Run dev server, open browser devtools, toggle `localStorage.setItem('rmpg-voice-brain-enabled', '1')` and watch for console output + speech on the next dispatch event.

**Step 4: Commit**

```bash
git add client/src/contexts/WebSocketContext.tsx
git commit -m "feat(voice): wire dispatcher brain to WebSocket events"
```

---

### Task 2.7: Server-side WS broadcasts for 6 new event types

For each of the 6 mutation sites below, locate the POST/PATCH handler and add one line of broadcast. Each is a separate task-commit — repeat the pattern:

| File | Existing mutation | Broadcast to add |
|---|---|---|
| `server/src/routes/citations.ts` | POST create | `broadcastDispatchUpdate({ action: 'citation_created', citation_number, officer_call_sign, fine_amount })` |
| `server/src/routes/incidents.ts` | POST create | `broadcastDispatchUpdate({ action: 'incident_created', incident_number, source_call })` |
| `server/src/routes/warrants.ts` | POST create | `broadcastDispatchUpdate({ action: 'warrant_entered', warrant_id, subject_name, offense_class, bail_amount })` |
| `server/src/routes/evidence.ts` | POST log | `broadcastDispatchUpdate({ action: 'evidence_logged', tag_number, case_number })` |
| `server/src/routes/arrests.ts` | POST create | `broadcastDispatchUpdate({ action: 'arrest_created', arrest_id, subject_name, charge, officer_call_sign })` |
| `server/src/routes/hr/leave.ts` | PATCH approve | `broadcastDispatchUpdate({ action: 'leave_approved', leave_id, officer_name })` |

**Pattern for each task:**

1. Open the file, locate the handler
2. Immediately after the existing `auditLog(...)` call (or after the DB write if no auditLog), insert the broadcast
3. Commit: `git commit -m "feat(voice): broadcast <event> for dispatcher brain"`

**Check real column names in each route before committing** — some tables use different field names than the broadcast payload suggests. Prefer existing names from the SELECT queries in the same file.

---

### Task 2.8: Phase 2 manual QA + deploy

**Checklist:**
- With `voice_brain_enabled = 0`, create a citation in the UI — confirm NO speech
- Toggle flag on in Voice settings — create another citation — confirm spoken "Citation RN-… issued by …"
- Issue 5 citations back-to-back — confirm 6-second gap between utterances (not spammed)
- Create two unrelated citations — both speak (different entityKey)
- Create the same citation (edit/resave) twice within 10s — only first speaks

Deploy + bump `sw.js` cache name as in Phase 1.

---

## Phase 3 — Coaching Rules (timers, geofence, approach warnings)

Adds proactive coaching rules + timer loop.

---

### Task 3.1: Coaching rules for call-creation events

**Files:**
- Create: `client/src/utils/dispatcherRules/coaching.ts`
- Test: `client/src/utils/__tests__/dispatcherRules.coaching.test.ts`

**Step 1: Write failing tests for the 3 event-based coaching rules**

Test the same match + compose shape as Task 2.4 for:
- `dv-approach-warning` — matches `call_created` with `domestic_violence === 1`, severity `high`, cooldown `5 * 60_000`
- `felony-backup-suggest` — matches `call_created` with `felony_in_progress === 1` and `assigned_units.length < 2`, severity `high`, cooldown `5 * 60_000`
- `mental-health-protocol` — matches `call_created` with `mental_health_crisis === 1`, severity `high`, cooldown `10 * 60_000`

**Step 2: Implement `coaching.ts`** mirroring `events.ts` structure.

Each `entityKey` should be `ctx.event?.payload?.call_number` so multiple calls fire independently.

**Step 3: Register in WebSocketContext**

```ts
import { COACHING_RULES } from '../utils/dispatcherRules/coaching';
registerRules(COACHING_RULES);
```

**Step 4: Run + commit**

---

### Task 3.2: Timer loop + overdue-status rule

**Files:**
- Modify: `client/src/utils/dispatcherBrain.ts` (add `startBrainTimer()`/`stopBrainTimer()`)
- Create: Add `overdue-status-check` rule to `coaching.ts`
- Test: `client/src/utils/__tests__/dispatcherBrain.timer.test.ts`

**Step 1: Add timer to brain**

```ts
let timerHandle: any = null;
export function startBrainTimer() {
  if (timerHandle) return;
  timerHandle = setInterval(() => tickTimers(), 30_000);
}
export function stopBrainTimer() { clearInterval(timerHandle); timerHandle = null; }

function tickTimers() {
  if (!isEnabled()) return;
  const matched = findRules({ kind: 'timer', ctx });
  for (const r of matched) {
    enqueueSpeech({
      text: r.compose(ctx),
      severity: r.severity,
      ruleId: r.id,
      entityKey: r.entityKey?.(ctx) ?? 'global',
      cooldownMs: r.cooldownMs,
    });
  }
}
```

**Step 2: Overdue-status rule**

```ts
{
  id: 'overdue-status-check',
  trigger: 'timer',
  match: (ctx) => {
    if (!ctx.currentUserOnSceneAt) return false;
    const mins = (Date.now() - ctx.currentUserOnSceneAt) / 60_000;
    return mins >= 8;
  },
  severity: 'high',
  cooldownMs: 5 * 60_000,
  entityKey: (ctx) => ctx.currentUserCallSign ?? 'me',
  compose: (ctx) => {
    const mins = Math.floor((Date.now() - (ctx.currentUserOnSceneAt ?? 0)) / 60_000);
    return `${ctx.currentUserCallSign ?? 'Unit'}, status check, ${mins} minutes on scene.`;
  },
}
```

**Step 3: Update `BrainContext` on status_change events**

In `handleDispatchEvent`, when `type === 'unit_status'` or `'status_update'`, if the unit is the current user and new status is `on_scene`, set `ctx.currentUserOnSceneAt = Date.now()`. Clear it on `clear` or `off`.

**Step 4: Test the timer rule**

```ts
it('fires overdue-status-check after 8 minutes on scene', () => {
  localStorage.setItem('rmpg-voice-brain-enabled', '1');
  setCurrentUser('3-Adam');
  (getBrainContext() as any).currentUserOnSceneAt = Date.now() - 9 * 60_000;
  // call the exported tick function (expose a test-only accessor if needed)
  tickTimersForTest();
  expect(enqueue).toHaveBeenCalled();
});
```

**Step 5: Wire `startBrainTimer()` into app init** (in `App.tsx` or `WebSocketContext` on mount).

**Step 6: Commit**

---

### Task 3.3: Geofence-breach rule

Depends on whether `unit_outside_beat` events exist. Check:

Run: `grep -rn "outside_beat\|geofence" server/src/ client/src/ | head -10`

If absent, add a server-side check inside the GPS update handler that compares unit position to `assigned_beat` polygon; on transition true → emit WS `{ action: 'unit_outside_beat', call_sign, beat }`. This ties into the existing `geofence.ts` util.

Rule:

```ts
{
  id: 'geofence-breach',
  trigger: 'event',
  eventTypes: ['unit_outside_beat'],
  match: (ctx) => !!ctx.event?.payload?.call_sign,
  severity: 'normal',
  cooldownMs: 3 * 60_000,
  entityKey: (ctx) => ctx.event!.payload.call_sign,
  compose: (ctx) => `${ctx.event!.payload.call_sign} is outside assigned beat ${ctx.event!.payload.beat}.`,
}
```

**Test + commit as usual.**

---

### Task 3.4: Phase 3 deploy checkpoint

Same QA/deploy pattern as previous phases. Bump sw.js cache.

---

## Phase 4 — Multi-turn Dialog + Referent Resolver

---

### Task 4.1: Referent resolver

**Files:**
- Create: `client/src/utils/referentResolver.ts`
- Test: `client/src/utils/__tests__/referentResolver.test.ts`

**Step 1: Write table-driven test with ~20 rows** covering all 5 rewrite patterns in the design doc + negatives.

**Step 2: Implement**

```ts
import type { BrainContext } from './dispatcherRules/types';

const THIS_CALL_PATTERNS = [/\bthat call\b/i, /\bthis call\b/i, /\bthe call\b/i];
const THIS_LOC_PATTERNS  = [/\bthat location\b/i, /\bthe location\b/i];
const HIM_HER_PATTERNS   = [/\bhim\b/i, /\bher\b/i, /\bthe subject\b/i];
const THIS_UNIT_PATTERNS = [/\bthat unit\b/i, /\bthe unit\b/i];
const THIS_PLATE_PATTERNS= [/\bthat plate\b/i, /\bthe plate\b/i];

export function resolveReferents(transcript: string, ctx: BrainContext): { text: string; resolutions: Record<string, string>; ambiguous: boolean } {
  let out = transcript;
  const res: Record<string, string> = {};
  let ambiguous = false;

  if (THIS_CALL_PATTERNS.some((r) => r.test(out))) {
    if (ctx.lastCall) {
      THIS_CALL_PATTERNS.forEach((r) => { out = out.replace(r, `call ${ctx.lastCall!.call_number}`); });
      res.call = ctx.lastCall.call_number;
    } else { ambiguous = true; }
  }
  if (THIS_LOC_PATTERNS.some((r) => r.test(out))) {
    if (ctx.lastCall?.location) {
      THIS_LOC_PATTERNS.forEach((r) => { out = out.replace(r, ctx.lastCall!.location); });
      res.location = ctx.lastCall.location;
    } else { ambiguous = true; }
  }
  if (HIM_HER_PATTERNS.some((r) => r.test(out))) {
    if (ctx.lastPerson) {
      HIM_HER_PATTERNS.forEach((r) => { out = out.replace(r, `person id ${ctx.lastPerson!.id}`); });
      res.person = String(ctx.lastPerson.id);
    } else { ambiguous = true; }
  }
  if (THIS_UNIT_PATTERNS.some((r) => r.test(out))) {
    if (ctx.lastUnit) {
      THIS_UNIT_PATTERNS.forEach((r) => { out = out.replace(r, ctx.lastUnit!.call_sign); });
      res.unit = ctx.lastUnit.call_sign;
    } else { ambiguous = true; }
  }
  if (THIS_PLATE_PATTERNS.some((r) => r.test(out))) {
    if (ctx.lastPlate) {
      THIS_PLATE_PATTERNS.forEach((r) => { out = out.replace(r, `plate ${ctx.lastPlate!.plate}`); });
      res.plate = ctx.lastPlate.plate;
    } else { ambiguous = true; }
  }
  return { text: out, resolutions: res, ambiguous };
}
```

**Step 3: Commit.**

---

### Task 4.2: Plumb resolver into voice channel

**Files:**
- Modify: `client/src/utils/voiceChannel.ts` — in the transition from `LISTENING` to `PROCESSING`, run transcript through `resolveReferents(text, getBrainContext())` before passing to the existing NLU/command executor. If `ambiguous` is true, skip execution, speak `"Which call did you mean?"` via `enqueueSpeech`, and re-enter `LISTENING` for 4s with `pendingClarification` set on context.

**Add integration test** covering: officer says "tell me more about that call" → resolver rewrites → dispatcher speaks back a summary of `lastCall`.

**Commit.**

---

### Task 4.3: Conversational query handlers

Add to `voiceCommandExecutor.ts` two new intents:

- `describe_call` — speaks a short narrative of `lastCall` (delegates to `renderCallNarrative(call, 'narrative')`)
- `who_is_assigned` — speaks the `assigned_units` of `lastCall`

Update the NLU intent patterns at the top of the executor to include natural-language triggers: `"tell me about"`, `"who is assigned"`, `"who's on"`.

**Test + commit.**

---

### Task 4.4: Ambiguity clarification flow

**Files:**
- Modify: `voiceChannel.ts` to handle `pendingClarification` — next utterance is treated as the missing referent (e.g., officer says a call number → it's inserted as `lastCall`).

**Test + commit.**

---

### Task 4.5: Phase 4 final QA + deploy

Full manual script:
1. Enable brain flag. Create a call. Confirm dispatcher speaks narrative.
2. Press `V` (manual-listen keybind). Say "tell me more about that call." Confirm dispatcher speaks the call narrative.
3. Say "who's assigned?" Confirm unit list spoken.
4. Fresh session, no context. Say "tell me about that call." Confirm dispatcher asks "Which call did you mean?"

Deploy + bump sw.js.

---

## Final integration gate

After all phases, run:

```bash
cd client && npx vitest run
cd server && npx vitest run
cd client && npx tsc --noEmit
cd server && npm run check:routes
```

All green before merging `claude/practical-liskov` → main.

Open a single PR with the full body summarizing the 4 phases, link to `docs/plans/2026-04-17-dispatcher-brain-design.md`, and enumerate manual QA results.
