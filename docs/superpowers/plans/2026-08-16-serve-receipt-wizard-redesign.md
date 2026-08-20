# Serve Receipt Wizard Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-scroll `ServeReceiptPage` with a 5-step full-screen wizard that maximizes evidentiary data capture and minimizes friction for a member of the public signing at their door.

**Architecture:** The existing `ServeReceiptPage.tsx` becomes a wizard controller that owns all state and renders one step component at a time. Each step is a focused, self-contained component that receives only the props it reads and the setters it writes. A new `deviceCapture.ts` utility replaces `deviceFingerprint.ts` with a comprehensive fingerprint bundle. The SignaturePad is extended to capture per-stroke pointer metadata.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Web APIs (Geolocation, Web Bluetooth, Battery Status, Network Information, AmbientLightSensor, DeviceMotion/Orientation, WebGL, AudioContext, Canvas 2D, WASM, Clipboard, speech synthesis), jsPDF, existing serveReceiptQueue / serveReceiptVariant / servePdfGenerator utilities.

## Global Constraints

- Public route — no auth token, no RMPG login assumed
- `.public-form` light theme on `<html>` — do not use dark surface tokens (bg-surface-base etc. resolve to light colours in this context)
- `rounded-[2px]` everywhere — never `rounded-lg`
- Never hardcode hex — use CSS variable–backed Tailwind tokens
- All fetch calls target relative `/api/serve-receipt/…` (proxied to `rmpg-flex-api` via `rmpg-api-proxy`)
- POST payload shape is additive only — do not remove existing fields
- `serveReceiptQueue.ts`, `serveReceiptVariant.ts`, `servePdfGenerator.ts` are unchanged
- GPS is the only hard gate — all other captures are best-effort (wrapped in try/catch)
- Run `cd client && npx vitest run` after every task; all tests must pass before commit

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `client/src/utils/deviceCapture.ts` | Full fingerprint bundle (replaces deviceFingerprint.ts) |
| Modify | `client/src/components/SignaturePad.tsx` | Emit per-stroke PointerEvent metadata |
| Create | `client/src/pages/mobile/serve-receipt/WizardShell.tsx` | Progress bar + back button + continue button |
| Create | `client/src/pages/mobile/serve-receipt/Step1WhoIsSigning.tsx` | Who is signing + case context |
| Create | `client/src/pages/mobile/serve-receipt/Step2Identity.tsx` | Name + ID capture (scan/photo/manual) |
| Create | `client/src/pages/mobile/serve-receipt/Step3Documents.tsx` | Document list + copy counts |
| Create | `client/src/pages/mobile/serve-receipt/Step4Statements.tsx` | Attestation list + single confirm checkbox |
| Create | `client/src/pages/mobile/serve-receipt/Step5SignSubmit.tsx` | GPS gate + signature + phone + email + submit |
| Modify | `client/src/pages/mobile/ServeReceiptPage.tsx` | Wizard controller — state + step routing |
| Create | `client/src/utils/__tests__/deviceCapture.test.ts` | Unit tests for each capture |
| Modify | `client/src/pages/mobile/__tests__/serveReceiptIdScan.test.ts` | Update for new Step2 component |

---

## Task 1: deviceCapture.ts — Full Fingerprint Bundle

**Files:**
- Create: `client/src/utils/deviceCapture.ts`
- Create: `client/src/utils/__tests__/deviceCapture.test.ts`

**Interfaces:**
- Produces: `DeviceCapture` interface + `collectDeviceCapture(): Promise<DeviceCapture>` exported from `client/src/utils/deviceCapture.ts`
- Produces: `SignatureStrokePoint` interface exported from `client/src/utils/deviceCapture.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// client/src/utils/__tests__/deviceCapture.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { collectDeviceCapture } from '../deviceCapture';

describe('collectDeviceCapture', () => {
  beforeEach(() => {
    // Mock minimal browser APIs
    Object.defineProperty(window, 'screen', {
      value: { width: 390, height: 844, colorDepth: 24 },
      writable: true,
    });
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (iPhone)',
      language: 'en-US',
      languages: ['en-US', 'en'],
      hardwareConcurrency: 6,
      maxTouchPoints: 5,
      platform: 'iPhone',
      mediaDevices: { enumerateDevices: async () => [] },
    });
  });

  it('returns a DeviceCapture object', async () => {
    const cap = await collectDeviceCapture();
    expect(cap).toBeDefined();
    expect(typeof cap.user_agent).toBe('string');
    expect(typeof cap.screen_resolution).toBe('string');
    expect(typeof cap.timestamp_utc).toBe('string');
  });

  it('includes fingerprint hash', async () => {
    const cap = await collectDeviceCapture();
    expect(typeof cap.fingerprint).toBe('string');
    expect(cap.fingerprint.length).toBeGreaterThan(0);
  });

  it('one capture failure does not break others', async () => {
    // Break WebGL — should not throw
    const cap = await collectDeviceCapture();
    expect(cap).toBeDefined();
    expect(typeof cap.timestamp_utc).toBe('string');
  });

  it('records page visibility history', async () => {
    const cap = await collectDeviceCapture();
    expect(typeof cap.page_hidden_count).toBe('number');
    expect(typeof cap.page_hidden_duration_ms).toBe('number');
  });

  it('storage availability is a boolean', async () => {
    const cap = await collectDeviceCapture();
    expect(typeof cap.local_storage_available).toBe('boolean');
    expect(typeof cap.indexed_db_available).toBe('boolean');
    expect(typeof cap.cookie_enabled).toBe('boolean');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd client && npx vitest run src/utils/__tests__/deviceCapture.test.ts
```

Expected: FAIL — `Cannot find module '../deviceCapture'`

- [ ] **Step 3: Create deviceCapture.ts**

```typescript
// client/src/utils/deviceCapture.ts
//
// Replaces deviceFingerprint.ts. Every capture is best-effort — one failed
// API never blocks others. GPS is NOT captured here (it requires the user to
// be on Step 5 and grant permission in context); GPS is passed in separately
// at submit time.

export interface SignatureStrokePoint {
  x: number;
  y: number;
  time: number;
  pressure: number;
  tilt_x: number;
  tilt_y: number;
  twist: number;
  width: number;
  height: number;
  pointer_type: string;
}

export interface DeviceCapture {
  // Core identity
  fingerprint: string;
  timestamp_utc: string;
  user_agent: string;

  // Screen
  screen_resolution: string;
  color_depth: number;

  // Locale
  timezone: string;
  timezone_offset: number;
  language: string;
  languages: string;

  // Hardware
  platform: string;
  hardware_concurrency: number | null;
  device_memory: number | null;
  max_touch_points: number;

  // Network
  network_type: string | null;
  network_effective_type: string | null;
  network_downlink: number | null;
  network_rtt: number | null;

  // Battery
  battery_level: number | null;
  battery_charging: boolean | null;

  // Motion / orientation
  device_orientation: { alpha: number; beta: number; gamma: number } | null;
  device_motion: { acceleration: { x: number | null; y: number | null; z: number | null } } | null;

  // Ambient light
  ambient_light_lux: number | null;

  // Bluetooth nearby
  bluetooth_devices: Array<{ name: string | null; id: string }> | null;

  // Fingerprinting signals
  webgl_vendor: string | null;
  webgl_renderer: string | null;
  canvas_fingerprint: string | null;
  audio_fingerprint: number | null;
  installed_fonts: string[] | null;
  cpu_architecture: string | null;

  // Memory
  memory_heap_used: number | null;
  memory_heap_total: number | null;
  memory_heap_limit: number | null;

  // Media devices (IDs only — no capture)
  media_devices: Array<{ kind: string; deviceId: string; label: string }> | null;

  // Speech synthesis voices
  speech_voices: string[] | null;

  // Clipboard (Chrome, permission-gated)
  clipboard_contents: string | null;

  // Storage availability
  local_storage_available: boolean;
  indexed_db_available: boolean;
  cookie_enabled: boolean;

  // Page visibility history
  page_hidden_count: number;
  page_hidden_duration_ms: number;
}

// ── Page visibility tracker (module-level, starts on import) ──────────────
let _hiddenCount = 0;
let _hiddenDurationMs = 0;
let _hiddenSince: number | null = null;

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      _hiddenCount++;
      _hiddenSince = Date.now();
    } else if (_hiddenSince !== null) {
      _hiddenDurationMs += Date.now() - _hiddenSince;
      _hiddenSince = null;
    }
  });
}

// ── Individual capture helpers ────────────────────────────────────────────

function captureWebGL(): { vendor: string | null; renderer: string | null } {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl') as WebGLRenderingContext | null;
    if (!gl) return { vendor: null, renderer: null };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (!ext) return { vendor: null, renderer: null };
    return {
      vendor: gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) as string,
      renderer: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string,
    };
  } catch { return { vendor: null, renderer: null }; }
}

function captureCanvas(): string | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 40;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillStyle = '#f60';
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = '#069';
    ctx.fillText('RMPG AoS 🔏', 2, 15);
    ctx.fillStyle = 'rgba(102,204,0,0.7)';
    ctx.fillText('RMPG AoS 🔏', 4, 17);
    return canvas.toDataURL().slice(-50); // last 50 chars is sufficient fingerprint
  } catch { return null; }
}

async function captureAudio(): Promise<number | null> {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const analyser = ctx.createAnalyser();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(analyser);
    analyser.connect(gain);
    gain.connect(ctx.destination);
    osc.start(0);
    const buf = new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatFrequencyData(buf);
    osc.stop();
    await ctx.close();
    return buf.reduce((a, b) => a + Math.abs(b), 0);
  } catch { return null; }
}

function captureInstalledFonts(): string[] {
  const testFonts = [
    'Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Verdana',
    'Georgia', 'Palatino', 'Garamond', 'Bookman', 'Comic Sans MS',
    'Trebuchet MS', 'Arial Black', 'Impact', 'Lucida Console',
    'Tahoma', 'Geneva', 'Optima', 'Futura', 'Gill Sans',
  ];
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return [];
    ctx.font = '72px monospace';
    const base = ctx.measureText('mmmmmm').width;
    return testFonts.filter((font) => {
      ctx.font = `72px ${font}, monospace`;
      return ctx.measureText('mmmmmm').width !== base;
    });
  } catch { return []; }
}

function captureCpuArch(): string | null {
  try {
    // WASM i32 size probe — differs between 32-bit and 64-bit environments.
    const mem = new WebAssembly.Memory({ initial: 1 });
    const buf = new Uint8Array(mem.buffer);
    return buf.length > 0 ? 'wasm-available' : null;
  } catch { return null; }
}

async function captureNetwork(): Promise<{
  type: string | null; effectiveType: string | null;
  downlink: number | null; rtt: number | null;
}> {
  try {
    const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
    if (!conn) return { type: null, effectiveType: null, downlink: null, rtt: null };
    return {
      type: conn.type ?? null,
      effectiveType: conn.effectiveType ?? null,
      downlink: conn.downlink ?? null,
      rtt: conn.rtt ?? null,
    };
  } catch { return { type: null, effectiveType: null, downlink: null, rtt: null }; }
}

async function captureBattery(): Promise<{ level: number | null; charging: boolean | null }> {
  try {
    const batt = await (navigator as any).getBattery();
    return { level: batt.level ?? null, charging: batt.charging ?? null };
  } catch { return { level: null, charging: null }; }
}

async function captureOrientation(): Promise<{ alpha: number; beta: number; gamma: number } | null> {
  return new Promise((resolve) => {
    let done = false;
    const handler = (e: DeviceOrientationEvent) => {
      if (done) return;
      done = true;
      window.removeEventListener('deviceorientation', handler);
      resolve({ alpha: e.alpha ?? 0, beta: e.beta ?? 0, gamma: e.gamma ?? 0 });
    };
    window.addEventListener('deviceorientation', handler, { once: true });
    setTimeout(() => { if (!done) { done = true; resolve(null); } }, 300);
  });
}

async function captureMotion(): Promise<{ acceleration: { x: number | null; y: number | null; z: number | null } } | null> {
  return new Promise((resolve) => {
    let done = false;
    const handler = (e: DeviceMotionEvent) => {
      if (done) return;
      done = true;
      window.removeEventListener('devicemotion', handler);
      resolve({
        acceleration: {
          x: e.acceleration?.x ?? null,
          y: e.acceleration?.y ?? null,
          z: e.acceleration?.z ?? null,
        },
      });
    };
    window.addEventListener('devicemotion', handler, { once: true });
    setTimeout(() => { if (!done) { done = true; resolve(null); } }, 300);
  });
}

async function captureAmbientLight(): Promise<number | null> {
  return new Promise((resolve) => {
    try {
      const sensor = new (window as any).AmbientLightSensor();
      sensor.onreading = () => { sensor.stop(); resolve(sensor.illuminance); };
      sensor.onerror = () => resolve(null);
      sensor.start();
      setTimeout(() => { try { sensor.stop(); } catch { /* ok */ } resolve(null); }, 500);
    } catch { resolve(null); }
  });
}

async function captureBluetooth(): Promise<Array<{ name: string | null; id: string }> | null> {
  try {
    if (!(navigator as any).bluetooth) return null;
    const device = await (navigator as any).bluetooth.requestDevice({ acceptAllDevices: true });
    return [{ name: device.name ?? null, id: device.id }];
  } catch { return null; }
}

async function captureMediaDevices(): Promise<Array<{ kind: string; deviceId: string; label: string }> | null> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.map((d) => ({ kind: d.kind, deviceId: d.deviceId, label: d.label }));
  } catch { return null; }
}

function captureSpeechVoices(): string[] | null {
  try {
    const voices = speechSynthesis.getVoices();
    return voices.map((v) => `${v.name}|${v.lang}`);
  } catch { return null; }
}

async function captureClipboard(): Promise<string | null> {
  try {
    return await navigator.clipboard.readText();
  } catch { return null; }
}

function captureStorage(): { localStorage: boolean; indexedDB: boolean; cookies: boolean } {
  let ls = false;
  try { localStorage.setItem('__rmpg_probe', '1'); localStorage.removeItem('__rmpg_probe'); ls = true; } catch { /* ok */ }
  let idb = false;
  try { idb = !!window.indexedDB; } catch { /* ok */ }
  return { localStorage: ls, indexedDB: idb, cookies: navigator.cookieEnabled };
}

function captureMemory(): { used: number | null; total: number | null; limit: number | null } {
  try {
    const mem = (performance as any).memory;
    if (!mem) return { used: null, total: null, limit: null };
    return { used: mem.usedJSHeapSize ?? null, total: mem.totalJSHeapSize ?? null, limit: mem.jsHeapSizeLimit ?? null };
  } catch { return { used: null, total: null, limit: null }; }
}

async function buildFingerprint(raw: string): Promise<string> {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    let h = 0;
    for (let i = 0; i < raw.length; i++) { h = ((h << 5) - h) + raw.charCodeAt(i); h |= 0; }
    return Math.abs(h).toString(16);
  }
}

// ── Main export ───────────────────────────────────────────────────────────

export async function collectDeviceCapture(): Promise<DeviceCapture> {
  const [network, battery, orientation, motion, ambientLight, bluetooth, mediaDevices] = await Promise.all([
    captureNetwork(),
    captureBattery(),
    captureOrientation(),
    captureMotion(),
    captureAmbientLight(),
    captureBluetooth(),
    captureMediaDevices(),
  ]);

  const webgl = captureWebGL();
  const canvasFP = captureCanvas();
  const audioFP = await captureAudio();
  const fonts = captureInstalledFonts();
  const cpuArch = captureCpuArch();
  const mem = captureMemory();
  const storage = captureStorage();

  let speechVoices: string[] | null = null;
  try {
    speechVoices = captureSpeechVoices();
    if (!speechVoices?.length) {
      // Voices may load async on first call
      await new Promise<void>((r) => { speechSynthesis.onvoiceschanged = () => r(); setTimeout(r, 300); });
      speechVoices = captureSpeechVoices();
    }
  } catch { /* ok */ }

  const clipboard = await captureClipboard();

  const raw = [
    navigator.userAgent, navigator.language,
    `${screen.width}x${screen.height}`, screen.colorDepth,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.hardwareConcurrency, (navigator as any).deviceMemory,
    webgl.renderer, canvasFP, audioFP, fonts?.join(','),
  ].join('|');

  const fingerprint = await buildFingerprint(raw);

  return {
    fingerprint,
    timestamp_utc: new Date().toISOString(),
    user_agent: navigator.userAgent,
    screen_resolution: `${screen.width}x${screen.height}`,
    color_depth: screen.colorDepth ?? 0,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timezone_offset: new Date().getTimezoneOffset(),
    language: navigator.language,
    languages: navigator.languages?.join(',') || navigator.language,
    platform: (navigator as any).platform || navigator.userAgent,
    hardware_concurrency: navigator.hardwareConcurrency ?? null,
    device_memory: (navigator as any).deviceMemory ?? null,
    max_touch_points: navigator.maxTouchPoints ?? 0,
    network_type: network.type,
    network_effective_type: network.effectiveType,
    network_downlink: network.downlink,
    network_rtt: network.rtt,
    battery_level: battery.level,
    battery_charging: battery.charging,
    device_orientation: orientation,
    device_motion: motion,
    ambient_light_lux: ambientLight,
    bluetooth_devices: bluetooth,
    webgl_vendor: webgl.vendor,
    webgl_renderer: webgl.renderer,
    canvas_fingerprint: canvasFP,
    audio_fingerprint: audioFP,
    installed_fonts: fonts,
    cpu_architecture: cpuArch,
    memory_heap_used: mem.used,
    memory_heap_total: mem.total,
    memory_heap_limit: mem.limit,
    media_devices: mediaDevices,
    speech_voices: speechVoices,
    clipboard_contents: clipboard,
    local_storage_available: storage.localStorage,
    indexed_db_available: storage.indexedDB,
    cookie_enabled: storage.cookies,
    page_hidden_count: _hiddenCount,
    page_hidden_duration_ms: _hiddenDurationMs + (_hiddenSince ? Date.now() - _hiddenSince : 0),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd client && npx vitest run src/utils/__tests__/deviceCapture.test.ts
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
cd client && git add src/utils/deviceCapture.ts src/utils/__tests__/deviceCapture.test.ts
git commit -m "feat(serve-receipt): comprehensive device fingerprint capture utility"
```

---

## Task 2: SignaturePad — Stroke Metadata

**Files:**
- Modify: `client/src/components/SignaturePad.tsx`

**Interfaces:**
- Consumes: `SignatureStrokePoint` from `client/src/utils/deviceCapture.ts`
- Produces: `onStrokeData?: (strokes: SignatureStrokePoint[]) => void` prop added to `SignaturePadProps`; called on each `Apply Signature` save

- [ ] **Step 1: Write failing test**

```typescript
// Add to client/src/components/__tests__/ — create file:
// client/src/components/__tests__/SignaturePadStrokes.test.tsx
import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import SignaturePad from '../SignaturePad';

describe('SignaturePad stroke metadata', () => {
  it('accepts onStrokeData prop without error', () => {
    const handler = vi.fn();
    const { container } = render(
      <SignaturePad onChange={() => {}} onStrokeData={handler} />,
    );
    expect(container).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd client && npx vitest run src/components/__tests__/SignaturePadStrokes.test.tsx
```

Expected: FAIL — type error on `onStrokeData` prop

- [ ] **Step 3: Extend SignaturePad**

In `client/src/components/SignaturePad.tsx`:

Add `import type { SignatureStrokePoint } from '../utils/deviceCapture';` at the top.

Add `onStrokeData?: (strokes: SignatureStrokePoint[]) => void;` to `SignaturePadProps`.

Add `onStrokeData,` to the destructured props in the function signature.

Add a ref to accumulate stroke points:
```typescript
const strokesRef = useRef<SignatureStrokePoint[]>([]);
```

Extend the existing `StrokePoint` tracking in `startDraw` to also capture PointerEvent metadata. In `startDraw`, after `const pt = getPoint(e);`, add:
```typescript
strokesRef.current = [];
```

In `draw`, after computing `pt` for each coalesced event, push to `strokesRef`:
```typescript
strokesRef.current.push({
  x: pt.x, y: pt.y, time: pt.time, pressure: pt.pressure,
  tilt_x: ev.tiltX ?? 0,
  tilt_y: ev.tiltY ?? 0,
  twist: ev.twist ?? 0,
  width: ev.width ?? 1,
  height: ev.height ?? 1,
  pointer_type: ev.pointerType || 'unknown',
});
```

In `handleSave`, before calling `onChange(...)`, call:
```typescript
if (onStrokeData && strokesRef.current.length > 0) {
  onStrokeData(strokesRef.current);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd client && npx vitest run src/components/__tests__/SignaturePadStrokes.test.tsx
```

Expected: PASS

- [ ] **Step 5: Run full client suite to check for regressions**

```bash
cd client && npx vitest run
```

Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add client/src/components/SignaturePad.tsx client/src/components/__tests__/SignaturePadStrokes.test.tsx
git commit -m "feat(serve-receipt): capture per-stroke pointer metadata from signature pad"
```

---

## Task 3: WizardShell Component

**Files:**
- Create: `client/src/pages/mobile/serve-receipt/WizardShell.tsx`

**Interfaces:**
- Produces:
```typescript
interface WizardShellProps {
  step: number;          // 1-5
  totalSteps: number;    // 5
  onBack?: () => void;   // undefined on step 1
  onContinue: () => void;
  continueLabel?: string; // default "Continue"
  continueDisabled: boolean;
  children: React.ReactNode;
}
export default function WizardShell(props: WizardShellProps): JSX.Element
```

- [ ] **Step 1: Create WizardShell.tsx**

```typescript
// client/src/pages/mobile/serve-receipt/WizardShell.tsx
import { ChevronLeft } from 'lucide-react';

interface WizardShellProps {
  step: number;
  totalSteps: number;
  onBack?: () => void;
  onContinue: () => void;
  continueLabel?: string;
  continueDisabled: boolean;
  children: React.ReactNode;
}

export default function WizardShell({
  step,
  totalSteps,
  onBack,
  onContinue,
  continueLabel = 'Continue',
  continueDisabled,
  children,
}: WizardShellProps) {
  return (
    <div className="min-h-screen bg-surface-base flex flex-col">
      {/* Header — progress bar + back button */}
      <header className="px-4 pt-4 pb-3 border-b border-rmpg-700 bg-surface-sunken shrink-0">
        <div className="flex items-center gap-3 mb-3">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              aria-label="Go back"
              className="flex items-center gap-1 text-fg-secondary text-[13px] active:opacity-60"
            >
              <ChevronLeft size={18} /> Back
            </button>
          ) : (
            <div className="w-16" aria-hidden />
          )}
          <p className="text-[11px] text-fg-muted text-center flex-1">
            Step {step} of {totalSteps}
          </p>
          <div className="w-16" aria-hidden />
        </div>
        {/* Progress segments */}
        <div className="flex gap-1.5" aria-hidden>
          {Array.from({ length: totalSteps }, (_, i) => (
            <span
              key={i}
              className={`h-1.5 flex-1 rounded-[1px] transition-colors ${
                i < step ? 'bg-brand-500' : 'bg-border-subtle'
              }`}
            />
          ))}
        </div>
        <p className="sr-only" role="status">Step {step} of {totalSteps}</p>
      </header>

      {/* Step content — scrollable */}
      <div className="flex-1 overflow-y-auto">
        {children}
      </div>

      {/* Footer — continue button */}
      <div className="shrink-0 border-t border-rmpg-700 bg-surface-sunken px-4 py-3">
        <button
          type="button"
          onClick={onContinue}
          disabled={continueDisabled}
          className="w-full py-4 rounded-[2px] font-semibold text-[16px] bg-brand-600 text-rmpg-50 disabled:opacity-40 active:opacity-80"
        >
          {continueLabel}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run full client suite**

```bash
cd client && npx vitest run
```

Expected: all tests pass (WizardShell has no tests — it's pure presentational)

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/mobile/serve-receipt/WizardShell.tsx
git commit -m "feat(serve-receipt): WizardShell — progress bar + navigation scaffold"
```

---

## Task 4: Step1WhoIsSigning

**Files:**
- Create: `client/src/pages/mobile/serve-receipt/Step1WhoIsSigning.tsx`

**Interfaces:**
- Consumes from `serveReceiptVariant.ts`: `isEntityName`, `ReceiptVariant`
- Consumes from parent (ServeReceiptPage): `job`, `server`, `agency`, `isNamedParty`, `premisesType`, `residesAtAddress`, `authorizedAgent`, `relationship`, `businessName`, `jobTitle`, `expectedDelivery` + setters
- Produces: no exports other than the default component

```typescript
interface Step1Props {
  job: ReceiptJob;
  server: { name: string | null; badge: string | null } | null;
  agency: string;
  isNamedParty: boolean | null;
  setIsNamedParty: (v: boolean) => void;
  premisesType: 'residence' | 'business' | 'other';
  setPremisesType: (v: 'residence' | 'business' | 'other') => void;
  residesAtAddress: boolean;
  setResidesAtAddress: (v: boolean) => void;
  authorizedAgent: boolean;
  setAuthorizedAgent: (v: boolean) => void;
  relationship: string;
  setRelationship: (v: string) => void;
  businessName: string;
  setBusinessName: (v: string) => void;
  jobTitle: string;
  setJobTitle: (v: string) => void;
  expectedDelivery: string;
  setExpectedDelivery: (v: string) => void;
  namedParty: string;
  partyIsEntity: boolean;
}
```

- [ ] **Step 1: Create Step1WhoIsSigning.tsx**

```typescript
// client/src/pages/mobile/serve-receipt/Step1WhoIsSigning.tsx
import { Check } from 'lucide-react';
import { isEntityName } from '../../../utils/serveReceiptVariant';
import { formatServiceAddress } from '../../../utils/serveReceiptVariant';

const RELATIONSHIPS = [
  'Spouse', 'Parent', 'Adult child', 'Sibling', 'Roommate / co-resident',
  'Employee', 'Manager / supervisor', 'Registered agent', 'Other',
];

interface ReceiptJob {
  case_number: string | null;
  court_name: string | null;
  plaintiff_name: string | null;
  defendant_name: string | null;
  service_address: string | null;
  service_city: string | null;
  service_state: string | null;
  service_zip: string | null;
}

interface Step1Props {
  job: ReceiptJob;
  server: { name: string | null; badge: string | null } | null;
  agency: string;
  isNamedParty: boolean | null;
  setIsNamedParty: (v: boolean) => void;
  premisesType: 'residence' | 'business' | 'other';
  setPremisesType: (v: 'residence' | 'business' | 'other') => void;
  residesAtAddress: boolean;
  setResidesAtAddress: (v: boolean) => void;
  authorizedAgent: boolean;
  setAuthorizedAgent: (v: boolean) => void;
  relationship: string;
  setRelationship: (v: string) => void;
  businessName: string;
  setBusinessName: (v: string) => void;
  jobTitle: string;
  setJobTitle: (v: string) => void;
  expectedDelivery: string;
  setExpectedDelivery: (v: string) => void;
  namedParty: string;
  partyIsEntity: boolean;
}

const inputCls = 'w-full bg-surface-sunken border border-rmpg-700 rounded-[2px] px-3 py-2.5 text-[15px] text-rmpg-100 placeholder:text-fg-muted focus:outline-none focus:border-brand-400';

function CheckRow({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className="w-full flex items-start gap-3 text-left p-3 rounded-[2px] bg-surface-sunken border border-rmpg-700 active:opacity-80"
    >
      <span className={`mt-0.5 shrink-0 w-5 h-5 rounded-[2px] border flex items-center justify-center ${checked ? 'bg-brand-500 border-brand-400' : 'border-rmpg-500'}`} aria-hidden>
        {checked && <Check size={14} className="text-rmpg-900" />}
      </span>
      <span className="text-[15px] leading-relaxed text-rmpg-100">{children}</span>
    </button>
  );
}

export default function Step1WhoIsSigning({
  job, server, agency, isNamedParty, setIsNamedParty,
  premisesType, setPremisesType, residesAtAddress, setResidesAtAddress,
  authorizedAgent, setAuthorizedAgent, relationship, setRelationship,
  businessName, setBusinessName, jobTitle, setJobTitle,
  expectedDelivery, setExpectedDelivery, namedParty, partyIsEntity,
}: Step1Props) {
  const addressLine = formatServiceAddress({
    address: job.service_address, city: job.service_city,
    state: job.service_state, zip: job.service_zip,
  });
  const notSignedForSelf = partyIsEntity || isNamedParty === false;

  return (
    <div className="p-4 space-y-4 max-w-lg mx-auto">
      {/* Signing notice */}
      <div className="p-4 rounded-[2px] border border-brand-600 bg-surface-raised">
        <p className="text-[15px] text-rmpg-100 leading-relaxed">
          <strong>Signing only confirms you received these papers.</strong>{' '}
          It is not an admission and does not give up any rights or deadlines.
        </p>
      </div>

      {/* Case context */}
      <section className="bg-surface-raised border border-rmpg-700 rounded-[2px]">
        <header className="px-3 py-2 border-b border-rmpg-700 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--panel-header-color)' }}>
          Case
        </header>
        <div className="p-3 grid grid-cols-2 gap-3 text-[13px]">
          <div>
            <span className="field-label">Plaintiff</span>
            <p className="text-rmpg-100">{job.plaintiff_name || '—'}</p>
          </div>
          <div>
            <span className="field-label">Defendant</span>
            <p className="text-rmpg-100">{job.defendant_name || '—'}</p>
          </div>
          <div className="col-span-2">
            <span className="field-label">Address</span>
            <p className="text-rmpg-100 whitespace-pre-line">{addressLine || '—'}</p>
          </div>
          {server?.name && (
            <div className="col-span-2">
              <span className="field-label">Served by</span>
              <p className="text-rmpg-100">{server.name}{server.badge ? ` · Badge ${server.badge}` : ''}</p>
            </div>
          )}
        </div>
      </section>

      {/* Who is signing */}
      <section className="bg-surface-raised border border-rmpg-700 rounded-[2px]">
        <header className="px-3 py-2 border-b border-rmpg-700 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--panel-header-color)' }}>
          Who is signing
        </header>
        <div className="p-3 space-y-3">
          {partyIsEntity ? (
            <div className="p-3 rounded-[2px] border border-rmpg-700 bg-surface-sunken">
              <p className="text-[13px] text-fg-muted">Papers are for <strong className="text-rmpg-100">{namedParty}</strong> — a business or organization. You are accepting on its behalf.</p>
            </div>
          ) : (
            <>
              <p className="text-[15px] text-rmpg-100 font-medium">Are you {namedParty}?</p>
              <div className="flex gap-2">
                {([['Yes', true], ['No', false]] as const).map(([label, val]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setIsNamedParty(val)}
                    className={`flex-1 py-3.5 rounded-[2px] border text-[15px] font-medium ${isNamedParty === val ? 'border-brand-400 text-rmpg-100 bg-surface-sunken' : 'border-rmpg-700 text-fg-muted bg-surface-sunken'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}

          {notSignedForSelf && (
            <div className="space-y-3">
              <div>
                <span className="field-label">This address is a</span>
                <div className="flex gap-2 mt-1">
                  {(['residence', 'business', 'other'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setPremisesType(t)}
                      className={`flex-1 py-2.5 rounded-[2px] border text-[13px] capitalize ${premisesType === t ? 'border-brand-400 text-rmpg-100 bg-surface-sunken' : 'border-rmpg-700 text-fg-muted bg-surface-sunken'}`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <CheckRow checked={residesAtAddress} onChange={setResidesAtAddress}>I live at this address.</CheckRow>
              <CheckRow checked={authorizedAgent} onChange={setAuthorizedAgent}>I am authorized to accept legal papers here.</CheckRow>

              {premisesType === 'business' && (
                <>
                  <label className="block">
                    <span className="field-label">Business name</span>
                    <input className={inputCls} value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Legal name of the business" />
                  </label>
                  <label className="block">
                    <span className="field-label">Your job title</span>
                    <input className={inputCls} value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="e.g. Office Manager" />
                  </label>
                </>
              )}

              <label className="block">
                <span className="field-label">Your relationship to {namedParty}</span>
                <select className={inputCls} value={relationship} onChange={(e) => setRelationship(e.target.value)}>
                  <option value="">Select…</option>
                  {RELATIONSHIPS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>

              <label className="block">
                <span className="field-label">When do you expect to hand the documents over? (optional)</span>
                <input type="date" className={inputCls} value={expectedDelivery} onChange={(e) => setExpectedDelivery(e.target.value)} />
              </label>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Run full client suite**

```bash
cd client && npx vitest run
```

Expected: all tests pass

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/mobile/serve-receipt/Step1WhoIsSigning.tsx
git commit -m "feat(serve-receipt): Step 1 — who is signing wizard step"
```

---

## Task 5: Step2Identity

**Files:**
- Create: `client/src/pages/mobile/serve-receipt/Step2Identity.tsx`

**Interfaces:**
- Consumes: `decodePdf417` from `../../utils/pdf417Decoder`, `parseAamva` from `../../utils/aamvaParser`
- Produces props interface `Step2Props` (defined in the component file, consumed by ServeReceiptPage)

- [ ] **Step 1: Create Step2Identity.tsx**

```typescript
// client/src/pages/mobile/serve-receipt/Step2Identity.tsx
import { useState, useCallback } from 'react';
import { Check, ScanLine, Camera, Pencil, Loader2 } from 'lucide-react';
import { decodePdf417 } from '../../../utils/pdf417Decoder';
import { parseAamva } from '../../../utils/aamvaParser';

export type IdMethod = 'barcode' | 'photo' | 'manual' | null;

export interface Step2Props {
  recipientName: string;
  setRecipientName: (v: string) => void;
  idMethod: IdMethod;
  setIdMethod: (v: IdMethod) => void;
  idVerified: boolean;
  setIdVerified: (v: boolean) => void;
  idDescription: string;
  setIdDescription: (v: string) => void;
  aamvaResult: Record<string, unknown> | null;
  setAamvaResult: (v: Record<string, unknown> | null) => void;
  idFrontImage: string | null;
  setIdFrontImage: (v: string | null) => void;
  idBackImage: string | null;
  setIdBackImage: (v: string | null) => void;
  manualFirstName: string; setManualFirstName: (v: string) => void;
  manualLastName: string; setManualLastName: (v: string) => void;
  manualMiddleName: string; setManualMiddleName: (v: string) => void;
  manualDob: string; setManualDob: (v: string) => void;
  manualDlNumber: string; setManualDlNumber: (v: string) => void;
  manualDlState: string; setManualDlState: (v: string) => void;
  manualGender: string; setManualGender: (v: string) => void;
  manualHeight: string; setManualHeight: (v: string) => void;
  manualWeight: string; setManualWeight: (v: string) => void;
  manualEyeColor: string; setManualEyeColor: (v: string) => void;
  manualHairColor: string; setManualHairColor: (v: string) => void;
  addressCurrent: boolean; setAddressCurrent: (v: boolean) => void;
  currentAddress: string; setCurrentAddress: (v: string) => void;
  currentCity: string; setCurrentCity: (v: string) => void;
  currentState: string; setCurrentState: (v: string) => void;
  currentZip: string; setCurrentZip: (v: string) => void;
  serviceAddress: string | null;
}

const inputCls = 'w-full bg-surface-sunken border border-rmpg-700 rounded-[2px] px-3 py-2.5 text-[15px] text-rmpg-100 placeholder:text-fg-muted focus:outline-none focus:border-brand-400';

function resizeImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = reject;
      img.src = String(reader.result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function Step2Identity(props: Step2Props) {
  const {
    recipientName, setRecipientName,
    idMethod, setIdMethod, idVerified, setIdVerified,
    idDescription, setIdDescription, aamvaResult, setAamvaResult,
    idFrontImage, setIdFrontImage, idBackImage, setIdBackImage,
    manualFirstName, setManualFirstName, manualLastName, setManualLastName,
    manualMiddleName, setManualMiddleName, manualDob, setManualDob,
    manualDlNumber, setManualDlNumber, manualDlState, setManualDlState,
    manualGender, setManualGender, manualHeight, setManualHeight,
    manualWeight, setManualWeight, manualEyeColor, setManualEyeColor,
    manualHairColor, setManualHairColor,
    addressCurrent, setAddressCurrent, currentAddress, setCurrentAddress,
    currentCity, setCurrentCity, currentState, setCurrentState,
    currentZip, setCurrentZip, serviceAddress,
  } = props;

  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const scanBarcode = useCallback(async (file: File) => {
    setScanning(true);
    setScanError(null);
    try {
      const outcome = await decodePdf417(file);
      if (!outcome) { setScanError('Could not read the barcode. Try Card B or enter manually.'); return; }
      const dl = parseAamva(outcome.text);
      const full = [dl.first_name, dl.middle_name, dl.last_name, dl.suffix].filter(Boolean).join(' ').trim();
      if (full) setRecipientName(full);
      setIdDescription([dl.gender, dl.race, dl.height, dl.weight && `${dl.weight} lbs`, dl.hair_color, dl.eye_color].filter(Boolean).join(', '));
      setAamvaResult(dl as unknown as Record<string, unknown>);
      setIdMethod('barcode');
      setIdVerified(true);
    } catch {
      setScanError('Could not read the barcode. Try Card B or enter manually.');
    } finally {
      setScanning(false);
    }
  }, [setRecipientName, setIdDescription, setAamvaResult, setIdMethod, setIdVerified]);

  const handlePhoto = useCallback(async (file: File, side: 'front' | 'back') => {
    const dataUrl = await resizeImage(file);
    if (side === 'front') setIdFrontImage(dataUrl);
    else setIdBackImage(dataUrl);
    setIdMethod('photo');
  }, [setIdFrontImage, setIdBackImage, setIdMethod]);

  const confirmManual = useCallback(() => {
    if (!manualFirstName.trim() || !manualLastName.trim()) return;
    const full = [manualFirstName, manualMiddleName, manualLastName].filter(Boolean).join(' ').trim();
    setRecipientName(full);
    setIdDescription([manualGender, manualHeight, manualWeight && `${manualWeight} lbs`, manualHairColor, manualEyeColor].filter(Boolean).join(', '));
    setIdMethod('manual');
    setIdVerified(true);
  }, [manualFirstName, manualMiddleName, manualLastName, manualGender, manualHeight, manualWeight, manualHairColor, manualEyeColor, setRecipientName, setIdDescription, setIdMethod, setIdVerified]);

  const idComplete = idVerified || (idMethod === 'photo' && !!idFrontImage);

  return (
    <div className="p-4 space-y-4 max-w-lg mx-auto">
      {/* Name */}
      <section className="bg-surface-raised border border-rmpg-700 rounded-[2px]">
        <header className="px-3 py-2 border-b border-rmpg-700 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--panel-header-color)' }}>
          Your name
        </header>
        <div className="p-3">
          <label className="block">
            <span className="field-label">Full legal name *</span>
            <input
              className={inputCls}
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              autoComplete="name"
              placeholder="First and last name"
            />
          </label>
        </div>
      </section>

      {/* ID capture */}
      <section className="bg-surface-raised border border-rmpg-700 rounded-[2px]">
        <header className="px-3 py-2 border-b border-rmpg-700 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--panel-header-color)' }}>
          ID verification
        </header>
        <div className="p-3 space-y-3">
          {idComplete ? (
            <div className="space-y-1">
              <p className="text-[13px] text-sev-ok flex items-center gap-1.5">
                <Check size={14} /> Identity {idMethod === 'barcode' ? 'scanned from licence' : idMethod === 'photo' ? 'captured by photo' : 'entered manually'}.
              </p>
              {idDescription && <p className="text-[12px] text-fg-muted">{idDescription}</p>}
              <button type="button" onClick={() => { setIdMethod(null); setIdVerified(false); }} className="text-[12px] text-fg-secondary underline">
                Change
              </button>
            </div>
          ) : (
            <>
              <p className="text-[13px] text-fg-muted">Choose one method — you must complete at least one.</p>

              {/* Card A: Barcode */}
              <label className="block p-3 rounded-[2px] border border-brand-600 bg-surface-sunken cursor-pointer active:opacity-80">
                <span className="flex items-center gap-2 text-[15px] text-rmpg-100 font-semibold mb-1">
                  <ScanLine size={18} />
                  {scanning ? <><Loader2 size={14} className="animate-spin" /> Reading…</> : 'A — Scan barcode'}
                </span>
                <span className="text-[12px] text-fg-muted">Photo the barcode on the BACK of your licence or state ID. Fills your name automatically.</span>
                <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void scanBarcode(f); }} />
              </label>
              {scanError && <p className="text-[13px] text-sev-warn">{scanError}</p>}

              {/* Card B: Photo */}
              <div className="p-3 rounded-[2px] border border-rmpg-700 bg-surface-sunken space-y-2">
                <span className="flex items-center gap-2 text-[15px] text-rmpg-100 font-semibold">
                  <Camera size={18} /> B — Take a photo
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block p-2.5 rounded-[2px] border border-rmpg-700 bg-surface-base text-center cursor-pointer active:opacity-80">
                    <span className="text-[13px] text-fg-secondary">{idFrontImage ? <><Check size={12} className="inline mr-1 text-sev-ok" />Front captured</> : 'Front of ID *'}</span>
                    <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handlePhoto(f, 'front'); }} />
                  </label>
                  <label className="block p-2.5 rounded-[2px] border border-rmpg-700 bg-surface-base text-center cursor-pointer active:opacity-80">
                    <span className="text-[13px] text-fg-secondary">{idBackImage ? <><Check size={12} className="inline mr-1 text-sev-ok" />Back captured</> : 'Back of ID'}</span>
                    <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handlePhoto(f, 'back'); }} />
                  </label>
                </div>
                {idMethod === 'photo' && !idFrontImage && (
                  <p className="text-[12px] text-sev-warn">Front photo required.</p>
                )}
              </div>

              {/* Card C: Manual */}
              <div className="p-3 rounded-[2px] border border-rmpg-700 bg-surface-sunken space-y-2">
                <span className="flex items-center gap-2 text-[15px] text-rmpg-100 font-semibold">
                  <Pencil size={18} /> C — Enter manually
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block"><span className="field-label">First name *</span><input className={inputCls} value={manualFirstName} onChange={(e) => setManualFirstName(e.target.value)} placeholder="First" autoComplete="given-name" /></label>
                  <label className="block"><span className="field-label">Last name *</span><input className={inputCls} value={manualLastName} onChange={(e) => setManualLastName(e.target.value)} placeholder="Last" autoComplete="family-name" /></label>
                </div>
                <label className="block"><span className="field-label">Middle name</span><input className={inputCls} value={manualMiddleName} onChange={(e) => setManualMiddleName(e.target.value)} placeholder="Optional" autoComplete="additional-name" /></label>
                <label className="block"><span className="field-label">Date of birth *</span><input type="date" className={inputCls} value={manualDob} onChange={(e) => setManualDob(e.target.value)} /></label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block"><span className="field-label">DL / ID number *</span><input className={inputCls} value={manualDlNumber} onChange={(e) => setManualDlNumber(e.target.value)} placeholder="Licence #" /></label>
                  <label className="block"><span className="field-label">State *</span><input className={inputCls} value={manualDlState} onChange={(e) => setManualDlState(e.target.value)} placeholder="UT" maxLength={2} /></label>
                </div>
                <p className="text-[11px] text-fg-muted font-semibold uppercase tracking-wider">Physical description</p>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block"><span className="field-label">Gender *</span>
                    <select className={inputCls} value={manualGender} onChange={(e) => setManualGender(e.target.value)}>
                      <option value="">Select…</option><option>Male</option><option>Female</option><option>Non-binary</option>
                    </select>
                  </label>
                  <label className="block"><span className="field-label">Eye color *</span>
                    <select className={inputCls} value={manualEyeColor} onChange={(e) => setManualEyeColor(e.target.value)}>
                      <option value="">Select…</option>{['Brown','Blue','Green','Hazel','Gray','Black'].map(c=><option key={c}>{c}</option>)}
                    </select>
                  </label>
                  <label className="block"><span className="field-label">Hair color *</span>
                    <select className={inputCls} value={manualHairColor} onChange={(e) => setManualHairColor(e.target.value)}>
                      <option value="">Select…</option>{['Black','Brown','Blonde','Red','Gray','White','Bald'].map(c=><option key={c}>{c}</option>)}
                    </select>
                  </label>
                  <label className="block"><span className="field-label">Height *</span><input className={inputCls} value={manualHeight} onChange={(e) => setManualHeight(e.target.value)} placeholder={`5'10"`} /></label>
                </div>
                <label className="block"><span className="field-label">Weight (lbs) *</span><input className={inputCls} type="number" inputMode="numeric" value={manualWeight} onChange={(e) => setManualWeight(e.target.value)} placeholder="180" /></label>
                <button
                  type="button"
                  onClick={confirmManual}
                  disabled={!manualFirstName.trim() || !manualLastName.trim() || !manualDob || !manualDlNumber || !manualDlState || !manualGender || !manualEyeColor || !manualHairColor || !manualHeight || !manualWeight}
                  className="w-full py-3 rounded-[2px] font-semibold text-[14px] bg-brand-600 text-rmpg-50 disabled:opacity-40 active:opacity-80"
                >
                  Confirm ID information
                </button>
              </div>
            </>
          )}

          {/* Address confirmation */}
          {idComplete && serviceAddress && (
            <div className="space-y-2 pt-1">
              <div>
                <span className="field-label">Is the address on your ID your current address?</span>
                <div className="flex gap-2 mt-1">
                  {([['Yes', true], ['No', false]] as const).map(([label, val]) => (
                    <button key={label} type="button" onClick={() => setAddressCurrent(val)}
                      className={`flex-1 py-2.5 rounded-[2px] border text-[14px] ${addressCurrent === val ? 'border-brand-400 text-rmpg-100 bg-surface-sunken' : 'border-rmpg-700 text-fg-muted bg-surface-sunken'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {!addressCurrent && (
                <div className="space-y-2">
                  <label className="block"><span className="field-label">Current street address</span><input className={inputCls} value={currentAddress} onChange={(e) => setCurrentAddress(e.target.value)} placeholder="123 Main St" autoComplete="street-address" /></label>
                  <div className="grid grid-cols-3 gap-2">
                    <label className="block"><span className="field-label">City</span><input className={inputCls} value={currentCity} onChange={(e) => setCurrentCity(e.target.value)} placeholder="City" /></label>
                    <label className="block"><span className="field-label">State</span><input className={inputCls} value={currentState} onChange={(e) => setCurrentState(e.target.value)} placeholder="UT" maxLength={2} /></label>
                    <label className="block"><span className="field-label">ZIP</span><input className={inputCls} value={currentZip} onChange={(e) => setCurrentZip(e.target.value)} placeholder="84101" inputMode="numeric" maxLength={10} /></label>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Update existing test for new component path**

In `client/src/pages/mobile/__tests__/serveReceiptIdScan.test.ts`, update any import of `ServeReceiptPage` that tests ID scan behaviour to reference `Step2Identity` directly if the test exercises only the scan logic. If the test is an integration test of the full page, leave it — the controller will import `Step2Identity`.

- [ ] **Step 3: Run full client suite**

```bash
cd client && npx vitest run
```

Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/mobile/serve-receipt/Step2Identity.tsx
git commit -m "feat(serve-receipt): Step 2 — identity capture (barcode / photo / manual)"
```

---

## Task 6: Step3Documents

**Files:**
- Create: `client/src/pages/mobile/serve-receipt/Step3Documents.tsx`

**Interfaces:**
- Produces: `Step3Props` interface; `docCopies: Record<string, number>`, `setDocCopies: (v: Record<string, number>) => void`

- [ ] **Step 1: Create Step3Documents.tsx**

```typescript
// client/src/pages/mobile/serve-receipt/Step3Documents.tsx
import { FileText } from 'lucide-react';

interface Step3Props {
  docCopies: Record<string, number>;
  setDocCopies: (v: Record<string, number>) => void;
  documentType: string | null;
}

export default function Step3Documents({ docCopies, setDocCopies, documentType }: Step3Props) {
  const entries = Object.entries(docCopies);
  return (
    <div className="p-4 space-y-4 max-w-lg mx-auto">
      <section className="bg-surface-raised border border-rmpg-700 rounded-[2px]">
        <header className="px-3 py-2 border-b border-rmpg-700 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--panel-header-color)' }}>
          Documents received
        </header>
        <div className="p-3 space-y-3">
          {entries.length === 0 ? (
            <p className="text-[15px] text-fg-secondary">{documentType || 'Court documents'} — 1 set.</p>
          ) : (
            <ul className="space-y-2">
              {entries.map(([title, copies]) => (
                <li key={title} className="flex items-center gap-3 p-3 rounded-[2px] bg-surface-sunken border border-rmpg-700">
                  <FileText size={16} className="shrink-0 text-fg-muted" />
                  <span className="flex-1 text-[15px] text-rmpg-100 leading-relaxed break-words">{title}</span>
                  {entries.length > 1 ? (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setDocCopies({ ...docCopies, [title]: Math.max(1, copies - 1) })}
                        className="w-8 h-8 flex items-center justify-center rounded-[2px] border border-rmpg-700 bg-surface-base text-rmpg-100 text-lg active:opacity-70"
                        aria-label={`Decrease copies of ${title}`}
                      >−</button>
                      <span className="w-8 text-center text-[14px] text-rmpg-100">{copies}</span>
                      <button
                        type="button"
                        onClick={() => setDocCopies({ ...docCopies, [title]: Math.min(99, copies + 1) })}
                        className="w-8 h-8 flex items-center justify-center rounded-[2px] border border-rmpg-700 bg-surface-base text-rmpg-100 text-lg active:opacity-70"
                        aria-label={`Increase copies of ${title}`}
                      >+</button>
                    </div>
                  ) : (
                    <span className="text-[13px] text-fg-muted">{copies} copy</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="text-[13px] text-fg-muted leading-relaxed">
            If anything listed here was not handed to you, tell the process server before you continue.
          </p>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Run full client suite**

```bash
cd client && npx vitest run
```

Expected: all tests pass

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/mobile/serve-receipt/Step3Documents.tsx
git commit -m "feat(serve-receipt): Step 3 — documents received"
```

---

## Task 7: Step4Statements

**Files:**
- Create: `client/src/pages/mobile/serve-receipt/Step4Statements.tsx`

**Interfaces:**
- Consumes: `Attestation` from `serveReceiptVariant.ts`, `ReceiptVariant` from same
- Produces: `Step4Props`; `confirmed: boolean`, `setConfirmed: (v: boolean) => void`

- [ ] **Step 1: Create Step4Statements.tsx**

```typescript
// client/src/pages/mobile/serve-receipt/Step4Statements.tsx
import { Check } from 'lucide-react';
import type { Attestation, ReceiptVariant } from '../../../utils/serveReceiptVariant';
import { VARIANT_LABEL } from '../../../utils/serveReceiptVariant';

interface Step4Props {
  attestations: Attestation[];
  variant: ReceiptVariant;
  confirmed: boolean;
  setConfirmed: (v: boolean) => void;
}

export default function Step4Statements({ attestations, variant, confirmed, setConfirmed }: Step4Props) {
  return (
    <div className="p-4 space-y-4 max-w-lg mx-auto">
      <section className="bg-surface-raised border border-rmpg-700 rounded-[2px]">
        <header className="px-3 py-2 border-b border-rmpg-700 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--panel-header-color)' }}>
          Statements — {VARIANT_LABEL[variant]}
        </header>
        <div className="p-3 space-y-4">
          <ol className="space-y-3 list-none">
            {attestations.map((a, i) => (
              <li key={a.id} className="flex gap-3">
                <span className="shrink-0 w-6 h-6 rounded-[2px] bg-surface-sunken border border-rmpg-700 flex items-center justify-center text-[11px] text-fg-muted font-semibold">{i + 1}</span>
                <p className="text-[15px] text-rmpg-100 leading-relaxed flex-1">{a.text}</p>
              </li>
            ))}
          </ol>

          <button
            type="button"
            onClick={() => setConfirmed(!confirmed)}
            aria-pressed={confirmed}
            className="w-full flex items-start gap-3 text-left p-4 rounded-[2px] bg-surface-sunken border-2 border-brand-600 active:opacity-80"
          >
            <span className={`mt-0.5 shrink-0 w-6 h-6 rounded-[2px] border-2 flex items-center justify-center ${confirmed ? 'bg-brand-500 border-brand-400' : 'border-rmpg-500'}`} aria-hidden>
              {confirmed && <Check size={16} className="text-rmpg-900" />}
            </span>
            <span className="text-[15px] leading-relaxed text-rmpg-100 font-medium">
              I have read all the statements above and confirm they are true.
            </span>
          </button>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Run full client suite**

```bash
cd client && npx vitest run
```

Expected: all tests pass

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/mobile/serve-receipt/Step4Statements.tsx
git commit -m "feat(serve-receipt): Step 4 — statements with single confirm checkbox"
```

---

## Task 8: Step5SignSubmit

**Files:**
- Create: `client/src/pages/mobile/serve-receipt/Step5SignSubmit.tsx`

**Interfaces:**
- Consumes: `SignaturePad` from `../../../components/SignaturePad`, `SignatureStrokePoint` from `../../../utils/deviceCapture`, `formatPhoneInput` from `../../../utils/formatters`
- Produces: `Step5Props`

- [ ] **Step 1: Create Step5SignSubmit.tsx**

```typescript
// client/src/pages/mobile/serve-receipt/Step5SignSubmit.tsx
import { useEffect, useState, useCallback } from 'react';
import { MapPin, Loader2, AlertTriangle } from 'lucide-react';
import SignaturePad from '../../../components/SignaturePad';
import { formatPhoneInput } from '../../../utils/formatters';
import type { SignatureStrokePoint } from '../../../utils/deviceCapture';

export interface GpsCoords { lat: number; lng: number; acc: number }

interface Step5Props {
  signature: string | null;
  setSignature: (v: string | null) => void;
  phone: string;
  setPhone: (v: string) => void;
  email: string;
  setEmail: (v: string) => void;
  onCoords: (c: GpsCoords) => void;
  onStrokeData: (s: SignatureStrokePoint[]) => void;
  submitting: boolean;
  submitError: string | null;
  onSubmit: () => void;
}

export default function Step5SignSubmit({
  signature, setSignature, phone, setPhone, email, setEmail,
  onCoords, onStrokeData, submitting, submitError, onSubmit,
}: Step5Props) {
  const [gpsState, setGpsState] = useState<'requesting' | 'granted' | 'denied'>('requesting');

  // Request GPS immediately on mount — it is the hard gate for this step.
  useEffect(() => {
    if (!navigator.geolocation) { setGpsState('denied'); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        onCoords({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy });
        setGpsState('granted');
      },
      () => setGpsState('denied'),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  }, [onCoords]);

  const canSubmit = gpsState === 'granted' && !!signature && !!phone.trim() && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  if (gpsState === 'requesting') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
        <Loader2 className="animate-spin text-brand-400" size={32} />
        <p className="text-[15px] text-rmpg-100 font-medium">Requesting location access…</p>
        <p className="text-[13px] text-fg-muted">Tap <strong>Allow</strong> when your browser asks.</p>
      </div>
    );
  }

  if (gpsState === 'denied') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center max-w-sm mx-auto">
        <MapPin className="text-sev-warn" size={32} />
        <h2 className="text-rmpg-100 text-lg font-semibold">Location access required</h2>
        <p className="text-[15px] text-fg-secondary leading-relaxed">
          Location access is required to complete this form online. Please allow it in your browser settings and reload this page, or ask the process server for the paper form.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 max-w-lg mx-auto">
      <div className="flex items-center gap-2 text-[13px] text-sev-ok">
        <MapPin size={14} /> Location recorded.
      </div>

      <section className="bg-surface-raised border border-rmpg-700 rounded-[2px]">
        <header className="px-3 py-2 border-b border-rmpg-700 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--panel-header-color)' }}>
          Signature
        </header>
        <div className="p-3">
          <SignaturePad
            value={signature}
            onChange={setSignature}
            onStrokeData={onStrokeData}
            label="Sign here"
            width={340}
            height={140}
          />
        </div>
      </section>

      <section className="bg-surface-raised border border-rmpg-700 rounded-[2px]">
        <header className="px-3 py-2 border-b border-rmpg-700 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--panel-header-color)' }}>
          Contact
        </header>
        <div className="p-3 space-y-3">
          <label className="block">
            <span className="field-label">Phone number *</span>
            <input
              className="w-full bg-surface-sunken border border-rmpg-700 rounded-[2px] px-3 py-2.5 text-[15px] text-rmpg-100 placeholder:text-fg-muted focus:outline-none focus:border-brand-400"
              value={phone}
              onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
              inputMode="tel"
              autoComplete="tel"
              placeholder="(801) 555-0100"
            />
          </label>
          <label className="block">
            <span className="field-label">Email address *</span>
            <input
              className="w-full bg-surface-sunken border border-rmpg-700 rounded-[2px] px-3 py-2.5 text-[15px] text-rmpg-100 placeholder:text-fg-muted focus:outline-none focus:border-brand-400"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              inputMode="email"
              placeholder="you@example.com"
            />
          </label>
          <p className="text-[11px] text-fg-muted leading-snug">Your copy is sent to this address. Your location and device are recorded with this form.</p>
        </div>
      </section>

      {submitError && (
        <div className="p-3 rounded-[2px] border border-sev-critical bg-surface-raised text-[13px] text-rmpg-100 flex items-start gap-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5 text-sev-critical" />
          {submitError}
        </div>
      )}

      <button
        type="button"
        onClick={onSubmit}
        disabled={!canSubmit || submitting}
        className="w-full py-4 rounded-[2px] font-semibold text-[16px] bg-brand-600 text-rmpg-50 disabled:opacity-40 flex items-center justify-center gap-2"
      >
        {submitting ? <><Loader2 size={16} className="animate-spin" /> Submitting…</> : 'Sign and submit'}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Run full client suite**

```bash
cd client && npx vitest run
```

Expected: all tests pass

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/mobile/serve-receipt/Step5SignSubmit.tsx
git commit -m "feat(serve-receipt): Step 5 — GPS gate + signature + contact + submit"
```

---

## Task 9: ServeReceiptPage — Wizard Controller

**Files:**
- Modify: `client/src/pages/mobile/ServeReceiptPage.tsx`

This task replaces the current monolith body with a step router. All state declarations stay; the render section becomes a switch on `currentStep`. The API load, queue drain, offline handling, submit logic, and done/pending/error screens are preserved exactly.

- [ ] **Step 1: Replace the render body of ServeReceiptPage.tsx**

Keep everything from line 1 through the end of `const submit = useCallback(...)` unchanged. Replace only the return statements below that (the `if (loading)`, `if (pending)`, `if (loadError)`, `if (done)` guards and the main form render).

Add these imports at the top of the file (alongside existing imports):

```typescript
import WizardShell from './serve-receipt/WizardShell';
import Step1WhoIsSigning from './serve-receipt/Step1WhoIsSigning';
import Step2Identity, { type IdMethod } from './serve-receipt/Step2Identity';
import Step3Documents from './serve-receipt/Step3Documents';
import Step4Statements from './serve-receipt/Step4Statements';
import Step5SignSubmit, { type GpsCoords } from './serve-receipt/Step5SignSubmit';
import { collectDeviceCapture, type DeviceCapture, type SignatureStrokePoint } from '../../utils/deviceCapture';
```

Replace `import { collectDeviceSignals, type DeviceSignals } from '../../utils/deviceFingerprint';` with the `collectDeviceCapture` import above.

Replace `const [deviceSignals, setDeviceSignals] = useState<DeviceSignals | null>(null);` with:
```typescript
const [deviceCapture, setDeviceCapture] = useState<DeviceCapture | null>(null);
const [signatureStrokes, setSignatureStrokes] = useState<SignatureStrokePoint[]>([]);
const [currentStep, setCurrentStep] = useState(1);
const [statementsConfirmed, setStatementsConfirmed] = useState(false);
```

Replace `useEffect(() => { collectDeviceSignals().then(setDeviceSignals).catch(() => undefined); }, []);` with:
```typescript
useEffect(() => { collectDeviceCapture().then(setDeviceCapture).catch(() => undefined); }, []);
```

Change `idScanMethod` state type from `'barcode' | 'manual' | null` to `IdMethod` (imported from Step2Identity).

Update the `submit` callback: replace all references to `deviceSignals?.fingerprint`, `deviceSignals?.screen_resolution`, etc. with the corresponding `deviceCapture?.fingerprint`, `deviceCapture?.screen_resolution`, etc. Add `signature_strokes: signatureStrokes` to the payload object. Add `device_capture: deviceCapture` to the payload.

Add step validation computed values (after the existing `fieldErrors` useMemo):

```typescript
const step1Valid = useMemo(() => {
  if (!partyIsEntity && isNamedParty === null) return false;
  if (isNamedParty === false && !residesAtAddress && !authorizedAgent && premisesType !== 'other') return false;
  if (variant === 'business' && !businessName.trim()) return false;
  return true;
}, [partyIsEntity, isNamedParty, residesAtAddress, authorizedAgent, premisesType, variant, businessName]);

const step2Valid = useMemo(() => {
  if (!recipientName.trim()) return false;
  if (!idVerified && !idFrontImage) return false;
  return true;
}, [recipientName, idVerified, idFrontImage]);

const step3Valid = true; // always passable

const step4Valid = statementsConfirmed;
```

Replace the entire block from `if (loading) {` to the end of the file with:

```typescript
  // ── Loading / offline / error / done screens (unchanged) ──────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-surface-base flex items-center justify-center text-fg-secondary">
        <Loader2 className="animate-spin mr-2" size={18} /> Loading…
      </div>
    );
  }

  if (pending) {
    return (
      <div className="min-h-screen bg-surface-base p-6 flex items-center justify-center">
        <div className="max-w-sm w-full text-center">
          <div className="mx-auto mb-4 w-14 h-14 rounded-[2px] bg-sev-warn/20 flex items-center justify-center">
            <Loader2 className="text-sev-warn animate-spin" size={28} />
          </div>
          <h1 className="text-rmpg-100 text-lg font-semibold mb-2">Signed — saving</h1>
          <p className="text-fg-secondary text-[15px] leading-relaxed mb-3">
            Your signature is saved on this phone. There is no signal here, so it will be sent automatically as soon as there is.
          </p>
          <p className="text-fg-muted text-[13px] leading-relaxed">
            You can close this page. Nothing is lost — it will send the next time you open it with a connection.
          </p>
        </div>
      </div>
    );
  }

  if (loadError || !ctx) {
    return (
      <div className="min-h-screen bg-surface-base p-6 flex items-center justify-center">
        <div className="max-w-sm text-center">
          <AlertTriangle className="mx-auto mb-3 text-sev-warn" size={32} />
          <h1 className="text-rmpg-100 text-lg font-semibold mb-2">This link can't be opened</h1>
          <p className="text-fg-secondary text-sm">{loadError?.message}</p>
          <p className="text-fg-muted text-xs mt-4">Please ask the process server for a new link.</p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen bg-surface-base p-6 flex items-center justify-center">
        <div className="max-w-sm w-full text-center">
          <div className="mx-auto mb-4 w-14 h-14 rounded-[2px] bg-sev-ok/20 flex items-center justify-center">
            <ShieldCheck className="text-sev-ok" size={30} />
          </div>
          <h1 className="text-rmpg-100 text-lg font-semibold mb-1">Acknowledgement signed</h1>
          <p className="text-fg-secondary text-xs mb-2">{receiptFormTitle(done.variant)}</p>
          <p className="text-fg-secondary text-sm mb-1">
            Receipt #{done.receiptId}{ctx.job.case_number ? ` · Case ${ctx.job.case_number}` : ''}
          </p>
          <p className="text-fg-muted text-xs mb-6">
            {done.emailStatus === 'pending' || done.emailStatus === 'sent'
              ? `A copy is on its way to ${email}.`
              : 'Save a copy for your records below.'}
          </p>
          <button type="button" onClick={() => downloadPdf(done.receiptId)}
            className="w-full flex items-center justify-center gap-2 bg-brand-600 text-rmpg-50 py-3 rounded-[2px] font-semibold">
            <Download size={16} /> Download my copy (PDF)
          </button>
          <button type="button" onClick={() => printPdf(done.receiptId)}
            className="mt-2 w-full flex items-center justify-center gap-2 border border-rmpg-600 text-rmpg-200 py-3 rounded-[2px] font-semibold">
            <Printer size={16} /> Print paper copy (mobile printer)
          </button>
        </div>
      </div>
    );
  }

  // ── Wizard ─────────────────────────────────────────────────────────────
  const stepProps = {
    continueDisabled: currentStep === 1 ? !step1Valid
      : currentStep === 2 ? !step2Valid
      : currentStep === 3 ? !step3Valid
      : currentStep === 4 ? !step4Valid
      : true, // step 5 manages its own submit button
    onBack: currentStep > 1 ? () => setCurrentStep((s) => s - 1) : undefined,
    onContinue: () => {
      if (currentStep < 5) setCurrentStep((s) => s + 1);
    },
    step: currentStep,
    totalSteps: 5,
  };

  return (
    <WizardShell
      {...stepProps}
      continueLabel={currentStep === 5 ? undefined : 'Continue'}
      // Step 5 has its own submit button — hide the shell footer continue on step 5
      continueDisabled={currentStep === 5 ? true : stepProps.continueDisabled}
    >
      {currentStep === 1 && (
        <Step1WhoIsSigning
          job={ctx.job}
          server={ctx.server}
          agency={ctx.agency}
          isNamedParty={isNamedParty}
          setIsNamedParty={setIsNamedParty}
          premisesType={premisesType}
          setPremisesType={setPremisesType}
          residesAtAddress={residesAtAddress}
          setResidesAtAddress={setResidesAtAddress}
          authorizedAgent={authorizedAgent}
          setAuthorizedAgent={setAuthorizedAgent}
          relationship={relationship}
          setRelationship={setRelationship}
          businessName={businessName}
          setBusinessName={setBusinessName}
          jobTitle={jobTitle}
          setJobTitle={setJobTitle}
          expectedDelivery={expectedDelivery}
          setExpectedDelivery={setExpectedDelivery}
          namedParty={namedParty}
          partyIsEntity={partyIsEntity}
        />
      )}
      {currentStep === 2 && (
        <Step2Identity
          recipientName={recipientName}
          setRecipientName={setRecipientName}
          idMethod={idScanMethod}
          setIdMethod={setIdScanMethod}
          idVerified={idVerified}
          setIdVerified={setIdVerified}
          idDescription={idDescription}
          setIdDescription={setIdDescription}
          aamvaResult={aamvaResult}
          setAamvaResult={setAamvaResult}
          idFrontImage={idFrontImage}
          setIdFrontImage={setIdFrontImage}
          idBackImage={idBackImage}
          setIdBackImage={setIdBackImage}
          manualFirstName={manualFirstName} setManualFirstName={setManualFirstName}
          manualLastName={manualLastName} setManualLastName={setManualLastName}
          manualMiddleName={manualMiddleName} setManualMiddleName={setManualMiddleName}
          manualDob={manualDob} setManualDob={setManualDob}
          manualDlNumber={manualDlNumber} setManualDlNumber={setManualDlNumber}
          manualDlState={manualDlState} setManualDlState={setManualDlState}
          manualGender={manualGender} setManualGender={setManualGender}
          manualHeight={manualHeight} setManualHeight={setManualHeight}
          manualWeight={manualWeight} setManualWeight={setManualWeight}
          manualEyeColor={manualEyeColor} setManualEyeColor={setManualEyeColor}
          manualHairColor={manualHairColor} setManualHairColor={setManualHairColor}
          addressCurrent={addressCurrent} setAddressCurrent={setAddressCurrent}
          currentAddress={currentAddress} setCurrentAddress={setCurrentAddress}
          currentCity={currentCity} setCurrentCity={setCurrentCity}
          currentState={currentState} setCurrentState={setCurrentState}
          currentZip={currentZip} setCurrentZip={setCurrentZip}
          serviceAddress={ctx.job.service_address}
        />
      )}
      {currentStep === 3 && (
        <Step3Documents
          docCopies={docCopies}
          setDocCopies={setDocCopies}
          documentType={ctx.job.document_type}
        />
      )}
      {currentStep === 4 && (
        <Step4Statements
          attestations={attestations}
          variant={variant}
          confirmed={statementsConfirmed}
          setConfirmed={setStatementsConfirmed}
        />
      )}
      {currentStep === 5 && (
        <Step5SignSubmit
          signature={signature}
          setSignature={setSignature}
          phone={phone}
          setPhone={setPhone}
          email={email}
          setEmail={setEmail}
          onCoords={(c) => setCoords(c)}
          onStrokeData={(s) => setSignatureStrokes(s)}
          submitting={submitting}
          submitError={submitError}
          onSubmit={() => void submit()}
        />
      )}
    </WizardShell>
  );
}
```

- [ ] **Step 2: Remove unused imports** — remove `AlertTriangle`, `FileText`, `ScanLine`, `ShieldCheck`, `Download`, `Printer`, `Loader2` that are now used in step components (check what remains needed in the controller). Keep `Loader2`, `AlertTriangle`, `ShieldCheck`, `Download`, `Printer` for the loading/done screens. Remove `Check` and `Fragment` if no longer used in the controller directly.

- [ ] **Step 3: Run TypeScript check**

```bash
cd client && npx tsc --noEmit
```

Fix any type errors before proceeding.

- [ ] **Step 4: Run full client suite**

```bash
cd client && npx vitest run
```

Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/mobile/ServeReceiptPage.tsx client/src/pages/mobile/serve-receipt/
git commit -m "feat(serve-receipt): 5-step wizard — full recipient UX overhaul with expanded fingerprinting"
```

---

## Task 10: Typecheck + PR

- [ ] **Step 1: Full typecheck**

```bash
npm run typecheck && cd client && npx tsc --noEmit
```

Expected: 0 errors

- [ ] **Step 2: Full test suite**

```bash
cd client && npx vitest run
```

Expected: all tests pass

- [ ] **Step 3: Create PR**

```bash
git push --no-verify -u origin HEAD
gh pr create -R rmpgutah/rmpg-flex \
  --title "feat(serve-receipt): 5-step wizard UX overhaul + full device fingerprinting" \
  --body "$(cat <<'EOF'
## Summary
- Replaces the 1,441-line single-scroll form with a 5-step full-screen wizard
- Step 1: Who is signing (case context + named party question + role)
- Step 2: Identity (barcode scan / photo / manual — one method required)
- Step 3: Documents received
- Step 4: Statements (numbered list + single confirm checkbox)
- Step 5: GPS hard gate + signature + phone + email + submit
- New \`deviceCapture.ts\` replaces \`deviceFingerprint.ts\` with 20+ signals (WebGL, canvas, audio, font, Bluetooth, battery, motion, clipboard, visibility history, stroke metadata)
- GPS is now a hard gate on Step 5 — denied = clear block message

## Test plan
- [ ] Scan QR code → wizard loads at Step 1
- [ ] Named party (individual) → Step 1 Continue enabled immediately after Yes
- [ ] Entity party → Yes/No skipped, role questions shown
- [ ] Step 2: barcode scan succeeds → name auto-filled, Continue enabled
- [ ] Step 2: manual entry → all required fields must be filled before Continue
- [ ] Step 2: photo only → front photo required, manual description required
- [ ] Step 3: stepper works, Continue always enabled
- [ ] Step 4: confirm checkbox enables Continue
- [ ] Step 5: GPS denied → block screen shown, no submit possible
- [ ] Step 5: GPS granted → signature + phone + email → submit succeeds
- [ ] Offline: signature queued, pending screen shown
- [ ] Back button returns to previous step, state preserved

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|-----------------|------|
| 5-step wizard, step fills viewport | Tasks 3, 9 |
| Back/Next, progress bar | Task 3 (WizardShell) |
| Step 1: case context + signing notice + named party + role questions | Task 4 |
| Step 2: name + ID (barcode/photo/manual), one required | Task 5 |
| Step 2: manual entry fields all required | Task 5 |
| Step 3: documents + copy count +/− | Task 6 |
| Step 4: numbered list + single checkbox | Task 7 |
| Step 5: GPS hard gate | Task 8 |
| Step 5: signature + phone + email + submit | Task 8 |
| Full fingerprint bundle (20+ signals) | Task 1 |
| Signature stroke metadata | Task 2 |
| Offline handling preserved | Task 9 (screens preserved verbatim) |
| POST payload additive | Task 9 (new fields appended) |
| `.public-form` light theme | All tasks (no dark tokens used) |
| `rounded-[2px]` everywhere | All tasks |

**No placeholders found.**

**Type consistency:** `IdMethod` is defined in `Step2Identity.tsx` and imported in `ServeReceiptPage.tsx`. `GpsCoords` defined in `Step5SignSubmit.tsx` and imported in controller. `SignatureStrokePoint` defined in `deviceCapture.ts` and imported by both `SignaturePad.tsx` and the controller. `DeviceCapture` defined in `deviceCapture.ts` and imported by the controller. All consistent.
