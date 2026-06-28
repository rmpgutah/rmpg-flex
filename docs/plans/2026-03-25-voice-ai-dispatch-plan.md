# Voice + AI Dispatch System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add three-tier alert severity, Edge-TTS neural dispatcher voice, and Groq AI integration (call analysis, narrative assist, unit suggestions) to RMPG Flex.

**Architecture:** Server-side Edge-TTS endpoint generates neural MP3 audio; Groq AI endpoints analyze calls and generate narratives; client-side alert severity classifier routes events through tiered tone+voice pipelines. All AI features degrade gracefully — system works fully without external APIs.

**Tech Stack:** `@bestcodes/edge-tts` (neural TTS), `groq-sdk` (Llama 3.3 70B), Web Audio API (bandpass filtering), Express routes, WebSocket broadcasts.

---

## Phase 1: Alert Severity System + Edge-TTS Voice

### Task 1: Install Dependencies

**Files:**
- Modify: `server/package.json`

**Step 1: Install server dependencies**

Run:
```bash
cd server && npm install @bestcodes/edge-tts groq-sdk
```

**Step 2: Verify installation**

Run:
```bash
cd server && node -e "require('@bestcodes/edge-tts'); require('groq-sdk'); console.log('OK')"
```
Expected: `OK`

**Step 3: Commit**

```bash
git add server/package.json server/package-lock.json
git commit -m "deps: add @bestcodes/edge-tts and groq-sdk"
```

---

### Task 2: Create Alert Severity Classifier

**Files:**
- Create: `client/src/utils/alertSeverity.ts`

**Step 1: Create the severity classification module**

This module classifies every dispatch event into minor/moderate/major tiers based on event type, call flags, and priority.

```typescript
/**
 * Alert Severity Classification
 *
 * Routes dispatch events through three tiers:
 *   Minor    — routine status updates, info-only
 *   Moderate — BOLOs, warrants, backup, DV, new priority calls
 *   Major    — panic, officer down, active shooter, felony in progress
 */

export type AlertSeverity = 'minor' | 'moderate' | 'major';

export interface AlertClassification {
  severity: AlertSeverity;
  /** Whether to interrupt currently-playing lower-priority audio */
  interrupt: boolean;
  /** Number of times to repeat the tone (major = 3x) */
  toneRepeats: number;
  /** Whether voice should use urgent mode (faster rate, higher pitch) */
  urgentVoice: boolean;
}

interface CallFlags {
  weapons_involved?: boolean | number;
  felony_in_progress?: boolean | number;
  domestic_violence?: boolean | number;
  mental_health_crisis?: boolean | number;
  officer_safety_caution?: boolean | number;
  vehicle_pursuit?: boolean | number;
  foot_pursuit?: boolean | number;
  hazmat?: boolean | number;
  gang_related?: boolean | number;
  injuries_reported?: boolean | number;
  ems_requested?: boolean | number;
  k9_requested?: boolean | number;
  drugs_involved?: boolean | number;
  alcohol_involved?: boolean | number;
  priority?: string;
}

// Events that are always major regardless of flags
const MAJOR_EVENTS = new Set([
  'panic_alert',
  'officer_down',
  'active_shooter',
  'shots_fired',
]);

// Events that are always at least moderate
const MODERATE_EVENTS = new Set([
  'bolo_alert',
  'warrant_hit',
  'backup_request',
  'pursuit_update',
  'all_units',
]);

// Events that are always minor
const MINOR_EVENTS = new Set([
  'call_closed',
  'call_cleared',
  'unit_cleared',
  'status_update',
]);

// Flag combinations that escalate to major
const MAJOR_FLAG_COMBOS: Array<(f: CallFlags) => boolean> = [
  (f) => !!f.weapons_involved && !!f.felony_in_progress,
  (f) => !!f.vehicle_pursuit || !!f.foot_pursuit,
];

// Individual flags that escalate to at least moderate
const MODERATE_FLAGS: Array<keyof CallFlags> = [
  'weapons_involved',
  'felony_in_progress',
  'domestic_violence',
  'mental_health_crisis',
  'officer_safety_caution',
  'hazmat',
  'gang_related',
  'injuries_reported',
];

/**
 * Classify an event + optional call data into a severity tier.
 */
export function classifySeverity(
  eventType: string,
  call?: CallFlags | null,
  aiSeverityOverride?: AlertSeverity | null
): AlertClassification {
  // AI override takes highest priority (only escalates, never downgrades)
  let severity: AlertSeverity = 'minor';

  // 1. Check event type
  if (MAJOR_EVENTS.has(eventType)) {
    severity = 'major';
  } else if (MODERATE_EVENTS.has(eventType)) {
    severity = 'moderate';
  } else if (MINOR_EVENTS.has(eventType)) {
    severity = 'minor';
  } else {
    // Default: new calls and dispatched events start at minor,
    // escalated by flags/priority below
    severity = 'minor';
  }

  // 2. Check call flags (only escalate, never downgrade)
  if (call && severity !== 'major') {
    // Check major flag combos
    for (const combo of MAJOR_FLAG_COMBOS) {
      if (combo(call)) {
        severity = 'major';
        break;
      }
    }

    // Check moderate flags
    if (severity === 'minor') {
      for (const flag of MODERATE_FLAGS) {
        if (call[flag]) {
          severity = 'moderate';
          break;
        }
      }
    }

    // P1 priority escalates to at least moderate
    if (severity === 'minor' && call.priority === 'P1') {
      severity = 'moderate';
    }
  }

  // 3. AI override (only escalates)
  if (aiSeverityOverride) {
    const rank = { minor: 0, moderate: 1, major: 2 };
    if (rank[aiSeverityOverride] > rank[severity]) {
      severity = aiSeverityOverride;
    }
  }

  // 4. New call events are at least minor with voice
  if (eventType === 'call_created' && severity === 'minor') {
    // New calls always get at least a moderate if they have any flags
    // Otherwise they stay minor but still get announced
  }

  return {
    severity,
    interrupt: severity === 'major',
    toneRepeats: severity === 'major' ? 3 : 1,
    urgentVoice: severity === 'major',
  };
}

/**
 * Get the dispatch tone type for a severity tier.
 */
export function getToneForSeverity(severity: AlertSeverity): string {
  switch (severity) {
    case 'minor': return 'info';
    case 'moderate': return 'caution';
    case 'major': return 'alarm';
  }
}

/**
 * Check if user's minimum tier setting allows this alert to play audio.
 */
export function shouldPlayAudio(severity: AlertSeverity): boolean {
  const minTier = localStorage.getItem('rmpg-alert-min-tier') || 'minor';
  const rank = { minor: 0, moderate: 1, major: 2 };
  return rank[severity] >= rank[minTier as AlertSeverity];
}
```

**Step 2: Commit**

```bash
git add client/src/utils/alertSeverity.ts
git commit -m "feat: add three-tier alert severity classifier (minor/moderate/major)"
```

---

### Task 3: Create Edge-TTS Server Endpoint

**Files:**
- Create: `server/src/routes/tts.ts`
- Modify: `server/src/routes/index.ts` (or wherever routes are mounted — check `server/src/index.ts`)

**Step 1: Find where routes are mounted**

Run:
```bash
grep -n "app.use.*routes\|app.use.*router\|import.*routes" server/src/index.ts
```

Note the pattern for mounting new routes.

**Step 2: Create the TTS route**

```typescript
import { Router, Request, Response } from 'express';
import { streamSpeech } from '@bestcodes/edge-tts';
import { authenticateToken } from '../middleware/auth';

const router = Router();
router.use(authenticateToken);

// LRU cache for common phrases (max 200 entries)
const ttsCache = new Map<string, Buffer>();
const CACHE_MAX = 200;

function cacheKey(text: string, urgent: boolean): string {
  return `${urgent ? 'U:' : ''}${text}`;
}

function addToCache(key: string, data: Buffer): void {
  if (ttsCache.size >= CACHE_MAX) {
    // Delete oldest entry
    const firstKey = ttsCache.keys().next().value;
    if (firstKey) ttsCache.delete(firstKey);
  }
  ttsCache.set(key, data);
}

/**
 * POST /api/tts
 * Generate neural TTS audio from text.
 * Body: { text: string, urgent?: boolean }
 * Returns: audio/mpeg
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { text, urgent } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'text is required' });
    }

    // Limit text length to prevent abuse
    if (text.length > 500) {
      return res.status(400).json({ error: 'text too long (max 500 chars)' });
    }

    // Check cache
    const key = cacheKey(text, !!urgent);
    const cached = ttsCache.get(key);
    if (cached) {
      res.set('Content-Type', 'audio/mpeg');
      res.set('X-TTS-Cache', 'hit');
      return res.send(cached);
    }

    // Voice config
    const voice = 'en-US-JennyNeural';
    const rate = urgent ? '+15%' : '+5%';
    const pitch = urgent ? '+5Hz' : '+0Hz';
    const volume = urgent ? '+10%' : '+0%';

    // Stream and collect audio chunks
    const chunks: Buffer[] = [];
    for await (const chunk of streamSpeech({
      text,
      voice,
      rate,
      pitch,
      volume,
    })) {
      if (chunk.type === 'audio' && chunk.data) {
        chunks.push(Buffer.from(chunk.data));
      }
    }

    if (chunks.length === 0) {
      return res.status(500).json({ error: 'TTS generated no audio' });
    }

    const audioBuffer = Buffer.concat(chunks);

    // Cache the result
    addToCache(key, audioBuffer);

    res.set('Content-Type', 'audio/mpeg');
    res.set('X-TTS-Cache', 'miss');
    res.send(audioBuffer);
  } catch (err: any) {
    console.error('[TTS] Error:', err.message);
    res.status(500).json({ error: 'TTS generation failed' });
  }
});

export default router;
```

**Step 3: Mount the route**

Add to the server's route mounting file (likely `server/src/index.ts` or similar):

```typescript
import ttsRouter from './routes/tts';
// ... alongside other route mounts:
app.use('/api/tts', ttsRouter);
```

**Step 4: Test the endpoint**

Run the dev server, then:
```bash
curl -X POST http://localhost:3001/api/tts \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <test_token>" \
  -d '{"text":"All units, priority one call, 200 South State Street"}' \
  --output /tmp/test-tts.mp3
```

Verify the file plays and sounds like a natural female voice.

**Step 5: Commit**

```bash
git add server/src/routes/tts.ts server/src/index.ts
git commit -m "feat: add Edge-TTS neural voice endpoint (POST /api/tts)"
```

---

### Task 4: Create Client-Side Edge-TTS Audio Player

**Files:**
- Create: `client/src/utils/edgeTTS.ts`

**Step 1: Create the client-side TTS module**

This module fetches audio from the server TTS endpoint, applies radio bandpass filtering, manages a priority queue, and falls back to browser SpeechSynthesis on failure.

```typescript
/**
 * Edge-TTS Client
 *
 * Fetches neural TTS audio from /api/tts, applies radio bandpass filter,
 * manages a priority queue (major interrupts minor/moderate), and falls
 * back to browser SpeechSynthesis on failure.
 */

import { playToneAsync } from './dispatchTones';
import type { AlertSeverity } from './alertSeverity';
import { getToneForSeverity, shouldPlayAudio } from './alertSeverity';

// ---------- Audio Context (lazy init) ----------

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new AudioContext();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

// ---------- Radio Bandpass Filter ----------

function createRadioBandpass(ctx: AudioContext): BiquadFilterNode {
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 1350;
  filter.Q.value = 2.5;
  return filter;
}

// ---------- Queue ----------

interface QueueEntry {
  text: string;
  severity: AlertSeverity;
  urgent: boolean;
  resolve: () => void;
}

const queue: QueueEntry[] = [];
let isPlaying = false;

// ---------- Core Playback ----------

async function fetchAndPlay(text: string, urgent: boolean): Promise<void> {
  const token = localStorage.getItem('rmpg-token');
  if (!token) return;

  const resp = await fetch('/api/tts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ text, urgent }),
  });

  if (!resp.ok) throw new Error(`TTS HTTP ${resp.status}`);

  const arrayBuf = await resp.arrayBuffer();
  const ctx = getAudioContext();
  const audioBuf = await ctx.decodeAudioData(arrayBuf);

  // Apply radio bandpass filter for authentic dispatch sound
  const source = ctx.createBufferSource();
  source.buffer = audioBuf;

  const bandpass = createRadioBandpass(ctx);
  const gain = ctx.createGain();
  gain.gain.value = 0.85;

  source.connect(bandpass);
  bandpass.connect(gain);
  gain.connect(ctx.destination);

  return new Promise<void>((resolve) => {
    source.onended = () => resolve();
    source.start();
  });
}

/**
 * Fallback: use browser SpeechSynthesis if Edge-TTS fails.
 */
async function fallbackBrowserTTS(text: string): Promise<void> {
  return new Promise<void>((resolve) => {
    if (!window.speechSynthesis) {
      resolve();
      return;
    }
    const utt = new SpeechSynthesisUtterance(text);
    utt.rate = 0.95;
    utt.pitch = 1.02;
    utt.volume = 0.92;
    // Try to find a good female voice
    const voices = window.speechSynthesis.getVoices();
    const preferred = ['Samantha', 'Karen', 'Zira', 'Jenny'];
    for (const name of preferred) {
      const v = voices.find((v) => v.name.includes(name));
      if (v) { utt.voice = v; break; }
    }
    utt.onend = () => resolve();
    utt.onerror = () => resolve();
    window.speechSynthesis.speak(utt);
  });
}

async function processQueue(): Promise<void> {
  if (isPlaying || queue.length === 0) return;
  isPlaying = true;

  while (queue.length > 0) {
    const entry = queue.shift()!;
    try {
      await fetchAndPlay(entry.text, entry.urgent);
    } catch (err) {
      console.warn('[EdgeTTS] Falling back to browser TTS:', err);
      await fallbackBrowserTTS(entry.text);
    }
    entry.resolve();
  }

  isPlaying = false;
}

// ---------- Public API ----------

/**
 * Speak text using Edge-TTS with tiered severity handling.
 *
 * Major alerts interrupt the queue and play immediately.
 * Moderate/minor alerts are queued in order.
 */
export async function speak(
  text: string,
  severity: AlertSeverity = 'minor'
): Promise<void> {
  // Check master sound + voice toggles
  if (localStorage.getItem('rmpg-sound') === 'false') return;
  if (localStorage.getItem('rmpg-voice-alerts') === 'false') return;
  if (!shouldPlayAudio(severity)) return;

  const urgent = severity === 'major';

  // Major interrupts: clear lower-priority items from queue
  if (urgent) {
    // Remove minor/moderate from queue (keep other majors)
    for (let i = queue.length - 1; i >= 0; i--) {
      if (queue[i].severity !== 'major') {
        queue[i].resolve(); // resolve their promises
        queue.splice(i, 1);
      }
    }
  }

  return new Promise<void>((resolve) => {
    queue.push({ text, severity, urgent, resolve });
    processQueue();
  });
}

/**
 * Play the appropriate tone for severity, then speak the text.
 * This is the main entry point for the alert system.
 */
export async function announceWithSeverity(
  text: string,
  severity: AlertSeverity
): Promise<void> {
  if (localStorage.getItem('rmpg-sound') === 'false') return;
  if (!shouldPlayAudio(severity)) return;

  const toneType = getToneForSeverity(severity);
  const classification = { toneRepeats: severity === 'major' ? 3 : 1 };

  // Play tone(s)
  for (let i = 0; i < classification.toneRepeats; i++) {
    await playToneAsync(toneType as any);
    if (i < classification.toneRepeats - 1) {
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  // Brief pause between tone and voice
  await new Promise((r) => setTimeout(r, 400));

  // Speak
  await speak(text, severity);
}

/**
 * Clear all pending speech.
 */
export function clearQueue(): void {
  for (const entry of queue) entry.resolve();
  queue.length = 0;
}

/**
 * Check if Edge-TTS engine is selected (vs browser fallback).
 */
export function isEdgeTTSEnabled(): boolean {
  return localStorage.getItem('rmpg-voice-engine') !== 'browser';
}
```

**Step 2: Commit**

```bash
git add client/src/utils/edgeTTS.ts
git commit -m "feat: add Edge-TTS client with radio bandpass filter and priority queue"
```

---

### Task 5: Create Alert Banner Component

**Files:**
- Create: `client/src/components/AlertBanner.tsx`

**Step 1: Create the tiered alert banner**

This renders at the top of Layout.tsx — minor alerts flash blue and auto-dismiss, moderate pulse amber until acknowledged, major overlay red with strobe.

```tsx
import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, Info, ShieldAlert, X } from 'lucide-react';
import type { AlertSeverity } from '../utils/alertSeverity';

export interface AlertBannerItem {
  id: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  timestamp: number;
}

interface AlertBannerProps {
  alerts: AlertBannerItem[];
  onDismiss: (id: string) => void;
  onDismissAll: () => void;
}

const SEVERITY_CONFIG = {
  minor: {
    bg: 'bg-blue-900/80 border-blue-500/50',
    icon: Info,
    iconColor: 'text-blue-400',
    label: 'INFO',
    autoDismissMs: 5000,
  },
  moderate: {
    bg: 'bg-amber-900/80 border-amber-500/50 animate-pulse',
    icon: AlertTriangle,
    iconColor: 'text-amber-400',
    label: 'ALERT',
    autoDismissMs: 0, // persistent
  },
  major: {
    bg: 'bg-red-900/90 border-red-500/70',
    icon: ShieldAlert,
    iconColor: 'text-red-400',
    label: 'EMERGENCY',
    autoDismissMs: 0, // persistent
  },
} as const;

export default function AlertBanner({ alerts, onDismiss, onDismissAll }: AlertBannerProps) {
  // Auto-dismiss minor alerts
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const alert of alerts) {
      const ms = SEVERITY_CONFIG[alert.severity].autoDismissMs;
      if (ms > 0) {
        timers.push(setTimeout(() => onDismiss(alert.id), ms));
      }
    }
    return () => timers.forEach(clearTimeout);
  }, [alerts, onDismiss]);

  if (alerts.length === 0) return null;

  // Sort: major first, then moderate, then minor
  const sorted = [...alerts].sort((a, b) => {
    const rank = { major: 2, moderate: 1, minor: 0 };
    return rank[b.severity] - rank[a.severity];
  });

  const hasMajor = sorted.some((a) => a.severity === 'major');

  return (
    <>
      {/* Major alert: full-screen red overlay with strobe */}
      {hasMajor && (
        <div className="fixed inset-0 z-[9998] pointer-events-none animate-[strobe_1s_ease-in-out_3]"
          style={{ background: 'radial-gradient(circle, rgba(220,38,38,0.15) 0%, transparent 70%)' }}
        />
      )}

      {/* Alert stack */}
      <div className="fixed top-0 left-0 right-0 z-[9999] flex flex-col items-center gap-1 p-2 pointer-events-none">
        {sorted.map((alert) => {
          const config = SEVERITY_CONFIG[alert.severity];
          const Icon = config.icon;
          return (
            <div
              key={alert.id}
              className={`pointer-events-auto flex items-center gap-3 px-4 py-2 rounded border
                font-mono text-sm text-white max-w-2xl w-full ${config.bg}`}
            >
              <Icon className={`w-5 h-5 flex-shrink-0 ${config.iconColor}`} />
              <span className={`text-xs font-bold ${config.iconColor} tracking-wider`}>
                {config.label}
              </span>
              <span className="flex-1 truncate">{alert.title}: {alert.message}</span>
              <button
                onClick={() => onDismiss(alert.id)}
                className="p-1 hover:bg-white/10 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          );
        })}
        {alerts.length > 2 && (
          <button
            onClick={onDismissAll}
            className="pointer-events-auto text-xs text-gray-400 hover:text-white mt-1"
          >
            Dismiss all ({alerts.length})
          </button>
        )}
      </div>
    </>
  );
}
```

Add the strobe keyframe to `client/src/index.css` (or global CSS):

```css
@keyframes strobe {
  0%, 100% { opacity: 0; }
  50% { opacity: 1; }
}
```

**Step 2: Commit**

```bash
git add client/src/components/AlertBanner.tsx client/src/index.css
git commit -m "feat: add tiered AlertBanner component (minor/moderate/major)"
```

---

### Task 6: Integrate Severity + Edge-TTS into Voice Alerts Hook

**Files:**
- Modify: `client/src/hooks/useDispatchVoiceAlerts.ts`
- Modify: `client/src/components/Layout.tsx` (add AlertBanner state + rendering)

**Step 1: Rewrite useDispatchVoiceAlerts to use severity tiers + Edge-TTS**

The hook currently calls voiceAlerts.ts functions directly with browser SpeechSynthesis. Update it to:
1. Classify each event with `classifySeverity()`
2. Play tiered tones via `getToneForSeverity()`
3. Speak via `announceWithSeverity()` (Edge-TTS with fallback)
4. Push visual alerts to AlertBanner via a callback

Key changes in `useDispatchVoiceAlerts.ts`:
- Import `classifySeverity` from `../utils/alertSeverity`
- Import `announceWithSeverity` from `../utils/edgeTTS`
- Keep existing `normalizeCallForVoice()` helper
- Replace direct `announceNewCall()`, `announcePanicAlert()`, etc. calls with the new severity pipeline
- Accept an `onAlert` callback prop to push AlertBanner items
- Keep the existing voiceAlerts.ts functions as the text-building layer (they format the dispatch phrases), but route audio through Edge-TTS instead of browser SpeechSynthesis

The existing `voiceAlerts.ts` phrase-building functions (`announceNewCall`, `announcePanicAlert`, etc.) should be refactored to return text strings instead of directly speaking. Then `useDispatchVoiceAlerts` pipes those strings through the new severity + Edge-TTS pipeline.

**Step 2: Add AlertBanner state to Layout.tsx**

In Layout.tsx, add:
```tsx
import AlertBanner, { AlertBannerItem } from './AlertBanner';

// In the component:
const [alerts, setAlerts] = useState<AlertBannerItem[]>([]);
const addAlert = useCallback((alert: AlertBannerItem) => {
  setAlerts(prev => [...prev, alert]);
}, []);
const dismissAlert = useCallback((id: string) => {
  setAlerts(prev => prev.filter(a => a.id !== id));
}, []);
const dismissAll = useCallback(() => setAlerts([]), []);

// Pass to hook:
useDispatchVoiceAlerts({ onAlert: addAlert });

// In JSX, above the main content:
<AlertBanner alerts={alerts} onDismiss={dismissAlert} onDismissAll={dismissAll} />
```

**Step 3: Test by triggering a dispatch event**

Create a test call in the dispatch page, verify:
- Minor events: soft pip + brief Edge-TTS voice + blue banner that auto-dismisses
- Moderate events (add DV flag): caution tone + full dispatch read + amber persistent banner
- Major events (panic button): 3x alarm warble + urgent voice + red overlay

**Step 4: Commit**

```bash
git add client/src/hooks/useDispatchVoiceAlerts.ts client/src/components/Layout.tsx
git commit -m "feat: integrate severity tiers + Edge-TTS into dispatch voice alerts"
```

---

### Task 7: Add Voice/Alert Settings Controls

**Files:**
- Modify: The settings page or user preferences section (find via `grep -rn "rmpg-sound\|rmpg-voice" client/src/`)

**Step 1: Find the existing sound/voice toggle location**

Run:
```bash
grep -rn "rmpg-sound\|rmpg-voice\|Sound.*toggle\|Voice.*toggle" client/src/pages/ client/src/components/
```

**Step 2: Add new settings toggles**

Add to the existing settings section:
- **Voice Engine**: Toggle between `edge-tts` (neural) and `browser` (SpeechSynthesis fallback)
  - Key: `rmpg-voice-engine`, values: `'edge-tts'` | `'browser'`
- **Minimum Alert Tier**: Dropdown — Minor (all alerts), Moderate (skip routine), Major (emergencies only)
  - Key: `rmpg-alert-min-tier`, values: `'minor'` | `'moderate'` | `'major'`
- **AI Assist**: Toggle Groq AI features on/off
  - Key: `rmpg-ai-assist`, values: `'true'` | `'false'`

**Step 3: Commit**

```bash
git add <settings-file>
git commit -m "feat: add voice engine, alert tier, and AI assist user settings"
```

---

## Phase 2: Groq AI Integration

### Task 8: Create Groq AI Server Module

**Files:**
- Create: `server/src/utils/groqAI.ts`

**Step 1: Create the Groq AI utility module**

```typescript
import Groq from 'groq-sdk';

// Graceful: if no API key, all functions return null
const apiKey = process.env.GROQ_API_KEY;
const client = apiKey ? new Groq({ apiKey }) : null;

const MODEL = 'llama-3.3-70b-versatile';

// Simple rate limiter: max 25 req/min (stay under Groq's 30 limit)
let requestTimestamps: number[] = [];
const RATE_LIMIT = 25;
const RATE_WINDOW_MS = 60_000;

function checkRateLimit(): boolean {
  const now = Date.now();
  requestTimestamps = requestTimestamps.filter((t) => now - t < RATE_WINDOW_MS);
  if (requestTimestamps.length >= RATE_LIMIT) return false;
  requestTimestamps.push(now);
  return true;
}

// ---------- System Prompts ----------

const CALL_ANALYSIS_PROMPT = `You are an experienced police dispatcher and crime analyst for a private security company (Rocky Mountain Protective Group) in Salt Lake City, Utah.

Analyze the following call-for-service data and provide:
1. "suggestedFlags" — an array of risk factor strings detected in the narrative that aren't already flagged. Valid flags: weapons_involved, domestic_violence, mental_health_crisis, felony_in_progress, officer_safety_caution, gang_related, hazmat, injuries_reported, drugs_involved, alcohol_involved, vehicle_pursuit, foot_pursuit
2. "safetyBriefing" — a 1-2 sentence officer safety summary in dispatch radio style (concise, direct, actionable)
3. "severityOverride" — null, "moderate", or "major" if the narrative suggests higher severity than current flags indicate
4. "confidence" — 0.0 to 1.0 confidence in your analysis

Respond ONLY with valid JSON. No markdown, no explanation.`;

const NARRATIVE_PROMPT = `You are a CAD (Computer-Aided Dispatch) narrative writer for a private security company.

Convert the dispatcher's brief notes into a proper CAD narrative following these rules:
- Use third person, past/present tense
- Start with "RP" (reporting party) context
- Include location details
- Note subject descriptions, weapons, vehicle info
- End with current status/action needed
- Keep it factual, concise, professional
- 2-4 sentences maximum

Return ONLY the narrative text, no quotes or formatting.`;

const UNIT_SUGGESTION_PROMPT = `You are a dispatch supervisor for a private security company. Given a call-for-service and available units with GPS positions, suggest the best units to dispatch.

Consider:
1. Proximity (closest units first)
2. Availability (prefer 'available' status)
3. Specialization (K9 for drug calls, etc.)
4. Workload balance (avoid overloading one unit)

Return a JSON array of objects: [{"call_sign": "...", "reason": "..."}] ordered by priority.
Max 3 suggestions. Return ONLY valid JSON.`;

// ---------- Public API ----------

export interface CallAnalysis {
  suggestedFlags: string[];
  safetyBriefing: string;
  severityOverride: 'moderate' | 'major' | null;
  confidence: number;
}

/**
 * Analyze a call's narrative for risk factors and generate a safety briefing.
 * Returns null if AI is unavailable or rate-limited.
 */
export async function analyzeCall(callData: {
  incident_type: string;
  description?: string;
  notes?: string;
  location_address?: string;
  existing_flags?: string[];
}): Promise<CallAnalysis | null> {
  if (!client || !checkRateLimit()) return null;

  try {
    const userMsg = JSON.stringify({
      incident_type: callData.incident_type,
      description: callData.description || '',
      notes: callData.notes || '',
      location: callData.location_address || '',
      already_flagged: callData.existing_flags || [],
    });

    const resp = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: CALL_ANALYSIS_PROMPT },
        { role: 'user', content: userMsg },
      ],
      temperature: 0.3,
      max_tokens: 300,
      response_format: { type: 'json_object' },
    });

    const content = resp.choices[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content) as CallAnalysis;

    // Validate
    if (!Array.isArray(parsed.suggestedFlags)) parsed.suggestedFlags = [];
    if (typeof parsed.safetyBriefing !== 'string') parsed.safetyBriefing = '';
    if (typeof parsed.confidence !== 'number') parsed.confidence = 0;
    if (!['moderate', 'major', null].includes(parsed.severityOverride)) {
      parsed.severityOverride = null;
    }

    return parsed;
  } catch (err: any) {
    console.error('[GroqAI] analyzeCall error:', err.message);
    return null;
  }
}

/**
 * Generate a proper CAD narrative from dispatcher's brief notes.
 * Returns null if AI is unavailable or rate-limited.
 */
export async function generateNarrative(input: {
  notes: string;
  incident_type?: string;
  location_address?: string;
}): Promise<string | null> {
  if (!client || !checkRateLimit()) return null;

  try {
    const userMsg = `Incident: ${input.incident_type || 'Unknown'}
Location: ${input.location_address || 'Unknown'}
Dispatcher notes: ${input.notes}`;

    const resp = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: NARRATIVE_PROMPT },
        { role: 'user', content: userMsg },
      ],
      temperature: 0.4,
      max_tokens: 200,
    });

    return resp.choices[0]?.message?.content?.trim() || null;
  } catch (err: any) {
    console.error('[GroqAI] generateNarrative error:', err.message);
    return null;
  }
}

/**
 * Suggest best units to dispatch for a call.
 * Returns null if AI is unavailable or rate-limited.
 */
export async function suggestUnits(input: {
  call: { incident_type: string; priority: string; location_address: string; latitude: number; longitude: number; flags: string[] };
  units: Array<{ call_sign: string; status: string; latitude?: number; longitude?: number; current_calls?: number; specializations?: string[] }>;
}): Promise<Array<{ call_sign: string; reason: string }> | null> {
  if (!client || !checkRateLimit()) return null;

  try {
    const resp = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: UNIT_SUGGESTION_PROMPT },
        { role: 'user', content: JSON.stringify(input) },
      ],
      temperature: 0.2,
      max_tokens: 200,
      response_format: { type: 'json_object' },
    });

    const content = resp.choices[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content);
    // Handle both {suggestions: [...]} and direct array
    const arr = Array.isArray(parsed) ? parsed : parsed.suggestions || parsed.units || [];
    return arr.filter((u: any) => u.call_sign && u.reason);
  } catch (err: any) {
    console.error('[GroqAI] suggestUnits error:', err.message);
    return null;
  }
}

/**
 * Check if AI is available (API key configured).
 */
export function isAIAvailable(): boolean {
  return !!client;
}
```

**Step 2: Add `GROQ_API_KEY` to .env template**

Add to `server/.env.example` (or note in docs — do NOT modify production `.env` from here):

```
GROQ_API_KEY=gsk_your_key_here
```

**Step 3: Commit**

```bash
git add server/src/utils/groqAI.ts
git commit -m "feat: add Groq AI utility (call analysis, narrative generation, unit suggestions)"
```

---

### Task 9: Create AI API Routes

**Files:**
- Create: `server/src/routes/ai.ts`
- Modify: `server/src/index.ts` (mount route)

**Step 1: Create the AI routes**

```typescript
import { Router, Request, Response } from 'express';
import { authenticateToken, requireRole } from '../middleware/auth';
import { analyzeCall, generateNarrative, suggestUnits, isAIAvailable } from '../utils/groqAI';
import { auditLog } from '../utils/auditLogger';

const router = Router();
router.use(authenticateToken);

/**
 * GET /api/ai/status
 * Check if AI is available.
 */
router.get('/status', (_req: Request, res: Response) => {
  res.json({ available: isAIAvailable() });
});

/**
 * POST /api/ai/analyze
 * Analyze a call narrative for risk factors.
 * Body: { incident_type, description?, notes?, location_address?, existing_flags? }
 */
router.post('/analyze', requireRole(['admin', 'manager', 'supervisor', 'dispatcher']), async (req: Request, res: Response) => {
  try {
    const result = await analyzeCall(req.body);
    if (!result) {
      return res.json({ available: false, result: null });
    }
    res.json({ available: true, result });
  } catch (err: any) {
    console.error('[AI Route] analyze error:', err.message);
    res.status(500).json({ error: 'AI analysis failed' });
  }
});

/**
 * POST /api/ai/narrative
 * Generate a CAD narrative from brief notes.
 * Body: { notes, incident_type?, location_address? }
 */
router.post('/narrative', requireRole(['admin', 'manager', 'supervisor', 'dispatcher', 'officer']), async (req: Request, res: Response) => {
  try {
    const { notes, incident_type, location_address } = req.body;
    if (!notes || typeof notes !== 'string') {
      return res.status(400).json({ error: 'notes is required' });
    }
    const narrative = await generateNarrative({ notes, incident_type, location_address });
    if (!narrative) {
      return res.json({ available: false, narrative: null });
    }
    res.json({ available: true, narrative });
  } catch (err: any) {
    console.error('[AI Route] narrative error:', err.message);
    res.status(500).json({ error: 'Narrative generation failed' });
  }
});

/**
 * POST /api/ai/suggest-units
 * Suggest best units to dispatch.
 * Body: { call: {...}, units: [...] }
 */
router.post('/suggest-units', requireRole(['admin', 'manager', 'supervisor', 'dispatcher']), async (req: Request, res: Response) => {
  try {
    const suggestions = await suggestUnits(req.body);
    if (!suggestions) {
      return res.json({ available: false, suggestions: null });
    }
    res.json({ available: true, suggestions });
  } catch (err: any) {
    console.error('[AI Route] suggest-units error:', err.message);
    res.status(500).json({ error: 'Unit suggestion failed' });
  }
});

export default router;
```

**Step 2: Mount the route**

In the server's route mounting file:
```typescript
import aiRouter from './routes/ai';
app.use('/api/ai', aiRouter);
```

**Step 3: Commit**

```bash
git add server/src/routes/ai.ts server/src/index.ts
git commit -m "feat: add AI API routes (analyze, narrative, suggest-units)"
```

---

### Task 10: Auto-Analyze Calls on Creation/Update

**Files:**
- Modify: `server/src/routes/dispatch/calls.ts`

**Step 1: Add AI analysis to POST / (call creation) handler**

After the call is created and broadcast (around line 581 in calls.ts), add an async AI analysis that runs in the background (non-blocking):

```typescript
import { analyzeCall, isAIAvailable } from '../../utils/groqAI';

// After the main broadcast in POST /:
// --- AI Analysis (non-blocking) ---
if (isAIAvailable()) {
  const existingFlags = [
    weapons_involved && 'weapons_involved',
    domestic_violence && 'domestic_violence',
    mental_health_crisis && 'mental_health_crisis',
    felony_in_progress && 'felony_in_progress',
    officer_safety_caution && 'officer_safety_caution',
    hazmat && 'hazmat',
    gang_related && 'gang_related',
  ].filter(Boolean) as string[];

  analyzeCall({
    incident_type,
    description,
    notes,
    location_address,
    existing_flags: existingFlags,
  }).then((analysis) => {
    if (analysis && analysis.confidence > 0.7 && analysis.safetyBriefing) {
      broadcastDispatchUpdate({
        action: 'ai_analysis',
        call_id: id,
        call_number: callNumber,
        analysis,
      });
    }
  }).catch((err) => console.error('[AI] Auto-analyze error:', err));
}
```

**Step 2: Also add to PUT /:id when description/notes change**

Similar pattern — after the broadcast on update (around line 1080), if `description` or `notes` changed, trigger re-analysis.

**Step 3: Commit**

```bash
git add server/src/routes/dispatch/calls.ts
git commit -m "feat: auto-analyze calls with Groq AI on creation and narrative updates"
```

---

### Task 11: Add AI Dispatch Sidebar to DispatchPage

**Files:**
- Create: `client/src/components/dispatch/AIDispatchSidebar.tsx`
- Modify: `client/src/pages/dispatch/DispatchPage.tsx`

**Step 1: Create the AI sidebar component**

This shows AI analysis results for the selected call: safety briefing, suggested flags, and unit suggestions. It also has a "Generate Narrative" button.

The sidebar should:
- Subscribe to `ai_analysis` WebSocket events
- Show safety briefing with severity badge
- Show suggested flags as toggleable chips (dispatcher can accept/reject)
- Show AI-suggested units with "Dispatch" buttons
- Have a "Generate Narrative" button that calls POST `/api/ai/narrative`
- Display "AI Unavailable" gracefully when no API key

**Step 2: Integrate into DispatchPage.tsx**

Add the sidebar to the right side of the dispatch page, visible when a call is selected. Use a collapsible panel (like existing detail panels).

Wire up:
- Pass selected call data to sidebar
- Handle "accept flag" → update call via PUT
- Handle "dispatch suggested unit" → existing dispatch action
- Handle "use narrative" → populate description field with AI draft

**Step 3: Handle the `ai_analysis` WebSocket event in DispatchPage**

In the existing WebSocket subscription block, add:
```typescript
// In the dispatch_update handler, add case:
if (data.action === 'ai_analysis') {
  // Store analysis for the relevant call
  setAiAnalysis(prev => ({ ...prev, [data.call_id]: data.analysis }));
}
```

**Step 4: Commit**

```bash
git add client/src/components/dispatch/AIDispatchSidebar.tsx client/src/pages/dispatch/DispatchPage.tsx
git commit -m "feat: add AI dispatch sidebar with analysis, narrative assist, and unit suggestions"
```

---

### Task 12: Add Narrative Assist Button

**Files:**
- Create: `client/src/components/dispatch/NarrativeAssist.tsx`
- Modify: `client/src/pages/dispatch/DispatchPage.tsx` (add button near description/notes fields)

**Step 1: Create NarrativeAssist component**

A small button that sits next to the call description/notes textarea. When clicked:
1. Takes current notes text
2. Calls POST `/api/ai/narrative`
3. Shows the AI draft in a preview below
4. Dispatcher reviews and clicks "Use This" or "Discard"
5. "Use This" populates the field (does NOT auto-save)

```tsx
// NarrativeAssist.tsx — compact AI narrative button + preview
interface NarrativeAssistProps {
  notes: string;
  incidentType?: string;
  locationAddress?: string;
  onAccept: (narrative: string) => void;
}
```

**Step 2: Add to DispatchPage edit form**

Find the description/notes textarea in DispatchPage.tsx (in the editing section) and add `<NarrativeAssist>` below it.

**Step 3: Commit**

```bash
git add client/src/components/dispatch/NarrativeAssist.tsx client/src/pages/dispatch/DispatchPage.tsx
git commit -m "feat: add AI narrative assist button for dispatch call editing"
```

---

## Phase 3: Polish & Integration

### Task 13: Wire AI Safety Briefing into Voice Alerts

**Files:**
- Modify: `client/src/hooks/useDispatchVoiceAlerts.ts`

**Step 1: When an `ai_analysis` event arrives with a safety briefing, announce it**

In the hook's WebSocket handler for `dispatch_update`, when `action === 'ai_analysis'`:
```typescript
if (data.analysis?.safetyBriefing && data.analysis.confidence > 0.7) {
  const severity = data.analysis.severityOverride || 'moderate';
  announceWithSeverity(
    `AI safety alert for call ${data.call_number}: ${data.analysis.safetyBriefing}`,
    severity
  );
}
```

**Step 2: Commit**

```bash
git add client/src/hooks/useDispatchVoiceAlerts.ts
git commit -m "feat: voice-announce AI safety briefings for high-confidence call analysis"
```

---

### Task 14: Enhance Dispatch Phrasing with Phonetic Alphabet

**Files:**
- Modify: `client/src/utils/voiceAlerts.ts`

**Step 1: Add phonetic alphabet conversion**

Add a `toPhonetic(text: string): string` function that converts license plates and callsigns to NATO phonetic alphabet (Alpha, Bravo, Charlie...). Update the phrase-building functions to use it for plate numbers and unit callsigns in voice announcements.

**Step 2: Update `naturalPhrase()` with more authentic dispatch cadence**

Add new phrase mappings for:
- 24-hour time announcements ("at fourteen-thirty hours")
- Cross-street references ("at the intersection of State and 200 South")
- Standard dispatch opener ("All units, all units" for major, "Attention [unit]" for directed)

**Step 3: Commit**

```bash
git add client/src/utils/voiceAlerts.ts
git commit -m "feat: add NATO phonetic alphabet and authentic dispatch phrasing"
```

---

### Task 15: Final Integration Test & Build

**Step 1: Run the dev server**

```bash
npm run dev
```

**Step 2: Test all three severity tiers**

1. Create a routine call (no flags) → expect minor pip + brief voice + blue banner
2. Create a call with `domestic_violence` flag → expect caution tone + full read + amber banner
3. Trigger panic button → expect 3x alarm warble + urgent voice + red overlay

**Step 3: Test AI features (requires GROQ_API_KEY in server/.env)**

1. Create a call with narrative "caller says ex broke in with a knife" → expect AI analysis broadcast with weapons flag suggestion
2. Click "AI Assist" on a call → expect generated narrative
3. Open dispatch panel → expect unit suggestions

**Step 4: Test fallback (no API key)**

Remove GROQ_API_KEY, restart server. Verify:
- AI sidebar shows "AI Unavailable" gracefully
- All voice/tone/banner features still work
- Edge-TTS still works (doesn't depend on Groq)

**Step 5: Build**

```bash
npm run build
```

Verify no TypeScript errors, no build failures.

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: complete voice + AI dispatch system integration"
```

---

## Summary

| Task | Phase | What It Does |
|------|-------|-------------|
| 1 | 1 | Install dependencies |
| 2 | 1 | Alert severity classifier (minor/moderate/major) |
| 3 | 1 | Edge-TTS server endpoint |
| 4 | 1 | Edge-TTS client player with radio filter |
| 5 | 1 | AlertBanner component (tiered visual alerts) |
| 6 | 1 | Integrate severity + Edge-TTS into voice hook |
| 7 | 1 | User settings (voice engine, tier filter, AI toggle) |
| 8 | 2 | Groq AI server module |
| 9 | 2 | AI API routes |
| 10 | 2 | Auto-analyze calls on create/update |
| 11 | 2 | AI dispatch sidebar in DispatchPage |
| 12 | 2 | Narrative assist button |
| 13 | 3 | Voice-announce AI safety briefings |
| 14 | 3 | Phonetic alphabet + authentic phrasing |
| 15 | 3 | Integration test + build |
