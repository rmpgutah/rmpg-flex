# Desktop System UI — Fix & Upgrade Design

**Date:** 2026-08-14  
**Scope:** All 7 desktop shell UI files. Fixes one functional bug (missing background image)
and migrates all hardcoded hex/rgba values to CSS variables across both standalone HTML
screens and the five React FlexOS components.

---

## Problem

The FlexOS desktop shell spans two rendering contexts:

| Context | Files | Theme access |
|---|---|---|
| Standalone Electron HTML | `desktop/splash.html`, `desktop/kioskEscape.html` | None — Vite/Tailwind not available |
| React component tree | Five `client/src/components/desktop/*.tsx` | Full CSS var system |

Both contexts currently contain hardcoded hex/rgba values that don't respond to theme
changes. Additionally, `splash.html` references `./assets/login-bg.jpg` which does not
exist in `desktop/assets/` (only `logo.png` is present), causing the lock/welcome phases
to show a broken background on every boot.

---

## Goals

1. Fix the missing background image — replace with a CSS gradient that requires no asset.
2. Migrate all hardcoded color literals to CSS variables in all 7 files.
3. No functional changes to auth flow, IPC calls, or component behaviour.
4. No new external dependencies.

---

## Design

### 1. Standalone HTML files — local CSS var pattern

Standalone HTML files cannot consume `theme-palettes.css` (no Vite pipeline). The
solution is a `:root {}` block at the top of each file's `<style>` tag containing named
local variables whose values mirror the Blue & Silver palette. Components in the file
then reference these vars instead of raw hex.

This approach keeps the palette synchronized with the main app because both files use
the same hex values — the only difference is where they live.

**Local var block (both HTML files share this shape):**

```css
:root {
  --s-base:       #0d1722;   /* --surface-base */
  --s-raised:     #15212e;   /* --surface-raised */
  --s-sunken:     #0a1018;   /* --surface-sunken */
  --s-overlay:    #142840;   /* --surface-overlay */
  --silver-300:   #e3e9f0;
  --silver-400:   #cfd8e2;
  --text-primary: #f0f4f9;
  --text-secondary:#a8bccf;
  --text-muted:   #8fa3b8;
  --text-dim:     #6a8ba8;
  --text-hint:    #3e5e7e;
  --sev-critical: #ef4444;
  --sev-ok:       #22c55e;
  --lock-bg:      linear-gradient(135deg, #142840 0%, #0d1722 60%, #0a1018 100%);
  --lock-overlay: rgba(10, 18, 32, 0.35);
  --glow-color:   rgba(207, 216, 226, 0.18);
  --border-subtle:  rgba(207, 216, 226, 0.08);
  --border-moderate:rgba(207, 216, 226, 0.25);
  --border-visible: rgba(207, 216, 226, 0.35);
  --avatar-bg:    #2d4f6e;
}
```

### 2. splash.html — changes

**Background fix (functional):**  
Lines 40 and 97 reference `./assets/login-bg.jpg`. Replace with `var(--lock-bg)` (a deep
navy linear gradient). No asset required. The visual intent (dark layered background) is
preserved.

**Boot phase `background: #000` (line 22) — keep.** The pure-black boot screen is
intentional (matches the Windows POST experience before the OS logo appears).

**Hex replacements (after local var block is added):**

| Original | Replacement var |
|---|---|
| `rgba(195,204,214,0.18)` drop-shadow | `var(--glow-color)` |
| `#c3ccd6` (spinner dots) | `var(--silver-400)` |
| `#8fa3b8` (org-label) | `var(--text-muted)` |
| `#0b1928 url(...)` (lock/welcome bg) | `var(--lock-bg)` |
| `rgba(11,25,40,0.38)` (dim overlay ×2) | `var(--lock-overlay)` |
| `#fff` (lock-time) | `var(--text-primary)` |
| `#a8bccf` (lock-date) | `var(--text-secondary)` |
| `#2d4f6e` (avatar bg) | `var(--avatar-bg)` |
| `#c3ccd6` (avatar text) | `var(--silver-400)` |
| `rgba(195,204,214,0.25)` (avatar border) | `var(--border-moderate)` |
| `#f0f4f9` (user-display-name) | `var(--text-primary)` |
| `#6a8ba8` (user-sub) | `var(--text-dim)` |
| `rgba(195,204,214,0.35)` (pw-wrap border) | `var(--border-visible)` |
| `#c3ccd6` (pw-wrap:focus border-color) | `var(--silver-400)` |
| `#f0f4f9` (pw-input) | `var(--text-primary)` |
| `#3e5e7e` (placeholder) | `var(--text-hint)` |
| `#8fa3b8` (pw-eye/submit) | `var(--text-muted)` |
| `#f0f4f9` (pw-eye:hover) | `var(--text-primary)` |
| `#ef4444` (lock-error) | `var(--sev-critical)` |
| `#2e4a60` (lock-hint) | `var(--text-hint)` |
| `rgba(195,204,214,0.18)` (lockPulse glow) | `var(--glow-color)` |
| `#f0f4f9` (welcome-greeting) | `var(--text-primary)` |
| `#c3ccd6` (welcome-role) | `var(--silver-400)` |
| `rgba(195,204,214,0.35)` (welcome-role border) | `var(--border-visible)` |

The `#phase-lock::before` dual-rule pattern (dim overlay + watermark logo) is
intentional and is preserved exactly as-is. Only color values change.

### 3. kioskEscape.html — full retheme

**Visual upgrades:**
- Add Shield SVG + "Rocky Mountain Protective Group — Emergency Access" header above the form.
- Inputs: remove full border; use bottom-border only (matches splash.html lock screen style).
- Button: silver background (`var(--silver-400)`) with navy text (`var(--s-base)`).
- Error text: `var(--sev-critical)`.
- 2 px border-radius on all interactive elements (global rule).

**Hex replacements (same local var block as splash.html):**

| Original | Replacement |
|---|---|
| `background: #0c1a2b` (body) | `var(--s-base)` |
| `color: #eef2f7` (body) | `var(--text-primary)` |
| `background: #16283d` (input) | `transparent` (bottom-border style) |
| `border: 1px solid #3a4d63` (input) | `border-bottom: 1px solid var(--border-visible)` |
| `color: #eef2f7` (input) | `var(--text-primary)` |
| `background: #b7c2cf` (button) | `var(--silver-400)` |
| `color: #0c1a2b` (button text) | `var(--s-base)` |
| `color: #f87171` (error) | `var(--sev-critical)` |

### 4. FlexOSStatusBar.tsx — 5 values

All five raw rgba values in the file use the `rgba(R,G,B,α)` pattern. Convert using
`rgba(var(--token-rgb),α)`:

| Line | Original | Replacement |
|---|---|---|
| 45 | `rgba(195,204,214,0.08)` (metric borders) | `rgba(var(--accent-silver-400-rgb),0.08)` |
| 116 | `rgba(15,32,53,0.82)` (bar background) | `rgba(var(--surface-overlay-rgb),0.82)` |
| 118 | `rgba(195,204,214,0.06)` (top border) | `rgba(var(--accent-silver-400-rgb),0.06)` |
| 119 | `rgba(195,204,214,0.06)` (bottom border) | `rgba(var(--accent-silver-400-rgb),0.06)` |
| 133 | `rgba(195,204,214,0.08)` (brand chip border) | `rgba(var(--accent-silver-400-rgb),0.08)` |

### 5. DesktopLockScreen.tsx — ~20 values

**Do NOT change:** `AVATAR_PALETTE` (hardcoded by design — deterministic hash per
username, not theme chrome).

**Do NOT change:** `rgba(0 0 0 / 0.2)` on the agency header background (line 241) —
intentionally pure-black semi-transparent dark-on-dark overlay, not a themed surface.

**Conversions:**

| Original | Replacement | Notes |
|---|---|---|
| `rgba(195,204,214,0.04)` grid texture | `rgba(var(--accent-silver-400-rgb),0.04)` | |
| `rgba(240,244,249,0.95)` clock time | `var(--text-primary)` | ≥0.9 → full var |
| `rgba(141,160,179,0.8)` clock date | `var(--text-secondary)` | ≥0.75 → full var |
| `rgba(34,64,95,0.4)` picker card bg | `rgba(var(--rmpg-700-rgb,34 64 95),0.4)` | with fallback |
| `rgba(195,204,214,0.12)` picker card border | `rgba(var(--accent-silver-400-rgb),0.12)` | |
| `rgba(34,64,95,0.7)` picker hover bg | `rgba(var(--rmpg-700-rgb,34 64 95),0.7)` | |
| `rgba(195,204,214,0.25)` avatar border | `rgba(var(--accent-silver-400-rgb),0.25)` | |
| `rgba(240,244,249,0.9)` name/pin text | `var(--text-primary)` | |
| `rgba(141,160,179,0.8)` badge/role | `var(--text-secondary)` | |
| `rgba(141,160,179,0.55)` small role text | `var(--text-muted)` | |
| `rgba(34, 64, 95, 0.55)` credential card bg | `rgba(var(--rmpg-700-rgb,34 64 95),0.55)` | |
| `rgba(195, 204, 214, 0.15)` card border | `rgba(var(--accent-silver-400-rgb),0.15)` | |
| `rgba(195, 204, 214, 0.3)` card avatar border | `rgba(var(--accent-silver-400-rgb),0.3)` | |
| `rgba(195,204,214,0.2)` mode switcher / input border | `rgba(var(--accent-silver-400-rgb),0.2)` | |
| `rgba(62,116,168,0.25)` active mode tab | `rgba(var(--rmpg-500-rgb,62 116 168),0.25)` | |
| `rgba(10, 20, 40, 0.5)` input bg | `rgba(var(--surface-sunken-rgb,10 20 40),0.5)` | |
| `rgba(45, 90, 135, 0.7)` unlock button bg | `rgba(var(--rmpg-500-rgb,45 90 135),0.7)` | |
| `rgba(195,204,214,0.25)` button border | `rgba(var(--accent-silver-400-rgb),0.25)` | |
| `rgba(141,160,179,0.7)` switch-user text | `var(--text-muted)` | |
| `rgba(195,204,214,0.2)` footer text | `rgba(var(--accent-silver-400-rgb),0.2)` | |
| `rgba(141,160,179,0.6)` no-users text | `var(--text-muted)` | |

**RGB var availability check (required during implementation):**  
Run `grep -n 'rmpg-700-rgb\|rmpg-500-rgb\|surface-sunken-rgb\|accent-silver-400-rgb\|sev-ok-rgb\|sev-critical-rgb' client/src/styles/theme-palettes.css` before implementation. Any missing rgb triples must be added to **all four theme blocks** in `theme-palettes.css`. Likely additions:
- `--surface-sunken-rgb: 10 16 24` (if missing)
- `--sev-ok-rgb: 34 197 94` (if missing)
- `--sev-critical-rgb: 239 68 68` (if missing)

### 6. DesktopScreenSaver.tsx — keep `#000` background

The screensaver background `background: '#000'` (line 98) is intentional and correct —
pure-black reduces screen burn risk, matching the tactical surface rationale in CLAUDE.md.
Do not replace it.

Convert the drifting content colors only:

| Original | Replacement |
|---|---|
| `color: 'rgba(195,204,214,0.4)'` (shield, org text) | `rgba(var(--accent-silver-400-rgb),0.4)` |
| `color: 'rgba(240,244,249,0.85)'` (clock) | `var(--text-primary)` |
| `color: 'rgba(195,204,214,0.5)'` (date) | `var(--text-muted)` |
| `color: critical ? 'rgba(239,68,68,0.7)' : 'rgba(195,204,214,0.4)'` (stat icon) | `rgba(var(--sev-critical-rgb),0.7)` / `rgba(var(--accent-silver-400-rgb),0.4)` |
| `color: critical ? 'rgba(239,68,68,0.8)' : 'rgba(240,244,249,0.5)'` (stat value) | `rgba(var(--sev-critical-rgb),0.8)` / `rgba(var(--accent-silver-400-rgb),0.5)` |

### 7. DesktopSystemTray.tsx — 2 values

| Line | Original | Replacement |
|---|---|---|
| 391 | `rgba(34,197,94,0.15)` (on-duty badge bg) | `rgba(var(--sev-ok-rgb),0.15)` |
| 393 | `rgba(34,197,94,0.3)` (on-duty badge border) | `rgba(var(--sev-ok-rgb),0.3)` |

### 8. DesktopQuickSettings.tsx — 2 values

| Line | Original | Replacement |
|---|---|---|
| 57 | `background: '#fff'` (night-light toggle thumb) | `var(--text-primary)` |
| 75 | `background: '#fff'` (DND toggle thumb) | `var(--text-primary)` |

---

## Out of scope

- `FlexOSBootSplash.tsx` — already fully CSS-var compliant, no changes needed.
- `DesktopTaskbar.tsx`, `DesktopPage.tsx`, `FlexOSPowerMenu.tsx` — not in scope.
- Avatar palette color values — intentionally hardcoded (deterministic hash function).
- The `rgba(0 0 0 / 0.2)` pure-black overlay in DesktopLockScreen agency header.
- Screensaver `background: '#000'` — intentional (anti-burn, tactical context).

---

## Testing checklist

- `cd client && npx vitest run` — full client suite, zero regressions
- `cd client && npx tsc --noEmit` — client typecheck clean
- Visual: open Electron app, verify boot → lock → welcome phase sequence
- Visual: trigger screensaver, confirm drifting content colors match Blue & Silver theme
- Visual: open quick settings panel, confirm toggle thumbs visible against track
- Visual: kiosk escape dialog — confirm readable, RMPG branding visible
- Grep: `grep -rn '#[0-9a-fA-F]\{3,6\}' desktop/splash.html desktop/kioskEscape.html` — no hex literals except `#000` (boot phase) and the `:root` local-var values themselves
