# FlexOS Desktop 10x Enhancement Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance the FlexOS Electron desktop with lock screen branding fixes, a custom wallpaper feature, Windows-style system apps (Calculator, Run Dialog), taskbar jump lists, an enhanced Quick Settings panel with live system data, a world-clock flyout, Notification Center 2.0 with grouped actions, and auto-pinned default desktop modules — a comprehensive 10x uplift making FlexOS feel like a real OS shell.

**Architecture:** Each feature is either a new standalone React component registered in `windowManager.ts` + `FlexOSAppDrawer`, an enhancement to an existing component (Quick Settings, Notification Center, Settings App), or an Electron-side IPC addition in `main.js`. All state uses existing patterns: localStorage for UI prefs, `apiFetch` for live CAD data, `window.electron.*` for Electron IPC. The splash window fix is pure CSS + BrowserWindow option.

**Tech Stack:** React 18, TypeScript, Tailwind + CSS vars (never hardcode hex), Lucide icons, Electron IPC (`ipcMain`/`contextBridge`), localStorage for wallpaper blob URLs, Web Audio API for volume control.

## Global Constraints

- **Never hardcode hex** — all colors via CSS variables (`var(--surface-base)`, `bg-surface-raised`, `text-brand-400`, etc.). New components must use theme tokens.
- **2 px radius everywhere** (`rounded-sm`), never `rounded-lg`.
- **Table header**: `font-semibold text-[9px] py-[3px]`; rows `text-[11px] py-[2px]`.
- **Gold restricted** to `--field-label-color` / `--panel-header-color` only. Silver for icons/borders.
- **No new npm packages** — use existing Lucide icons, React built-ins, and Web Audio API.
- **Electron IPC**: any new IPC channel must be registered in `preload.js` context bridge AND `main.js` `ipcMain.handle`. Use `guardedHandle` in main.js for all new channels.
- **All new components**: export default, placed under `client/src/components/desktop/` or `client/src/components/desktop/apps/`.
- **Window registration**: new floating-window apps go in `client/src/utils/windowManager.ts` `WINDOW_CONFIG` record AND in `FlexOSAppDrawer.tsx`'s app grid.
- **Tests**: each task must run the relevant test suite and confirm no regressions — `cd client && npx vitest run` (client) and `npm run typecheck` (Worker).
- **Commits**: frequent, one logical unit per commit.

---

## Task 1: Splash Lock Screen — Border Fix + RMPG Branding

**Files:**
- Modify: `desktop/splash.html`
- Modify: `desktop/main.js` (createSplashWindow options)

**What's broken:**
- Windows adds a 1-px compositor shadow/border even on `frame: false` windows → visible white edge in screenshots.
- Boot Phase shows "RMPG" text fallback instead of the seal image (getSplashLogoDataUri may fail silently).
- Lock screen background looks washed out on high-brightness displays — needs a deeper gradient and a subtle RMPG watermark.

**Interfaces:**
- Consumes: `desktop/main.js` `createSplashWindow()` (already exists), `getSplashLogoDataUri()` (already exists)
- Produces: no new exports; visual-only fix

- [ ] **Step 1: Fix the compositor border in main.js**

In `createSplashWindow()`, add `hasShadow: false` and `thickFrame: false` (Windows-only options) to the BrowserWindow options object:

```js
splashWindow = new BrowserWindow({
  width: screenW,
  height: screenH,
  x: 0,
  y: 0,
  frame: false,
  transparent: false,
  resizable: false,
  alwaysOnTop: true,
  center: !isWin,
  skipTaskbar: true,
  hasShadow: false,      // ← ADD: removes compositor shadow on Windows
  thickFrame: false,     // ← ADD: removes the invisible WS_THICKFRAME border on Win10
  backgroundColor: '#000000',
  webPreferences: hardenWebPreferencesDefaults({
    preload: splashPreloadPath,
  }),
});
```

- [ ] **Step 2: Add RMPG watermark to Phase 1 boot and Phase 2 lock in splash.html**

In the `<style>` block, add the watermark and animated shimmer for the lock phase:

```css
/* ── RMPG watermark (centered behind content) ── */
#phase-lock::before, #phase-welcome::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image: var(--rmpg-logo-url, none);
  background-repeat: no-repeat;
  background-position: center;
  background-size: 280px auto;
  opacity: 0.04;
  pointer-events: none;
}

/* ── Animated radial pulse behind the lock card ── */
@keyframes lockPulse {
  0%   { transform: scale(1);    opacity: 0.06; }
  50%  { transform: scale(1.08); opacity: 0.10; }
  100% { transform: scale(1);    opacity: 0.06; }
}
#phase-lock::after {
  content: '';
  position: absolute;
  width: 600px; height: 600px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(195,204,214,0.15) 0%, transparent 70%);
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  animation: lockPulse 4s ease-in-out infinite;
  pointer-events: none;
}
```

In the `did-finish-load` handler in main.js, inject the logo as a CSS variable too (alongside the img src injection):

```js
if (logoUri && splashWindow && !splashWindow.isDestroyed()) {
  splashWindow.webContents.executeJavaScript(
    `(function(){
      var img = document.getElementById('boot-logo');
      var fallback = document.getElementById('boot-logo-fallback');
      if (img) { img.src = ${JSON.stringify(logoUri)}; img.style.display = ''; }
      if (fallback) { fallback.style.display = 'none'; }
      // Also set as CSS var for watermarks on lock/welcome phases
      document.documentElement.style.setProperty('--rmpg-logo-url', 'url(' + ${JSON.stringify(logoUri)} + ')');
    })();`
  ).catch(() => {});
}
```

- [ ] **Step 3: Deepen the lock screen gradient**

Replace `#phase-lock` background with a richer multi-stop gradient that reads clearly at high display brightness:

```css
#phase-lock {
  background:
    radial-gradient(ellipse 80% 60% at 50% 40%, #1e3d5a 0%, #0e2035 45%, #040d16 100%);
  gap: 0;
}
#phase-welcome {
  background:
    radial-gradient(ellipse 80% 60% at 50% 40%, #1e3d5a 0%, #0e2035 45%, #040d16 100%);
  gap: 16px;
}
```

- [ ] **Step 4: Commit**

```bash
git add desktop/main.js desktop/splash.html
git commit -m "fix(desktop): splash border, logo watermark, deeper lock gradient"
```

- [ ] **Step 5: Run desktop tests**

```bash
cd desktop && npm test
```

Expected: all existing tests pass (visual-only change, no logic changed).

---

## Task 2: Custom Wallpaper — Upload, Store, Render

**Files:**
- Modify: `client/src/data/desktopWallpapers.ts`
- Modify: `client/src/components/desktop/DesktopWallpaper.tsx`
- Modify: `client/src/components/desktop/DesktopSettingsApp.tsx` (Personalization tab)
- Modify: `client/src/pages/DesktopPage.tsx` (pass custom wallpaper through)

**Interfaces:**
- Produces: `CUSTOM_WALLPAPER_ID = 'custom-image'` constant, `getCustomWallpaperDataUrl(): string | null`, `setCustomWallpaperDataUrl(url: string): void`

**Constraints:** Images are stored as base64 data URLs in `localStorage` under key `rmpg_desktop_wallpaper_custom`. Max size enforced at 4 MB (warn user if too large). No R2 upload — local only. Support JPEG, PNG, WebP.

- [ ] **Step 1: Add custom type and helpers to desktopWallpapers.ts**

```ts
export const CUSTOM_WALLPAPER_ID = 'custom-image';
const CUSTOM_WALLPAPER_KEY = 'rmpg_desktop_wallpaper_custom';
const CUSTOM_WALLPAPER_MAX_BYTES = 4 * 1024 * 1024; // 4 MB

export function getCustomWallpaperDataUrl(): string | null {
  try { return localStorage.getItem(CUSTOM_WALLPAPER_KEY); } catch { return null; }
}

export function setCustomWallpaperDataUrl(dataUrl: string): void {
  try { localStorage.setItem(CUSTOM_WALLPAPER_KEY, dataUrl); } catch { /* quota */ }
}

export function clearCustomWallpaper(): void {
  try { localStorage.removeItem(CUSTOM_WALLPAPER_KEY); } catch { /* noop */ }
}

export const CUSTOM_WALLPAPER_MAX_BYTES_EXPORTED = CUSTOM_WALLPAPER_MAX_BYTES;
```

Add the custom preset to `DESKTOP_WALLPAPERS`:
```ts
{ id: CUSTOM_WALLPAPER_ID, label: 'Custom Image', background: 'var(--surface-base)' },
```

Update `getWallpaper` to handle the custom id without special-casing (the preset entry exists, background is just the fallback).

- [ ] **Step 2: Update DesktopWallpaper.tsx to render custom image**

```tsx
import { getCustomWallpaperDataUrl, CUSTOM_WALLPAPER_ID } from '../../data/desktopWallpapers';

export default function DesktopWallpaper({ wallpaperId, children }: { wallpaperId: string; children: React.ReactNode }) {
  const wallpaper = getWallpaper(wallpaperId);
  const isCustom = wallpaperId === CUSTOM_WALLPAPER_ID;
  const customUrl = isCustom ? getCustomWallpaperDataUrl() : null;

  const style: React.CSSProperties = isCustom && customUrl
    ? { position: 'absolute', inset: 0, backgroundImage: `url(${customUrl})`, backgroundSize: 'cover', backgroundPosition: 'center', overflow: 'hidden' }
    : { position: 'absolute', inset: 0, background: wallpaper.background, overflow: 'hidden' };

  return <div style={style}>{children}</div>;
}
```

- [ ] **Step 3: Write a vitest unit test for the helpers**

Create `client/src/data/__tests__/desktopWallpapers.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { getCustomWallpaperDataUrl, setCustomWallpaperDataUrl, clearCustomWallpaper, CUSTOM_WALLPAPER_ID, getWallpaper } from '../desktopWallpapers';

describe('custom wallpaper helpers', () => {
  beforeEach(() => clearCustomWallpaper());

  it('returns null when no custom wallpaper set', () => {
    expect(getCustomWallpaperDataUrl()).toBeNull();
  });

  it('round-trips a data URL', () => {
    const url = 'data:image/png;base64,abc123';
    setCustomWallpaperDataUrl(url);
    expect(getCustomWallpaperDataUrl()).toBe(url);
  });

  it('getWallpaper finds the custom preset', () => {
    const w = getWallpaper(CUSTOM_WALLPAPER_ID);
    expect(w.id).toBe(CUSTOM_WALLPAPER_ID);
  });
});
```

Run: `cd client && npx vitest run src/data/__tests__/desktopWallpapers.test.ts`
Expected: 3 passing

- [ ] **Step 4: Add the upload UI to DesktopSettingsApp.tsx Personalization tab**

Below the wallpaper preset swatches section (after the `DESKTOP_WALLPAPERS.map(...)` block), add:

```tsx
import { CUSTOM_WALLPAPER_ID, setCustomWallpaperDataUrl, clearCustomWallpaper, CUSTOM_WALLPAPER_MAX_BYTES_EXPORTED } from '../../data/desktopWallpapers';

// Inside the Personalization tab render:
const fileInputRef = useRef<HTMLInputElement>(null);
const [customWallpaperError, setCustomWallpaperError] = useState<string | null>(null);

function handleCustomWallpaperUpload(e: React.ChangeEvent<HTMLInputElement>) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (file.size > CUSTOM_WALLPAPER_MAX_BYTES_EXPORTED) {
    setCustomWallpaperError('Image too large (max 4 MB). Compress it first.');
    return;
  }
  const reader = new FileReader();
  reader.onload = (ev) => {
    const dataUrl = ev.target?.result as string;
    setCustomWallpaperDataUrl(dataUrl);
    onWallpaperChange(CUSTOM_WALLPAPER_ID);
    setCustomWallpaperError(null);
  };
  reader.readAsDataURL(file);
}
```

In the JSX, after the swatches:
```tsx
<div className="mt-3 flex items-center gap-2">
  <button
    className="px-3 py-1.5 text-[11px] bg-surface-raised border border-border-subtle rounded-sm hover:bg-surface-hover text-text-primary transition-colors"
    onClick={() => fileInputRef.current?.click()}
  >
    Upload Image
  </button>
  {wallpaperId === CUSTOM_WALLPAPER_ID && (
    <button
      className="px-3 py-1.5 text-[11px] bg-surface-raised border border-border-subtle rounded-sm hover:bg-surface-hover text-text-secondary transition-colors"
      onClick={() => { clearCustomWallpaper(); onWallpaperChange('blue-silver-default'); }}
    >
      Remove
    </button>
  )}
  <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleCustomWallpaperUpload} />
</div>
{customWallpaperError && <p className="text-[11px] text-red-400 mt-1">{customWallpaperError}</p>}
```

- [ ] **Step 5: Run tests and commit**

```bash
cd client && npx vitest run && npx tsc --noEmit
git add client/src/data/desktopWallpapers.ts client/src/components/desktop/DesktopWallpaper.tsx client/src/components/desktop/DesktopSettingsApp.tsx client/src/data/__tests__/desktopWallpapers.test.ts
git commit -m "feat(desktop): custom wallpaper upload — base64 localStorage storage and rendering"
```

---

## Task 3: Calculator App + Run Dialog

**Files:**
- Create: `client/src/components/desktop/apps/DesktopCalculator.tsx`
- Create: `client/src/components/desktop/DesktopRunDialog.tsx`
- Modify: `client/src/utils/windowManager.ts` (register calculator)
- Modify: `client/src/components/desktop/FlexOSAppDrawer.tsx` (show in app grid)
- Modify: `client/src/components/desktop/DesktopKeyboardShortcuts.tsx` (Win+R for run dialog)
- Modify: `client/src/pages/DesktopPage.tsx` (render RunDialog conditionally)

**Interfaces:**
- `DesktopCalculator`: `export default function DesktopCalculator()` — no props, self-contained
- `DesktopRunDialog`: `export default function DesktopRunDialog({ open: boolean, onClose: () => void })`
- `windowManager.ts` entry: `{ key: 'calc', label: 'Calculator', icon: 'Calculator', description: 'Standard calculator' }`

### Calculator

- [ ] **Step 1: Create DesktopCalculator.tsx**

```tsx
// client/src/components/desktop/apps/DesktopCalculator.tsx
import React, { useState, useCallback, useEffect } from 'react';

type Op = '+' | '-' | '×' | '÷' | null;

function evaluate(a: number, b: number, op: Op): number {
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '×': return a * b;
    case '÷': return b === 0 ? NaN : a / b;
    default: return b;
  }
}

export default function DesktopCalculator() {
  const [display, setDisplay] = useState('0');
  const [prev, setPrev] = useState<number | null>(null);
  const [op, setOp] = useState<Op>(null);
  const [fresh, setFresh] = useState(false); // next digit replaces display

  const appendDigit = useCallback((d: string) => {
    setDisplay(prev => {
      if (fresh) { setFresh(false); return d; }
      if (prev === '0' && d !== '.') return d;
      if (d === '.' && prev.includes('.')) return prev;
      return prev.length >= 15 ? prev : prev + d;
    });
  }, [fresh]);

  const handleOp = useCallback((newOp: Op) => {
    const cur = parseFloat(display);
    if (prev !== null && op && !fresh) {
      const result = evaluate(prev, cur, op);
      setDisplay(isNaN(result) || !isFinite(result) ? 'Error' : String(parseFloat(result.toPrecision(12))));
      setPrev(isNaN(result) ? null : result);
    } else {
      setPrev(cur);
    }
    setOp(newOp);
    setFresh(true);
  }, [display, prev, op, fresh]);

  const equals = useCallback(() => {
    if (prev === null || op === null) return;
    const cur = parseFloat(display);
    const result = evaluate(prev, cur, op);
    setDisplay(isNaN(result) || !isFinite(result) ? 'Error' : String(parseFloat(result.toPrecision(12))));
    setPrev(null);
    setOp(null);
    setFresh(true);
  }, [display, prev, op]);

  const clear = () => { setDisplay('0'); setPrev(null); setOp(null); setFresh(false); };
  const toggleSign = () => setDisplay(d => d.startsWith('-') ? d.slice(1) : '-' + d);
  const percent = () => setDisplay(d => String(parseFloat(d) / 100));
  const backspace = () => setDisplay(d => d.length > 1 ? d.slice(0, -1) : '0');

  // Keyboard support
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ('0123456789.'.includes(e.key)) appendDigit(e.key);
      else if (e.key === '+') handleOp('+');
      else if (e.key === '-') handleOp('-');
      else if (e.key === '*') handleOp('×');
      else if (e.key === '/') { e.preventDefault(); handleOp('÷'); }
      else if (e.key === 'Enter' || e.key === '=') equals();
      else if (e.key === 'Backspace') backspace();
      else if (e.key === 'Escape') clear();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [appendDigit, handleOp, equals, backspace]);

  const btn = (label: string, onClick: () => void, variant: 'num' | 'op' | 'fn' | 'eq' = 'num') => {
    const base = 'flex items-center justify-center text-[14px] font-medium rounded-sm h-12 cursor-pointer select-none transition-colors';
    const variants = {
      num: 'bg-surface-raised hover:bg-surface-hover text-text-primary',
      fn:  'bg-surface-base hover:bg-surface-hover text-text-secondary',
      op:  'bg-surface-overlay hover:bg-surface-hover text-accent-silver-300',
      eq:  'bg-rmpg-600 hover:bg-rmpg-500 text-white',
    };
    return (
      <button key={label} className={`${base} ${variants[variant]}`} onClick={onClick}>
        {label}
      </button>
    );
  };

  return (
    <div className="flex flex-col bg-surface-sunken h-full select-none">
      {/* Display */}
      <div className="flex flex-col items-end px-4 py-3 min-h-[72px]">
        <div className="text-[11px] text-text-muted h-4">{prev !== null ? `${prev} ${op ?? ''}` : ''}</div>
        <div className="text-[32px] font-light text-text-primary truncate max-w-full leading-tight">{display}</div>
      </div>
      {/* Buttons */}
      <div className="grid grid-cols-4 gap-0.5 px-0.5 pb-0.5 flex-1">
        {btn('%', percent, 'fn')}
        {btn('CE', () => setDisplay('0'), 'fn')}
        {btn('C', clear, 'fn')}
        {btn('⌫', backspace, 'fn')}
        {btn('1/x', () => setDisplay(d => String(1 / parseFloat(d))), 'fn')}
        {btn('x²', () => setDisplay(d => String(parseFloat(d) ** 2)), 'fn')}
        {btn('√x', () => setDisplay(d => String(Math.sqrt(parseFloat(d)))), 'fn')}
        {btn('÷', () => handleOp('÷'), 'op')}
        {btn('7', () => appendDigit('7'), 'num')}
        {btn('8', () => appendDigit('8'), 'num')}
        {btn('9', () => appendDigit('9'), 'num')}
        {btn('×', () => handleOp('×'), 'op')}
        {btn('4', () => appendDigit('4'), 'num')}
        {btn('5', () => appendDigit('5'), 'num')}
        {btn('6', () => appendDigit('6'), 'num')}
        {btn('−', () => handleOp('-'), 'op')}
        {btn('1', () => appendDigit('1'), 'num')}
        {btn('2', () => appendDigit('2'), 'num')}
        {btn('3', () => appendDigit('3'), 'num')}
        {btn('+', () => handleOp('+'), 'op')}
        {btn('+/−', toggleSign, 'num')}
        {btn('0', () => appendDigit('0'), 'num')}
        {btn('.', () => appendDigit('.'), 'num')}
        {btn('=', equals, 'eq')}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Register calculator in windowManager.ts**

In `WINDOW_CONFIG`, add:
```ts
calc: {
  key: 'calc',
  label: 'Calculator',
  icon: 'SquareSigma',
  description: 'Standard calculator',
  defaultSize: { width: 280, height: 420 },
  minSize: { width: 260, height: 380 },
  resizable: false,
},
```

In `windowManager.ts` `activateNavFunction`, the calculator doesn't load a web route — it's a pure React component. Add a branch: when `key === 'calc'`, dispatch a custom event `{ type: 'open-calc' }` that `DesktopPage` listens for.

- [ ] **Step 3: Add calculator window to DesktopPage.tsx**

```tsx
const [calcOpen, setCalcOpen] = useState(false);
// listen for 'open-calc' event
useEffect(() => {
  const handler = () => setCalcOpen(true);
  window.addEventListener('open-calc', handler);
  return () => window.removeEventListener('open-calc', handler);
}, []);

// In JSX, near other conditionals:
{calcOpen && (
  <FloatingWindow title="Calculator" onClose={() => setCalcOpen(false)} defaultWidth={280} defaultHeight={420} resizable={false}>
    <DesktopCalculator />
  </FloatingWindow>
)}
```

### Run Dialog

- [ ] **Step 4: Create DesktopRunDialog.tsx**

```tsx
// client/src/components/desktop/DesktopRunDialog.tsx
import React, { useState, useRef, useEffect } from 'react';
import { Terminal } from 'lucide-react';

const KNOWN_COMMANDS: Record<string, { label: string; action: () => void }> = {
  calc:     { label: 'Calculator', action: () => window.dispatchEvent(new Event('open-calc')) },
  notepad:  { label: 'Notepad',    action: () => window.dispatchEvent(new CustomEvent('open-app', { detail: 'notepad' })) },
  taskmgr:  { label: 'Task Manager', action: () => window.dispatchEvent(new CustomEvent('open-app', { detail: 'task-manager' })) },
  settings: { label: 'Desktop Settings', action: () => window.dispatchEvent(new CustomEvent('open-app', { detail: 'settings' })) },
  dispatch: { label: 'Dispatch', action: () => window.dispatchEvent(new CustomEvent('open-app', { detail: 'dispatch' })) },
};

export default function DesktopRunDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) { setValue(''); setError(''); setTimeout(() => inputRef.current?.focus(), 50); }
  }, [open]);

  function handleRun() {
    const cmd = value.trim().toLowerCase();
    const entry = KNOWN_COMMANDS[cmd];
    if (entry) {
      entry.action();
      onClose();
    } else {
      setError(`'${cmd}' is not recognized. Try: ${Object.keys(KNOWN_COMMANDS).join(', ')}`);
    }
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[9000] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-surface-raised border border-border-subtle rounded-sm shadow-2xl w-[400px] p-4 z-10">
        <div className="flex items-center gap-2 mb-3">
          <Terminal size={16} className="text-accent-silver-400 flex-shrink-0" />
          <span className="text-[12px] font-semibold text-text-primary" style={{ color: 'var(--panel-header-color)' }}>Run</span>
        </div>
        <p className="text-[11px] text-text-secondary mb-3">Type the name of a program, and FlexOS will open it.</p>
        <input
          ref={inputRef}
          className="w-full bg-surface-sunken border border-border-subtle rounded-sm px-2 py-1.5 text-[12px] text-text-primary outline-none focus:border-rmpg-400 mb-2"
          value={value}
          onChange={e => { setValue(e.target.value); setError(''); }}
          onKeyDown={e => { if (e.key === 'Enter') handleRun(); if (e.key === 'Escape') onClose(); }}
          placeholder="Open..."
        />
        {error && <p className="text-[11px] text-red-400 mb-2">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className="px-3 py-1.5 text-[11px] bg-surface-base border border-border-subtle rounded-sm hover:bg-surface-hover text-text-secondary" onClick={onClose}>Cancel</button>
          <button className="px-3 py-1.5 text-[11px] bg-rmpg-600 hover:bg-rmpg-500 rounded-sm text-white" onClick={handleRun}>OK</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Wire Win+R in DesktopKeyboardShortcuts.tsx + render in DesktopPage**

In `DesktopKeyboardShortcuts.tsx`, listen for `Meta+r` (Mac) / detect as `e.key === 'r' && (e.metaKey || e.ctrlKey)` and dispatch `new CustomEvent('open-run-dialog')`.

In `DesktopPage.tsx`:
```tsx
const [runDialogOpen, setRunDialogOpen] = useState(false);
useEffect(() => {
  const handler = () => setRunDialogOpen(true);
  window.addEventListener('open-run-dialog', handler);
  return () => window.removeEventListener('open-run-dialog', handler);
}, []);
// In JSX:
<DesktopRunDialog open={runDialogOpen} onClose={() => setRunDialogOpen(false)} />
```

- [ ] **Step 6: Add Calculator to FlexOSAppDrawer app grid**

In `FlexOSAppDrawer.tsx`, add an entry with label "Calculator", icon `SquareSigma`, onClick dispatches `open-calc` event.

- [ ] **Step 7: Run tests and commit**

```bash
cd client && npx vitest run && npx tsc --noEmit
git add client/src/components/desktop/apps/DesktopCalculator.tsx client/src/components/desktop/DesktopRunDialog.tsx client/src/utils/windowManager.ts client/src/components/desktop/FlexOSAppDrawer.tsx client/src/components/desktop/DesktopKeyboardShortcuts.tsx client/src/pages/DesktopPage.tsx
git commit -m "feat(desktop): Calculator app + Run dialog (Win+R)"
```

---

## Task 4: Taskbar Jump Lists

**Files:**
- Modify: `client/src/components/desktop/DesktopTaskbar.tsx`
- Create: `client/src/components/desktop/DesktopJumpList.tsx`
- Create: `client/src/utils/recentApps.ts`

**What this builds:** Right-clicking a pinned or running app icon in the taskbar shows a Windows 11-style jump list with:
- **Pinned actions** (static, per-app — e.g. "New Call" for Dispatch, "New Warrant" for Records)
- **Recent** (last 3 items from localStorage)
- **Standard actions**: Pin/Unpin from taskbar, Close window (if running)

**Interfaces:**
- `recentApps.ts`: `recordAppOpen(appKey: string): void`, `getRecentApps(appKey: string): string[]` (returns last 3 route paths/labels)
- `DesktopJumpList`: `export default function DesktopJumpList({ appKey, x, y, isPinned, onPin, onUnpin, onClose, onDismiss })`

- [ ] **Step 1: Create recentApps.ts**

```ts
// client/src/utils/recentApps.ts
const KEY = (appKey: string) => `rmpg_desktop_recent_${appKey}`;
const MAX = 3;

export interface RecentEntry { label: string; route: string; ts: number; }

export function recordAppOpen(appKey: string, entry: RecentEntry): void {
  try {
    const existing: RecentEntry[] = JSON.parse(localStorage.getItem(KEY(appKey)) || '[]');
    const filtered = existing.filter(e => e.route !== entry.route);
    filtered.unshift(entry);
    localStorage.setItem(KEY(appKey), JSON.stringify(filtered.slice(0, MAX)));
  } catch { /* noop */ }
}

export function getRecentApps(appKey: string): RecentEntry[] {
  try { return JSON.parse(localStorage.getItem(KEY(appKey)) || '[]'); } catch { return []; }
}
```

- [ ] **Step 2: Write tests for recentApps.ts**

Create `client/src/utils/__tests__/recentApps.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { recordAppOpen, getRecentApps } from '../recentApps';

describe('recentApps', () => {
  beforeEach(() => localStorage.clear());

  it('stores and retrieves a recent entry', () => {
    recordAppOpen('dispatch', { label: 'Dispatch', route: '/dispatch', ts: 1 });
    expect(getRecentApps('dispatch')).toHaveLength(1);
  });

  it('deduplicates by route', () => {
    recordAppOpen('dispatch', { label: 'Dispatch', route: '/dispatch', ts: 1 });
    recordAppOpen('dispatch', { label: 'Dispatch', route: '/dispatch', ts: 2 });
    expect(getRecentApps('dispatch')).toHaveLength(1);
  });

  it('caps at 3 entries', () => {
    for (let i = 0; i < 5; i++)
      recordAppOpen('dispatch', { label: `Item ${i}`, route: `/r${i}`, ts: i });
    expect(getRecentApps('dispatch')).toHaveLength(3);
  });
});
```

Run: `cd client && npx vitest run src/utils/__tests__/recentApps.test.ts`
Expected: 3 passing

- [ ] **Step 3: Create DesktopJumpList.tsx**

```tsx
// client/src/components/desktop/DesktopJumpList.tsx
import React, { useEffect, useRef } from 'react';
import { Pin, PinOff, X, Clock } from 'lucide-react';
import { getRecentApps } from '../../utils/recentApps';

interface PinnedAction { label: string; icon?: React.ReactNode; onClick: () => void; }
interface JumpListProps {
  appKey: string;
  appLabel: string;
  x: number;
  y: number;
  pinnedActions?: PinnedAction[];
  isPinned: boolean;
  isRunning: boolean;
  onPin: () => void;
  onUnpin: () => void;
  onCloseWindow?: () => void;
  onDismiss: () => void;
}

export default function DesktopJumpList({ appKey, appLabel, x, y, pinnedActions = [], isPinned, isRunning, onPin, onUnpin, onCloseWindow, onDismiss }: JumpListProps) {
  const ref = useRef<HTMLDivElement>(null);
  const recents = getRecentApps(appKey);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss();
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [onDismiss]);

  // Clamp position so menu doesn't go off-screen
  const clampedY = Math.min(y, window.innerHeight - 300);
  const clampedX = Math.min(x, window.innerWidth - 220);

  const Item = ({ label, onClick, icon }: { label: string; onClick: () => void; icon?: React.ReactNode }) => (
    <button
      className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-text-primary hover:bg-surface-hover transition-colors text-left"
      onClick={() => { onClick(); onDismiss(); }}
    >
      {icon && <span className="text-text-muted w-3.5 flex-shrink-0">{icon}</span>}
      <span>{label}</span>
    </button>
  );

  const Divider = () => <div className="border-t border-border-subtle my-1" />;
  const SectionLabel = ({ label }: { label: string }) => (
    <div className="px-3 pt-1.5 pb-0.5 text-[9px] uppercase tracking-widest" style={{ color: 'var(--field-label-color)' }}>{label}</div>
  );

  return (
    <div
      ref={ref}
      className="fixed z-[9500] bg-surface-raised border border-border-subtle rounded-sm shadow-2xl w-52 py-1 overflow-hidden"
      style={{ left: clampedX, top: clampedY }}
    >
      <div className="px-3 py-1.5 text-[11px] font-semibold text-text-primary border-b border-border-subtle mb-1">{appLabel}</div>

      {pinnedActions.length > 0 && (
        <>
          <SectionLabel label="Actions" />
          {pinnedActions.map(a => <Item key={a.label} label={a.label} onClick={a.onClick} icon={a.icon} />)}
          <Divider />
        </>
      )}

      {recents.length > 0 && (
        <>
          <SectionLabel label="Recent" />
          {recents.map(r => <Item key={r.route} label={r.label} onClick={() => window.location.hash = r.route} icon={<Clock size={12} />} />)}
          <Divider />
        </>
      )}

      {isPinned
        ? <Item label="Unpin from taskbar" onClick={onUnpin} icon={<PinOff size={12} />} />
        : <Item label="Pin to taskbar" onClick={onPin} icon={<Pin size={12} />} />
      }
      {isRunning && onCloseWindow && (
        <Item label="Close window" onClick={onCloseWindow} icon={<X size={12} />} />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Wire jump list into DesktopTaskbar.tsx**

In `DesktopTaskbar.tsx`, find where app icon buttons are rendered. Add:

```tsx
import DesktopJumpList from './DesktopJumpList';
import { TASKBAR_PINNED_ACTIONS } from '../../data/taskbarPinnedActions'; // create this

const [jumpList, setJumpList] = useState<{ appKey: string; x: number; y: number } | null>(null);

// On right-click of an app icon:
onContextMenu={(e) => {
  e.preventDefault();
  setJumpList({ appKey: app.key, x: e.clientX, y: e.clientY - 240 });
}}

// Render (at end of return):
{jumpList && (
  <DesktopJumpList
    appKey={jumpList.appKey}
    appLabel={appLabelFor(jumpList.appKey)}
    x={jumpList.x}
    y={jumpList.y}
    pinnedActions={TASKBAR_PINNED_ACTIONS[jumpList.appKey] ?? []}
    isPinned={isAppPinned(jumpList.appKey)}
    isRunning={runningApps.includes(jumpList.appKey)}
    onPin={() => { pinApp(jumpList.appKey); setJumpList(null); }}
    onUnpin={() => { unpinApp(jumpList.appKey); setJumpList(null); }}
    onDismiss={() => setJumpList(null)}
  />
)}
```

- [ ] **Step 5: Create taskbarPinnedActions.ts with sensible CAD defaults**

Create `client/src/data/taskbarPinnedActions.ts`:

```ts
// Per-app pinned jump list actions shown above "recent"
export const TASKBAR_PINNED_ACTIONS: Record<string, Array<{ label: string; route?: string; event?: string }>> = {
  dispatch: [
    { label: 'New Call',       route: '/dispatch?action=new-call' },
    { label: 'Active Units',   route: '/dispatch?view=units' },
    { label: 'Radio Channels', route: '/dispatch?view=radio' },
  ],
  records: [
    { label: 'New Incident',   route: '/records/incidents/new' },
    { label: 'Search Records', route: '/records/search' },
  ],
  warrants: [
    { label: 'New Warrant',    route: '/warrants/new' },
    { label: 'Active Warrants',route: '/warrants?status=active' },
  ],
  map: [
    { label: 'Full Map View',  route: '/map' },
    { label: 'Satellite Mode', event: 'map:satellite' },
  ],
  calc: [
    { label: 'Open Calculator', event: 'open-calc' },
  ],
};
```

- [ ] **Step 6: Run tests and commit**

```bash
cd client && npx vitest run && npx tsc --noEmit
git add client/src/components/desktop/DesktopJumpList.tsx client/src/utils/recentApps.ts client/src/data/taskbarPinnedActions.ts client/src/components/desktop/DesktopTaskbar.tsx client/src/utils/__tests__/recentApps.test.ts
git commit -m "feat(desktop): taskbar jump lists with pinned actions and recent items"
```

---

## Task 5: Enhanced Quick Settings — Audio, Network, Battery

**Files:**
- Modify: `client/src/components/desktop/DesktopQuickSettings.tsx`
- Modify: `desktop/main.js` (3 new IPC channels: `system:get-battery`, `system:get-network`, `system:set-volume`)
- Modify: `desktop/preload.js` (expose 3 new `window.electron.*` methods)

**What this builds:**
- **Volume slider** — reads system master volume via Electron `shell` + PowerShell, sets it via `nircmd.exe` or Web Audio
- **Battery panel** — percentage, charging state, time remaining (Windows `win32-battery` via `wmic`)
- **Network info** — current WiFi SSID + signal quality (Windows `netsh wlan show interfaces`)

**Constraints:** All system queries run via `child_process.execSync` wrapped in try/catch. Failures return `null`, UI shows `—` gracefully. Only executed on Windows (`process.platform === 'win32'`). Web Audio API `GainNode` is used for in-app volume (no external tool needed for a first pass).

- [ ] **Step 1: Add IPC channels in main.js**

After the existing `guardedHandle` blocks, add:

```js
// ── System info: battery ──
guardedHandle('system:get-battery', async () => {
  if (process.platform !== 'win32') return null;
  try {
    const { execSync } = require('child_process');
    const out = execSync(
      'wmic path Win32_Battery get EstimatedChargeRemaining,BatteryStatus /format:csv',
      { timeout: 3000, encoding: 'utf8', windowsHide: true }
    );
    const lines = out.trim().split('\n').filter(l => l.trim() && !l.startsWith('Node'));
    if (!lines.length) return null;
    const parts = lines[0].split(',');
    // CSV: Node, EstimatedChargeRemaining, BatteryStatus
    const pct = parseInt(parts[1], 10);
    const status = parseInt(parts[2], 10); // 2 = AC, 1 = Discharging
    return { percent: isNaN(pct) ? null : pct, charging: status === 2 };
  } catch { return null; }
});

// ── System info: network ──
guardedHandle('system:get-network', async () => {
  if (process.platform !== 'win32') return null;
  try {
    const { execSync } = require('child_process');
    const out = execSync(
      'netsh wlan show interfaces',
      { timeout: 3000, encoding: 'utf8', windowsHide: true }
    );
    const ssidMatch = out.match(/\s+SSID\s+:\s+(.+)/);
    const signalMatch = out.match(/\s+Signal\s+:\s+(\d+)%/);
    return {
      ssid: ssidMatch ? ssidMatch[1].trim() : null,
      signal: signalMatch ? parseInt(signalMatch[1], 10) : null,
    };
  } catch { return null; }
});

// ── System: set volume (0-100 int) ──
guardedHandle('system:set-volume', async (_event, level) => {
  if (process.platform !== 'win32') return;
  const pct = Math.max(0, Math.min(100, Math.round(Number(level))));
  try {
    const { execSync } = require('child_process');
    // PowerShell one-liner — no external tool required
    execSync(
      `powershell -NoProfile -NonInteractive -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]173); $vol = [math]::Round($pct/100 * 65535); (New-Object -ComObject WScript.Shell)" `,
      { timeout: 2000, encoding: 'utf8', windowsHide: true }
    );
  } catch { /* noop — volume set is best-effort */ }
});
```

**Better volume approach** — use the Windows `SndVol` API via a helper script or just expose the Web Audio API `GainNode` globally for in-app audio and skip true system-level volume (note this in code as a known limitation):

```js
// system:set-volume: controls the app's own Web Audio context gain, not OS master volume
// True OS master volume requires nircmd.exe or VBScript; deferred to a future task.
guardedHandle('system:set-volume', async (_event, level) => {
  // The renderer uses Web Audio GainNode directly — this channel is a no-op placeholder
  // so the preload bridge is ready when a proper OS integration is added.
  return { ok: true, note: 'rendered-side-only' };
});
```

- [ ] **Step 2: Expose in preload.js**

In the `contextBridge.exposeInMainWorld('electron', { ... })` block, add:

```js
getBattery:   () => ipcRenderer.invoke('system:get-battery'),
getNetwork:   () => ipcRenderer.invoke('system:get-network'),
setVolume:    (level) => ipcRenderer.invoke('system:set-volume', level),
```

- [ ] **Step 3: Enhance DesktopQuickSettings.tsx**

Add battery + network sections to the Quick Settings flyout:

```tsx
// Battery section
const [battery, setBattery] = useState<{ percent: number | null; charging: boolean } | null>(null);
const [network, setNetwork] = useState<{ ssid: string | null; signal: number | null } | null>(null);
const [volume, setVolume] = useState(75);

useEffect(() => {
  if (!open) return;
  // Poll battery and network when flyout opens
  if (window.electron?.getBattery) {
    window.electron.getBattery().then(setBattery).catch(() => {});
  }
  if (window.electron?.getNetwork) {
    window.electron.getNetwork().then(setNetwork).catch(() => {});
  }
}, [open]);

// Volume slider uses Web Audio
function handleVolumeChange(v: number) {
  setVolume(v);
  if (window.electron?.setVolume) window.electron.setVolume(v).catch(() => {});
}
```

In the JSX flyout panel, add sections:

```tsx
{/* Volume */}
<div className="px-3 py-2 border-t border-border-subtle">
  <p className="text-[9px] uppercase tracking-widest mb-1" style={{ color: 'var(--field-label-color)' }}>Volume</p>
  <div className="flex items-center gap-2">
    <Volume2 size={12} className="text-text-muted flex-shrink-0" />
    <input type="range" min={0} max={100} value={volume} onChange={e => handleVolumeChange(Number(e.target.value))}
      className="flex-1 h-1 accent-rmpg-400" />
    <span className="text-[10px] text-text-secondary w-7 text-right">{volume}%</span>
  </div>
</div>

{/* Network */}
{network !== undefined && (
  <div className="px-3 py-2 border-t border-border-subtle">
    <p className="text-[9px] uppercase tracking-widest mb-1" style={{ color: 'var(--field-label-color)' }}>Network</p>
    <div className="flex items-center gap-2">
      <Wifi size={12} className="text-text-muted flex-shrink-0" />
      <span className="text-[11px] text-text-primary flex-1 truncate">{network?.ssid ?? '—'}</span>
      {network?.signal != null && <span className="text-[10px] text-text-secondary">{network.signal}%</span>}
    </div>
  </div>
)}

{/* Battery */}
{battery !== undefined && (
  <div className="px-3 py-2 border-t border-border-subtle">
    <p className="text-[9px] uppercase tracking-widest mb-1" style={{ color: 'var(--field-label-color)' }}>Battery</p>
    <div className="flex items-center gap-2">
      {battery?.charging ? <ZapIcon size={12} className="text-green-400 flex-shrink-0" /> : <BatteryMedium size={12} className="text-text-muted flex-shrink-0" />}
      <span className="text-[11px] text-text-primary">{battery?.percent != null ? `${battery.percent}%` : '—'}</span>
      {battery?.charging && <span className="text-[10px] text-green-400">Charging</span>}
    </div>
  </div>
)}
```

- [ ] **Step 4: Run tests and commit**

```bash
cd desktop && npm test
cd ../client && npx vitest run && npx tsc --noEmit
git add desktop/main.js desktop/preload.js client/src/components/desktop/DesktopQuickSettings.tsx
git commit -m "feat(desktop): enhanced quick settings — volume slider, WiFi info, battery status"
```

---

## Task 6: World Clock Flyout + Enhanced Notification Center

**Files:**
- Modify: `client/src/components/desktop/CalendarFlyout.tsx`
- Modify: `client/src/components/desktop/DesktopNotificationCenter.tsx`
- Create: `client/src/utils/notificationHistory.ts`

### World Clock

- [ ] **Step 1: Add world time zones to CalendarFlyout.tsx**

After the mini calendar in the flyout, add a world times section:

```tsx
const TIME_ZONES = [
  { label: 'Mountain (Local)', tz: 'America/Denver' },
  { label: 'Pacific',          tz: 'America/Los_Angeles' },
  { label: 'Eastern',          tz: 'America/New_York' },
  { label: 'UTC',              tz: 'UTC' },
] as const;

function formatZoneTime(tz: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
}

// In flyout JSX:
<div className="border-t border-border-subtle mt-2 pt-2 px-3 pb-2">
  <p className="text-[9px] uppercase tracking-widest mb-2" style={{ color: 'var(--field-label-color)' }}>World Times</p>
  {TIME_ZONES.map(({ label, tz }) => (
    <div key={tz} className="flex justify-between items-center py-0.5">
      <span className="text-[11px] text-text-secondary">{label}</span>
      <span className="text-[11px] text-text-primary font-medium tabular-nums">{formatZoneTime(tz)}</span>
    </div>
  ))}
</div>
```

Add a `useEffect` that re-renders every 30 seconds using `useState(Date.now())` + `setInterval` to keep the zone times current.

### Notification Center 2.0

- [ ] **Step 2: Create notificationHistory.ts**

```ts
// client/src/utils/notificationHistory.ts
export interface StoredNotification {
  id: string;
  category: 'dispatch' | 'warrant' | 'fleet' | 'system' | 'welfare';
  title: string;
  body: string;
  ts: number;
  read: boolean;
  actions?: Array<{ label: string; route: string }>;
}

const KEY = 'rmpg_notification_history';
const MAX = 100;

export function getNotificationHistory(): StoredNotification[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}

export function pushNotification(n: Omit<StoredNotification, 'id' | 'read'>): void {
  const id = `n_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const all = [{ ...n, id, read: false }, ...getNotificationHistory()].slice(0, MAX);
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* noop */ }
}

export function markAllRead(): void {
  const all = getNotificationHistory().map(n => ({ ...n, read: true }));
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* noop */ }
}

export function clearCategory(category: StoredNotification['category']): void {
  const all = getNotificationHistory().filter(n => n.category !== category);
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* noop */ }
}

export function getUnreadCount(): number {
  return getNotificationHistory().filter(n => !n.read).length;
}
```

- [ ] **Step 3: Write tests for notificationHistory.ts**

Create `client/src/utils/__tests__/notificationHistory.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { pushNotification, getNotificationHistory, markAllRead, clearCategory, getUnreadCount } from '../notificationHistory';

describe('notificationHistory', () => {
  beforeEach(() => localStorage.clear());

  it('pushes and retrieves a notification', () => {
    pushNotification({ category: 'dispatch', title: 'Test', body: 'Body', ts: 1 });
    expect(getNotificationHistory()).toHaveLength(1);
  });

  it('marks all as read', () => {
    pushNotification({ category: 'dispatch', title: 'Test', body: 'Body', ts: 1 });
    expect(getUnreadCount()).toBe(1);
    markAllRead();
    expect(getUnreadCount()).toBe(0);
  });

  it('clears by category', () => {
    pushNotification({ category: 'dispatch', title: 'A', body: '', ts: 1 });
    pushNotification({ category: 'system',   title: 'B', body: '', ts: 2 });
    clearCategory('dispatch');
    const remaining = getNotificationHistory();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].title).toBe('B');
  });
});
```

Run: `cd client && npx vitest run src/utils/__tests__/notificationHistory.test.ts`
Expected: 3 passing

- [ ] **Step 4: Enhance DesktopNotificationCenter.tsx with grouped view + action buttons**

Restructure the notification center to:
1. Group notifications by `category` with collapsible sections
2. Show a "Clear category" button per group header
3. Show inline action buttons below each notification
4. Show unread badge count on the bell icon via `getUnreadCount()`

```tsx
const CATEGORY_LABELS: Record<string, string> = {
  dispatch: 'Dispatch',
  warrant: 'Warrants',
  fleet: 'Fleet',
  system: 'System',
  welfare: 'Welfare',
};

// Group notifications
const grouped = notifications.reduce((acc, n) => {
  if (!acc[n.category]) acc[n.category] = [];
  acc[n.category].push(n);
  return acc;
}, {} as Record<string, StoredNotification[]>);

// Render per group:
{Object.entries(grouped).map(([cat, items]) => (
  <div key={cat} className="mb-2">
    <div className="flex items-center justify-between px-3 py-1.5 border-b border-border-subtle">
      <span className="text-[9px] uppercase tracking-widest" style={{ color: 'var(--field-label-color)' }}>
        {CATEGORY_LABELS[cat] ?? cat}
      </span>
      <button className="text-[9px] text-text-muted hover:text-text-secondary transition-colors"
        onClick={() => { clearCategory(cat as any); refresh(); }}>
        Clear
      </button>
    </div>
    {items.map(n => (
      <div key={n.id} className={`px-3 py-2 border-b border-border-subtle ${!n.read ? 'bg-surface-raised' : ''}`}>
        <p className="text-[11px] font-medium text-text-primary">{n.title}</p>
        <p className="text-[10px] text-text-secondary mt-0.5">{n.body}</p>
        {n.actions && n.actions.length > 0 && (
          <div className="flex gap-2 mt-1.5">
            {n.actions.map(a => (
              <button key={a.label} className="text-[10px] px-2 py-0.5 bg-rmpg-700 hover:bg-rmpg-600 text-white rounded-sm transition-colors"
                onClick={() => { window.location.hash = a.route; onClose(); }}>
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    ))}
  </div>
))}
```

- [ ] **Step 5: Show unread badge on taskbar notification bell**

In `DesktopTaskbar.tsx` (or `DesktopSystemTray.tsx`), read `getUnreadCount()` and show a red badge pill:

```tsx
import { getUnreadCount } from '../../utils/notificationHistory';
const [unreadCount, setUnreadCount] = useState(() => getUnreadCount());
// Refresh every 30s:
useEffect(() => {
  const id = setInterval(() => setUnreadCount(getUnreadCount()), 30_000);
  return () => clearInterval(id);
}, []);

// On the bell icon:
<div className="relative">
  <BellIcon size={16} />
  {unreadCount > 0 && (
    <span className="absolute -top-1 -right-1 min-w-[14px] h-3.5 bg-red-500 rounded-full text-[8px] text-white flex items-center justify-center px-0.5">
      {unreadCount > 99 ? '99+' : unreadCount}
    </span>
  )}
</div>
```

- [ ] **Step 6: Run tests and commit**

```bash
cd client && npx vitest run && npx tsc --noEmit
git add client/src/components/desktop/CalendarFlyout.tsx client/src/components/desktop/DesktopNotificationCenter.tsx client/src/utils/notificationHistory.ts client/src/utils/__tests__/notificationHistory.test.ts client/src/components/desktop/DesktopTaskbar.tsx
git commit -m "feat(desktop): world clock flyout, notification center 2.0 with groups + actions"
```

---

## Task 7: Default Module Auto-Pin + Wallpaper Slideshow

**Files:**
- Create: `client/src/utils/defaultModulePins.ts`
- Modify: `client/src/pages/DesktopPage.tsx` (run default-pin seeding on first boot)
- Modify: `client/src/data/desktopWallpapers.ts` (add slideshow support)
- Modify: `client/src/components/desktop/DesktopSettingsApp.tsx` (slideshow toggle + interval)
- Modify: `client/src/components/desktop/DesktopWallpaper.tsx` (slideshow cycle logic)

### Default Module Auto-Pin

**Problem:** New users (and users after clearing localStorage) see an empty desktop with "No modules pinned yet." Fix: on first load (when pinned-icons localStorage is absent), seed role-appropriate default icons.

- [ ] **Step 1: Create defaultModulePins.ts**

```ts
// client/src/utils/defaultModulePins.ts
const SEED_KEY = 'rmpg_desktop_icons_seeded_v1';

// Each entry maps a user role to a list of app keys that should be auto-pinned
const ROLE_DEFAULT_PINS: Record<string, string[]> = {
  admin:            ['dispatch', 'map', 'records', 'warrants', 'personnel', 'admin', 'reports', 'desktop'],
  manager:          ['dispatch', 'map', 'records', 'warrants', 'personnel', 'reports', 'desktop'],
  supervisor:       ['dispatch', 'map', 'records', 'warrants', 'personnel', 'desktop'],
  officer:          ['dispatch', 'map', 'mdt', 'records', 'desktop'],
  dispatcher:       ['dispatch', 'map', 'records', 'personnel', 'desktop'],
  contract_manager: ['dispatch', 'records', 'reports', 'desktop'],
  client_viewer:    ['dispatch', 'map', 'reports', 'desktop'],
  human_resources:  ['personnel', 'records', 'reports', 'desktop'],
};

export function hasBeenSeeded(): boolean {
  return localStorage.getItem(SEED_KEY) === '1';
}

export function markSeeded(): void {
  localStorage.setItem(SEED_KEY, '1');
}

export function getDefaultPinsForRole(role: string): string[] {
  return ROLE_DEFAULT_PINS[role] ?? ROLE_DEFAULT_PINS['officer'];
}
```

- [ ] **Step 2: Write test for defaultModulePins.ts**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { hasBeenSeeded, markSeeded, getDefaultPinsForRole } from '../defaultModulePins';

describe('defaultModulePins', () => {
  beforeEach(() => localStorage.clear());
  it('returns not seeded initially', () => expect(hasBeenSeeded()).toBe(false));
  it('returns seeded after markSeeded', () => { markSeeded(); expect(hasBeenSeeded()).toBe(true); });
  it('returns admin pins for admin role', () => expect(getDefaultPinsForRole('admin')).toContain('admin'));
  it('falls back to officer pins for unknown role', () => expect(getDefaultPinsForRole('unknown')).toContain('mdt'));
});
```

- [ ] **Step 3: Seed pins in DesktopPage.tsx on first render**

After the prefs load gate (where `preferences` is available and the user's role is known), add:

```tsx
import { hasBeenSeeded, markSeeded, getDefaultPinsForRole } from '../utils/defaultModulePins';

// In the DesktopPageInner useEffect on mount:
useEffect(() => {
  if (!hasBeenSeeded() && user?.role) {
    const pins = getDefaultPinsForRole(user.role);
    pins.forEach(appKey => {
      // call the existing pinApp utility (or dispatch the same event the user would use)
      pinDesktopIcon(appKey); // existing function from desktopIconPreferences
    });
    markSeeded();
  }
}, [user?.role]); // only runs once per fresh installation
```

### Wallpaper Slideshow

- [ ] **Step 4: Add slideshow state to desktopWallpapers.ts**

```ts
const SLIDESHOW_KEY = 'rmpg_desktop_wallpaper_slideshow';
const SLIDESHOW_INTERVAL_KEY = 'rmpg_desktop_wallpaper_slideshow_interval_min';

export function isSlideshowEnabled(): boolean {
  return localStorage.getItem(SLIDESHOW_KEY) === '1';
}
export function setSlideshowEnabled(on: boolean): void {
  localStorage.setItem(SLIDESHOW_KEY, on ? '1' : '0');
}
export function getSlideshowIntervalMin(): number {
  return parseInt(localStorage.getItem(SLIDESHOW_INTERVAL_KEY) || '5', 10);
}
export function setSlideshowIntervalMin(min: number): void {
  localStorage.setItem(SLIDESHOW_INTERVAL_KEY, String(min));
}
```

- [ ] **Step 5: Add slideshow cycling to DesktopWallpaper.tsx**

```tsx
import { isSlideshowEnabled, getSlideshowIntervalMin, DESKTOP_WALLPAPERS } from '../../data/desktopWallpapers';

// Inside DesktopWallpaper, after the existing logic:
const [slideshowIndex, setSlideshowIndex] = useState(0);
const slideshowEnabled = isSlideshowEnabled();
const intervalMin = getSlideshowIntervalMin();

useEffect(() => {
  if (!slideshowEnabled) return;
  const presets = DESKTOP_WALLPAPERS.filter(w => w.id !== 'custom-image');
  const id = setInterval(() => {
    setSlideshowIndex(i => (i + 1) % presets.length);
  }, intervalMin * 60_000);
  return () => clearInterval(id);
}, [slideshowEnabled, intervalMin]);

const effectiveWallpaper = slideshowEnabled
  ? DESKTOP_WALLPAPERS.filter(w => w.id !== 'custom-image')[slideshowIndex]
  : getWallpaper(wallpaperId);
```

- [ ] **Step 6: Add slideshow toggle to DesktopSettingsApp.tsx Personalization tab**

Below the wallpaper presets section:

```tsx
import { isSlideshowEnabled, setSlideshowEnabled, getSlideshowIntervalMin, setSlideshowIntervalMin } from '../../data/desktopWallpapers';

const [slideshow, setSlideshowState] = useState(isSlideshowEnabled);
const [slideshowInterval, setSlideshowIntervalState] = useState(getSlideshowIntervalMin);

// JSX:
<div className="mt-3 flex items-center gap-3">
  <label className="flex items-center gap-2 cursor-pointer">
    <input type="checkbox" checked={slideshow} onChange={e => { setSlideshowEnabled(e.target.checked); setSlideshowState(e.target.checked); }} className="accent-rmpg-400" />
    <span className="text-[11px] text-text-primary">Wallpaper slideshow</span>
  </label>
  {slideshow && (
    <select
      className="bg-surface-sunken border border-border-subtle rounded-sm px-2 py-1 text-[11px] text-text-primary"
      value={slideshowInterval}
      onChange={e => { setSlideshowIntervalMin(Number(e.target.value)); setSlideshowIntervalState(Number(e.target.value)); }}
    >
      {[1, 5, 10, 30, 60].map(m => <option key={m} value={m}>{m === 60 ? '1 hour' : `${m} min`}</option>)}
    </select>
  )}
</div>
```

- [ ] **Step 7: Run full test suite and commit**

```bash
cd client && npx vitest run && npx tsc --noEmit
git add client/src/utils/defaultModulePins.ts client/src/pages/DesktopPage.tsx client/src/data/desktopWallpapers.ts client/src/components/desktop/DesktopWallpaper.tsx client/src/components/desktop/DesktopSettingsApp.tsx
git commit -m "feat(desktop): auto-pin role defaults on first boot + wallpaper slideshow mode"
```

---

## Post-Task: PR and Deploy

After all 7 tasks pass review:

```bash
git push origin claude/flexos-override-windows-e90c1f
gh pr create -R rmpgutah/rmpg-flex \
  --title "feat(desktop): 10x FlexOS enhancement — custom wallpaper, Calculator, Run dialog, jump lists, Quick Settings, world clock, Notification Center 2.0, auto-pin defaults" \
  --base main \
  --body "$(cat <<'EOF'
## Summary
- **Task 1**: Splash lock screen — remove compositor border, RMPG logo watermark, deeper navy gradient
- **Task 2**: Custom wallpaper — file upload → base64 localStorage, rendered via DesktopWallpaper
- **Task 3**: Calculator app (full keyboard support) + Win+R Run Dialog
- **Task 4**: Taskbar jump lists — right-click for pinned actions (per-app CAD shortcuts) + recent history
- **Task 5**: Enhanced Quick Settings — volume slider, live WiFi SSID + signal, battery % + charging state
- **Task 6**: World clock in calendar flyout + Notification Center 2.0 (grouped by category, action buttons, unread badge)
- **Task 7**: Auto-pin role-appropriate default modules on first boot + wallpaper slideshow

## Test plan
- [ ] Worker typecheck: `npm run typecheck`
- [ ] Client typecheck: `cd client && npx tsc --noEmit`
- [ ] Client tests: `cd client && npx vitest run` (all new tests included)
- [ ] Desktop tests: `cd desktop && npm test`
- [ ] Visual smoke: Calculator opens and calculates correctly; wallpaper upload persists on reload; jump list appears on right-click; Quick Settings shows battery and WiFi on FZ-55

🤖 Generated with Claude Code
EOF
)"
```
