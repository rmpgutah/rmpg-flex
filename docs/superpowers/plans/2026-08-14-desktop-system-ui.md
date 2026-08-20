# Desktop System UI — Fix & Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the missing login background in `splash.html` and migrate every hardcoded hex/rgba color literal to CSS variables across all 7 desktop shell UI files.

**Architecture:** Two rendering contexts are addressed independently. Standalone Electron HTML files (`splash.html`, `kioskEscape.html`) get a local `:root {}` block that mirrors the Blue & Silver palette in raw hex — no Vite pipeline is available in those files. The five React FlexOS components use the existing CSS variable system via `rgba(var(--token-rgb),α)` pattern. All required `-rgb` triples already exist in `theme-palettes.css` — a verification grep confirms this before any edits begin.

**Tech Stack:** Vanilla CSS (HTML files), React 18 inline styles (TSX), CSS custom properties from `client/src/styles/theme-palettes.css`.

## Global Constraints

- `background: #000` in the boot phase of `splash.html` (`#phase-boot`) — intentional, do not replace.
- `AVATAR_PALETTE` array in `DesktopLockScreen.tsx` — intentionally hardcoded (deterministic hash per username). Do not replace.
- `rgba(0 0 0 / 0.2)` on the agency header div in `DesktopLockScreen.tsx` — intentionally pure-black semi-transparent overlay. Do not replace.
- `background: '#000'` on the root screensaver div in `DesktopScreenSaver.tsx` — intentional (anti-burn, tactical context). Do not replace.
- All changes are value-only. No behavioral, structural, or logic changes to any file.
- Run `cd client && npx vitest run` + `cd client && npx tsc --noEmit` after every task. Both must pass before committing.
- Spec: `docs/superpowers/specs/2026-08-14-desktop-system-ui-design.md`

---

### Task 1: Verify -rgb variable availability in theme-palettes.css

**Files:**
- Read-only: `client/src/styles/theme-palettes.css`

**Interfaces:**
- Produces: confirmed availability of `--surface-overlay-rgb`, `--surface-sunken-rgb`, `--accent-silver-400-rgb`, `--rmpg-700-rgb`, `--rmpg-800-rgb`, `--sev-ok-rgb`, `--sev-critical-rgb` — all React tasks depend on these.

- [ ] **Step 1: Grep for all required -rgb variables**

```bash
grep -n 'surface-overlay-rgb\|surface-sunken-rgb\|accent-silver-400-rgb\|rmpg-700-rgb\|rmpg-800-rgb\|sev-ok-rgb\|sev-critical-rgb' client/src/styles/theme-palettes.css
```

Expected: at least 4 lines per variable (one per theme block). If ANY variable is missing from any block, add it to that block using the values below before proceeding.

| Variable | Blue & Silver value | Night value | Day value | Legacy value |
|---|---|---|---|---|
| `--surface-overlay-rgb` | `20 40 64` | `6 11 16` | `255 255 255` | `3 3 3` |
| `--surface-sunken-rgb` | `26 51 80` | `10 16 24` | `214 211 200` | `0 0 0` |
| `--accent-silver-400-rgb` | `208 216 224` | `207 216 226` | `74 85 97` | `212 212 212` |
| `--rmpg-700-rgb` | `44 79 116` | `30 43 58` | `214 211 200` | `45 45 45` |
| `--rmpg-800-rgb` | `34 64 95` | `21 33 46` | `236 233 221` | `27 27 27` |
| `--sev-ok-rgb` | `34 197 94` | `34 197 94` | `21 128 61` | `34 197 94` |
| `--sev-critical-rgb` | `239 68 68` | `239 68 68` | `185 28 28` | `239 68 68` |

- [ ] **Step 2: Note the Blue & Silver rmpg-700 and rmpg-800 values**

In the Blue & Silver block:
- `--rmpg-800-rgb: 34 64 95` — this is the exact rgb equivalent of `rgba(34,64,95,...)` in `DesktopLockScreen`. Use `--rmpg-800-rgb` for those card backgrounds.
- `--rmpg-700-rgb: 44 79 116` — use this for `rgba(62,116,168,...)` and `rgba(45,90,135,...)` (pre-migration palette values that lack an exact token; `rmpg-700` is the closest structural equivalent).

- [ ] **Step 3: Commit only if edits were needed**

If no variables were missing, skip this step. If you had to add vars:

```bash
git add client/src/styles/theme-palettes.css
git commit -m "fix(theme): add missing -rgb triples to theme-palettes.css"
```

---

### Task 2: Fix splash.html — local CSS vars + gradient background + hex sweep

**Files:**
- Modify: `desktop/splash.html`

**Interfaces:**
- Consumes: nothing external — standalone HTML with no Vite/Tailwind pipeline
- Produces: a fully themed splash screen that renders the lock/welcome phases without requiring `./assets/login-bg.jpg`

- [ ] **Step 1: Add the local CSS var block**

In `desktop/splash.html`, immediately after `<style>` (before the `*, *::before` reset rule on line 8), insert:

```css
    :root {
      --s-base:         #0d1722;
      --s-raised:       #15212e;
      --s-sunken:       #0a1018;
      --s-overlay:      #142840;
      --silver-300:     #e3e9f0;
      --silver-400:     #cfd8e2;
      --text-primary:   #f0f4f9;
      --text-secondary: #a8bccf;
      --text-muted:     #8fa3b8;
      --text-dim:       #6a8ba8;
      --text-hint:      #3e5e7e;
      --sev-critical:   #ef4444;
      --lock-bg:        linear-gradient(135deg, #142840 0%, #0d1722 60%, #0a1018 100%);
      --lock-overlay:   rgba(10, 18, 32, 0.35);
      --glow-color:     rgba(207, 216, 226, 0.18);
      --border-subtle:  rgba(207, 216, 226, 0.08);
      --border-moderate:rgba(207, 216, 226, 0.25);
      --border-visible: rgba(207, 216, 226, 0.35);
      --avatar-bg:      #2d4f6e;
    }
```

- [ ] **Step 2: Replace boot phase colors**

In the `.boot-logo` rule, replace the drop-shadow:
```css
/* BEFORE */
filter: drop-shadow(0 0 24px rgba(195,204,214,0.18));
/* AFTER */
filter: drop-shadow(0 0 24px var(--glow-color));
```

In the `.win-dots-ring span` rule:
```css
/* BEFORE */
background: #c3ccd6;
/* AFTER */
background: var(--silver-400);
```

In the `.org-label` rule:
```css
/* BEFORE */
color: #8fa3b8;
/* AFTER */
color: var(--text-muted);
```

- [ ] **Step 3: Replace lock phase backgrounds (functional fix)**

The `./assets/login-bg.jpg` file does not exist — these are the broken references. Replace both background declarations:

```css
/* BEFORE — line ~40 */
#phase-lock { background: #0b1928 url('./assets/login-bg.jpg') center center / cover no-repeat; gap: 0; position: relative; }
/* AFTER */
#phase-lock { background: var(--lock-bg); gap: 0; position: relative; }

/* BEFORE — line ~41 */
#phase-lock::before { content: ''; position: absolute; inset: 0; background: rgba(11,25,40,0.38); pointer-events: none; z-index: 0; }
/* AFTER */
#phase-lock::before { content: ''; position: absolute; inset: 0; background: var(--lock-overlay); pointer-events: none; z-index: 0; }
```

- [ ] **Step 4: Replace lock phase text and control colors**

```css
/* .lock-time — BEFORE */
color: #fff;
/* AFTER */
color: var(--text-primary);

/* .lock-date — BEFORE */
color: #a8bccf;
/* AFTER */
color: var(--text-secondary);

/* .avatar-wrap — BEFORE */
background: #2d4f6e; ... color: #c3ccd6; border: 2px solid rgba(195,204,214,0.25);
/* AFTER */
background: var(--avatar-bg); ... color: var(--silver-400); border: 2px solid var(--border-moderate);

/* .user-display-name — BEFORE */
color: #f0f4f9;
/* AFTER */
color: var(--text-primary);

/* .user-sub — BEFORE */
color: #6a8ba8;
/* AFTER */
color: var(--text-dim);

/* .pw-wrap border-bottom — BEFORE */
border-bottom: 1px solid rgba(195,204,214,0.35);
/* AFTER */
border-bottom: 1px solid var(--border-visible);

/* .pw-wrap:focus-within — BEFORE */
.pw-wrap:focus-within { border-color: #c3ccd6; }
/* AFTER */
.pw-wrap:focus-within { border-color: var(--silver-400); }

/* .pw-input color — BEFORE */
color: #f0f4f9;
/* AFTER */
color: var(--text-primary);

/* .pw-input::placeholder — BEFORE */
.pw-input::placeholder { color: #3e5e7e; }
/* AFTER */
.pw-input::placeholder { color: var(--text-hint); }

/* .pw-eye, .pw-submit color — BEFORE */
color: #8fa3b8;
/* AFTER */
color: var(--text-muted);

/* .pw-eye:hover, .pw-submit:hover — BEFORE */
.pw-eye:hover, .pw-submit:hover { color: #f0f4f9; }
/* AFTER */
.pw-eye:hover, .pw-submit:hover { color: var(--text-primary); }

/* .lock-error — BEFORE */
color: #ef4444;
/* AFTER */
color: var(--sev-critical);

/* .lock-hint — BEFORE */
color: #2e4a60;
/* AFTER */
color: var(--text-hint);
```

- [ ] **Step 5: Replace glow pulse and welcome phase**

```css
/* #phase-lock::after radial gradient — BEFORE */
background: radial-gradient(circle, rgba(195,204,214,0.18) 0%, transparent 68%);
/* AFTER */
background: radial-gradient(circle, var(--glow-color) 0%, transparent 68%);

/* #phase-welcome background — BEFORE (second broken image reference) */
#phase-welcome { background: #0b1928 url('./assets/login-bg.jpg') center center / cover no-repeat; gap: 16px; position: relative; }
/* AFTER */
#phase-welcome { background: var(--lock-bg); gap: 16px; position: relative; }

/* #phase-welcome::before — BEFORE */
#phase-welcome::before { content: ''; position: absolute; inset: 0; background: rgba(11,25,40,0.38); pointer-events: none; z-index: 0; }
/* AFTER */
#phase-welcome::before { content: ''; position: absolute; inset: 0; background: var(--lock-overlay); pointer-events: none; z-index: 0; }

/* .welcome-greeting — BEFORE */
color: #f0f4f9;
/* AFTER */
color: var(--text-primary);

/* .welcome-role — BEFORE */
color: #c3ccd6; border: 1px solid rgba(195,204,214,0.35);
/* AFTER */
color: var(--silver-400); border: 1px solid var(--border-visible);
```

- [ ] **Step 6: Verify no hex literals remain outside the :root block**

```bash
grep -n '#[0-9a-fA-F]\{3,6\}' desktop/splash.html
```

Expected: only lines inside the `:root {}` block (the var values) plus `#phase-boot { background: #000; ... }` (intentional). Any other result is a missed substitution — fix before committing.

- [ ] **Step 7: Commit**

```bash
git add desktop/splash.html
git commit -m "fix(desktop): replace missing login-bg.jpg with CSS gradient; migrate all hex to local CSS vars in splash.html"
```

---

### Task 3: Retheme kioskEscape.html — RMPG branding + CSS vars

**Files:**
- Modify: `desktop/kioskEscape.html`

**Interfaces:**
- Consumes: nothing external
- Produces: a branded emergency exit dialog with bottom-border inputs, Shield header, and Blue & Silver colors
- `window.kioskEscape.attempt(username, password)` IPC call is preserved exactly

- [ ] **Step 1: Replace the entire file**

The original is 45 lines. Replace it with:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
  <title>Rocky Mountain Protective Group — Emergency Access</title>
  <style>
    :root {
      --s-base:         #0d1722;
      --silver-400:     #cfd8e2;
      --text-primary:   #f0f4f9;
      --text-secondary: #a8bccf;
      --text-muted:     #8fa3b8;
      --text-hint:      #3e5e7e;
      --sev-critical:   #ef4444;
      --border-visible: rgba(207, 216, 226, 0.35);
    }

    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 100vw; height: 100vh; overflow: hidden;
      background: var(--s-base); color: var(--text-primary);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px; -webkit-font-smoothing: antialiased;
      display: flex; align-items: center; justify-content: center;
      user-select: none;
    }

    .dialog { width: 320px; display: flex; flex-direction: column; gap: 16px; }

    .header { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
    .header svg { flex-shrink: 0; }
    .header-text { display: flex; flex-direction: column; gap: 2px; }
    .brand { font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--silver-400); font-weight: 700; }
    .title { font-size: 12px; color: var(--text-secondary); }

    .field { display: flex; flex-direction: column; gap: 4px; }
    .field label { font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); }
    .field input {
      background: transparent; border: none; outline: none;
      border-bottom: 1px solid var(--border-visible);
      color: var(--text-primary); font-size: 13px; font-family: inherit;
      padding: 6px 0; width: 100%; transition: border-color 0.15s;
    }
    .field input:focus { border-bottom-color: var(--silver-400); }
    .field input::placeholder { color: var(--text-hint); }

    #error { font-size: 11px; color: var(--sev-critical); min-height: 16px; }

    button#submit {
      width: 100%; padding: 9px 0; font-size: 11px; font-weight: 700;
      letter-spacing: 0.06em; text-transform: uppercase;
      background: var(--silver-400); color: var(--s-base);
      border: none; border-radius: 2px; cursor: pointer;
      transition: opacity 0.15s;
    }
    button#submit:hover { opacity: 0.88; }
    button#submit:disabled { opacity: 0.45; cursor: not-allowed; }
  </style>
</head>
<body>
  <div class="dialog">
    <div class="header">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color: var(--silver-400)">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      </svg>
      <div class="header-text">
        <span class="brand">Rocky Mountain Protective Group</span>
        <span class="title">Emergency Access — Kiosk Mode Exit</span>
      </div>
    </div>

    <div class="field">
      <label for="username">Username</label>
      <input id="username" type="text" placeholder="Enter username" autocomplete="username" />
    </div>
    <div class="field">
      <label for="password">Password</label>
      <input id="password" type="password" placeholder="Admin or manager password" autocomplete="current-password" />
    </div>

    <div id="error"></div>

    <button id="submit">Exit Kiosk Mode</button>
  </div>

  <script>
    'use strict';
    const submitEl = document.getElementById('submit');
    submitEl.addEventListener('click', async () => {
      const username = document.getElementById('username').value;
      const password = document.getElementById('password').value;
      const errorEl = document.getElementById('error');
      errorEl.textContent = '';
      submitEl.disabled = true;
      try {
        // ipcRenderer.invoke REJECTS when the main-process handler throws —
        // which is exactly what the IPC sender guard does for an untrusted
        // frame. Without this catch the rejection was swallowed by the async
        // listener and the operator saw the button do nothing at all, on a
        // machine with no other way out. Always surface something.
        const result = await window.kioskEscape.attempt(username, password);
        if (!result || !result.ok) {
          errorEl.textContent = (result && result.error) || 'Unexpected response from the app.';
        }
      } catch (err) {
        errorEl.textContent = `Could not reach the app: ${err && err.message ? err.message : String(err)}`;
      } finally {
        submitEl.disabled = false;
      }
    });

    document.getElementById('password').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') submitEl.click();
    });
  </script>
</body>
</html>
```

- [ ] **Step 2: Verify no hex literals remain outside the :root block**

```bash
grep -n '#[0-9a-fA-F]\{3,6\}' desktop/kioskEscape.html
```

Expected: only lines inside the `:root {}` block.

- [ ] **Step 3: Commit**

```bash
git add desktop/kioskEscape.html
git commit -m "fix(desktop): retheme kioskEscape.html — RMPG shield header, bottom-border inputs, Blue & Silver CSS vars"
```

---

### Task 4: FlexOSStatusBar.tsx — 5 rgba values

**Files:**
- Modify: `client/src/components/desktop/FlexOSStatusBar.tsx`

**Interfaces:**
- Consumes: `--surface-overlay-rgb`, `--accent-silver-400-rgb` (verified in Task 1)

- [ ] **Step 1: Apply the 5 replacements**

Open `client/src/components/desktop/FlexOSStatusBar.tsx` and make these exact substitutions:

```ts
// Line ~45 — inside Metric component, borderRight
// BEFORE
borderRight: '1px solid rgba(195,204,214,0.08)',
// AFTER (two occurrences — the Metric component div and the brand chip div)
borderRight: '1px solid rgba(var(--accent-silver-400-rgb),0.08)',

// Line ~116 — main status bar div, background
// BEFORE
background: 'rgba(15,32,53,0.82)',
// AFTER
background: 'rgba(var(--surface-overlay-rgb),0.82)',

// Line ~118 — borderTop
// BEFORE
borderTop: taskbarPos === 'top' ? 'none' : '1px solid rgba(195,204,214,0.06)',
// AFTER
borderTop: taskbarPos === 'top' ? 'none' : '1px solid rgba(var(--accent-silver-400-rgb),0.06)',

// Line ~119 — borderBottom
// BEFORE
borderBottom: taskbarPos === 'top' ? '1px solid rgba(195,204,214,0.06)' : 'none',
// AFTER
borderBottom: taskbarPos === 'top' ? '1px solid rgba(var(--accent-silver-400-rgb),0.06)' : 'none',
```

Note: `borderRight: '1px solid rgba(195,204,214,0.08)'` appears twice — once in the `Metric` function's return (line ~45) and once in the brand chip div (line ~133). Replace both.

- [ ] **Step 2: Typecheck and test**

```bash
cd client && npx tsc --noEmit 2>&1 | tail -5
```
Expected: 0 errors.

```bash
cd client && npx vitest run 2>&1 | tail -8
```
Expected: 0 failures.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/desktop/FlexOSStatusBar.tsx
git commit -m "fix(desktop): migrate FlexOSStatusBar rgba literals to CSS var pattern"
```

---

### Task 5: DesktopLockScreen.tsx — ~20 rgba values

**Files:**
- Modify: `client/src/components/desktop/DesktopLockScreen.tsx`

**Interfaces:**
- Consumes: `--accent-silver-400-rgb`, `--rmpg-700-rgb`, `--rmpg-800-rgb`, `--rmpg-500-rgb`, `--surface-sunken-rgb` (verified Task 1)
- Preserves: `AVATAR_PALETTE` array at line ~48 — do not touch
- Preserves: `rgba(0 0 0 / 0.2)` on the agency header div at line ~241

- [ ] **Step 1: Grid texture**

```ts
// Line ~237 — backgroundImage in grid texture div
// BEFORE
backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(195,204,214,0.04) 1px, transparent 0)',
// AFTER
backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(var(--accent-silver-400-rgb),0.04) 1px, transparent 0)',
```

- [ ] **Step 2: Clock**

```ts
// Line ~252 — clock time div
// BEFORE
color: 'rgba(240,244,249,0.95)',
// AFTER
color: 'var(--text-primary)',

// Line ~255 — clock date div
// BEFORE
color: 'rgba(141,160,179,0.8)',
// AFTER
color: 'var(--text-secondary)',
```

- [ ] **Step 3: User picker section**

```ts
// Picker card button background (default state)
// BEFORE
background: 'rgba(34,64,95,0.4)',
// AFTER
background: 'rgba(var(--rmpg-800-rgb),0.4)',

// Picker card button border
// BEFORE
border: '1px solid rgba(195,204,214,0.12)',
// AFTER
border: '1px solid rgba(var(--accent-silver-400-rgb),0.12)',

// Picker card onMouseEnter handler (hover state)
// BEFORE
e.currentTarget.style.background = 'rgba(34,64,95,0.7)'
// AFTER
e.currentTarget.style.background = 'rgba(var(--rmpg-800-rgb),0.7)'

// Picker card onMouseLeave handler (restore default)
// BEFORE
e.currentTarget.style.background = 'rgba(34,64,95,0.4)'
// AFTER
e.currentTarget.style.background = 'rgba(var(--rmpg-800-rgb),0.4)'

// Avatar div border inside picker
// BEFORE
border: '2px solid rgba(195,204,214,0.25)',
// AFTER
border: '2px solid rgba(var(--accent-silver-400-rgb),0.25)',

// User first+last name in picker
// BEFORE
color: 'rgba(240,244,249,0.9)',
// AFTER
color: 'var(--text-primary)',

// Badge number in picker
// BEFORE
color: 'rgba(141,160,179,0.8)',
// AFTER
color: 'var(--text-secondary)',

// Role label in picker
// BEFORE
color: 'rgba(141,160,179,0.55)',
// AFTER
color: 'var(--text-muted)',

// Loading spinner text
// BEFORE
color: 'rgba(141,160,179,0.7)',
// AFTER
color: 'var(--text-muted)',

// No-users-found text
// BEFORE
color: 'rgba(141,160,179,0.6)',
// AFTER
color: 'var(--text-muted)',
```

- [ ] **Step 4: Credential card section**

```ts
// Card container background
// BEFORE
background: 'rgba(34, 64, 95, 0.55)',
// AFTER
background: 'rgba(var(--rmpg-800-rgb),0.55)',

// Card container border
// BEFORE
border: '1px solid rgba(195, 204, 214, 0.15)',
// AFTER
border: '1px solid rgba(var(--accent-silver-400-rgb),0.15)',

// Avatar circle border inside card
// BEFORE
border: '2px solid rgba(195, 204, 214, 0.3)',
// AFTER
border: '2px solid rgba(var(--accent-silver-400-rgb),0.3)',

// Officer name in card (and PIN text color — same value used twice)
// BEFORE
color: 'rgba(240,244,249,0.95)',
// AFTER
color: 'var(--text-primary)',

// Badge in card
// BEFORE
color: 'rgba(141,160,179,0.8)',
// AFTER
color: 'var(--text-secondary)',

// Mode switcher container border
// BEFORE
border: '1px solid rgba(195,204,214,0.2)',
// AFTER
border: '1px solid rgba(var(--accent-silver-400-rgb),0.2)',

// Active mode tab background in mode switcher
// BEFORE
background: mode === m ? 'rgba(62,116,168,0.25)' : 'transparent',
// AFTER
background: mode === m ? 'rgba(var(--rmpg-700-rgb),0.25)' : 'transparent',

// Active mode tab text color in mode switcher
// BEFORE
color: mode === m ? 'rgba(240,244,249,0.95)' : 'rgba(141,160,179,0.8)',
// AFTER
color: mode === m ? 'var(--text-primary)' : 'var(--text-secondary)',

// Password and PIN input background (same value used in both input blocks)
// BEFORE
background: 'rgba(10, 20, 40, 0.5)',
// AFTER
background: 'rgba(var(--surface-sunken-rgb),0.5)',

// Password/PIN input border (non-error variant — appears in both input blocks)
// BEFORE
border: error ? '1px solid var(--sev-critical)' : '1px solid rgba(195,204,214,0.2)',
// AFTER
border: error ? '1px solid var(--sev-critical)' : '1px solid rgba(var(--accent-silver-400-rgb),0.2)',

// Unlock button background
// BEFORE
background: 'rgba(45, 90, 135, 0.7)',
// AFTER
background: 'rgba(var(--rmpg-700-rgb),0.7)',

// Unlock button border
// BEFORE
border: '1px solid rgba(195,204,214,0.25)',
// AFTER
border: '1px solid rgba(var(--accent-silver-400-rgb),0.25)',

// Switch user link text
// BEFORE
color: 'rgba(141,160,179,0.7)',
// AFTER
color: 'var(--text-muted)',

// Footer text
// BEFORE
color: 'rgba(195,204,214,0.2)',
// AFTER
color: 'rgba(var(--accent-silver-400-rgb),0.2)',
```

- [ ] **Step 5: Typecheck and test**

```bash
cd client && npx tsc --noEmit 2>&1 | tail -5
```
Expected: 0 errors.

```bash
cd client && npx vitest run 2>&1 | tail -8
```
Expected: 0 failures.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/desktop/DesktopLockScreen.tsx
git commit -m "fix(desktop): migrate DesktopLockScreen rgba literals to CSS var pattern"
```

---

### Task 6: DesktopScreenSaver + DesktopSystemTray + DesktopQuickSettings

**Files:**
- Modify: `client/src/components/desktop/DesktopScreenSaver.tsx`
- Modify: `client/src/components/desktop/DesktopSystemTray.tsx`
- Modify: `client/src/components/desktop/DesktopQuickSettings.tsx`

**Interfaces:**
- Consumes: `--accent-silver-400-rgb`, `--sev-ok-rgb`, `--sev-critical-rgb` (verified Task 1)
- Preserves: `background: '#000'` on the root screensaver div (line ~98 in DesktopScreenSaver)

- [ ] **Step 1: DesktopScreenSaver.tsx — drifting content colors**

```ts
// Shield icon and org span inside the drifting block (~line 117-118)
// Both share the same color value — replace both occurrences:
// BEFORE
color: 'rgba(195,204,214,0.4)'
// AFTER
color: 'rgba(var(--accent-silver-400-rgb),0.4)'

// Clock time (~line 123)
// BEFORE
color: 'rgba(240,244,249,0.85)'
// AFTER
color: 'var(--text-primary)'

// Clock date (~line 126)
// BEFORE
color: 'rgba(195,204,214,0.5)'
// AFTER
color: 'var(--text-muted)'

// StatPill icon/label color conditional (~line 162)
// BEFORE
color: critical ? 'rgba(239,68,68,0.7)' : 'rgba(195,204,214,0.4)'
// AFTER
color: critical ? 'rgba(var(--sev-critical-rgb),0.7)' : 'rgba(var(--accent-silver-400-rgb),0.4)'

// StatPill value color conditional (~line 166)
// BEFORE
color: critical ? 'rgba(239,68,68,0.8)' : 'rgba(240,244,249,0.5)'
// AFTER
color: critical ? 'rgba(var(--sev-critical-rgb),0.8)' : 'rgba(var(--accent-silver-400-rgb),0.5)'
```

- [ ] **Step 2: DesktopSystemTray.tsx — on-duty badge colors**

```ts
// Line ~391 — on-duty badge background (part of a ternary expression)
// BEFORE
background: onDuty ? 'rgba(34,197,94,0.15)' : 'rgba(var(--rmpg-500-rgb, 62 116 168), 0.12)',
// AFTER
background: onDuty ? 'rgba(var(--sev-ok-rgb),0.15)' : 'rgba(var(--rmpg-500-rgb, 62 116 168), 0.12)',

// Line ~393 — on-duty badge border (inside a template literal)
// BEFORE
border: `1px solid ${onDuty ? 'rgba(34,197,94,0.3)' : 'var(--border-subtle)'}`,
// AFTER
border: `1px solid ${onDuty ? 'rgba(var(--sev-ok-rgb),0.3)' : 'var(--border-subtle)'}`,
```

- [ ] **Step 3: DesktopQuickSettings.tsx — toggle thumb background**

```ts
// Line ~57 — night-light toggle thumb <span>
// BEFORE
background: '#fff'
// AFTER
background: 'var(--text-primary)'

// Line ~75 — DND toggle thumb <span>
// BEFORE
background: '#fff'
// AFTER
background: 'var(--text-primary)'
```

- [ ] **Step 4: Typecheck and test**

```bash
cd client && npx tsc --noEmit 2>&1 | tail -5
```
Expected: 0 errors.

```bash
cd client && npx vitest run 2>&1 | tail -8
```
Expected: 0 failures.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/desktop/DesktopScreenSaver.tsx \
        client/src/components/desktop/DesktopSystemTray.tsx \
        client/src/components/desktop/DesktopQuickSettings.tsx
git commit -m "fix(desktop): migrate DesktopScreenSaver, SystemTray, QuickSettings rgba literals to CSS var pattern"
```

---

### Task 7: Final verification and PR

**Files:** none modified

- [ ] **Step 1: Confirm no raw rgba literals remain in the 5 React components**

```bash
grep -rn "rgba([0-9]" \
  client/src/components/desktop/FlexOSStatusBar.tsx \
  client/src/components/desktop/DesktopLockScreen.tsx \
  client/src/components/desktop/DesktopScreenSaver.tsx \
  client/src/components/desktop/DesktopSystemTray.tsx \
  client/src/components/desktop/DesktopQuickSettings.tsx
```

Expected: zero results. Any `rgba(var(...)` is correct; a bare `rgba(N,N,N,...)` is a missed substitution.

- [ ] **Step 2: Confirm hex literals in HTML files are only inside :root blocks**

```bash
grep -n '#[0-9a-fA-F]\{3,6\}' desktop/splash.html desktop/kioskEscape.html
```

Allowed results in `splash.html`:
- Lines inside the `:root { }` block (the var values themselves)
- The line containing `#phase-boot { background: #000;` (boot phase, intentional)

Allowed results in `kioskEscape.html`:
- Lines inside the `:root { }` block only

Any other hex on any other line is a missed substitution.

- [ ] **Step 3: Full client suite**

```bash
cd client && npx vitest run 2>&1 | tail -10
```
Expected: 0 failures.

```bash
cd client && npx tsc --noEmit 2>&1 | tail -5
```
Expected: 0 errors.

- [ ] **Step 4: Open PR**

```bash
git push origin HEAD
gh pr create -R rmpgutah/rmpg-flex \
  --title "fix(desktop): system UI hex sweep — CSS vars + login bg fix + kiosk retheme" \
  --body "$(cat <<'EOF'
## Summary

- **Functional fix**: replaces broken \`./assets/login-bg.jpg\` references in \`splash.html\` (lock + welcome phases) with a CSS gradient — no external asset required
- **kioskEscape.html**: full retheme — RMPG shield header, \"Rocky Mountain Protective Group — Emergency Access\" title, bottom-border inputs matching the lock screen style, silver/navy branded button
- **splash.html**: local \`:root {}\` CSS var block mirroring Blue & Silver palette; all 24 hardcoded hex/rgba values migrated
- **5 React components**: all hardcoded \`rgba(R,G,B,α)\` literals migrated to \`rgba(var(--token-rgb),α)\` pattern — \`FlexOSStatusBar\` (5), \`DesktopLockScreen\` (~20), \`DesktopScreenSaver\` (5), \`DesktopSystemTray\` (2), \`DesktopQuickSettings\` (2)

## Intentionally preserved (not migrated)

- \`AVATAR_PALETTE\` in \`DesktopLockScreen\` — deterministic hash per username, not theme chrome
- \`background: #000\` screensaver root — anti-screen-burn, tactical context
- \`background: #000\` boot phase in \`splash.html\` — intentional OS boot aesthetic
- \`rgba(0 0 0 / 0.2)\` agency header overlay in \`DesktopLockScreen\` — pure-black semi-transparent, intentional

## Test plan

- [ ] All client vitest tests pass
- [ ] Client typecheck clean
- [ ] Electron app: boot → lock phase shows gradient background (not broken image)
- [ ] Electron app: welcome phase shows same gradient
- [ ] Electron app: kiosk escape dialog shows RMPG branding and bottom-border inputs
- [ ] Screensaver: drifting content colors match Blue & Silver palette

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
