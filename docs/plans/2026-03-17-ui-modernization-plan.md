# UI Modernization — Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Modernize the Spillman Flex CAD aesthetic with shadows, 4px border-radius, larger typography, circular LEDs, and smooth transitions — without changing layout structure or behavior.

**Architecture:** Pure CSS/Tailwind changes to the design system foundation (`index.css` + `tailwind.config.js`), then targeted JSX updates to Layout, MenuBar, and StatusBar components. No backend changes. No route changes. No state/logic changes.

**Tech Stack:** Tailwind CSS config, CSS custom properties, React JSX class updates

**Design doc:** `docs/plans/2026-03-17-ui-modernization-design.md`

---

### Task 1: Update Tailwind Config — Border Radius & Typography

**Files:**
- Modify: `client/tailwind.config.js:13-38`

**Step 1: Update border-radius values**

Change the `borderRadius` block (lines 13-23) from all `2px` to:

```js
borderRadius: {
  none: '0',
  sm: '2px',
  DEFAULT: '4px',
  md: '4px',
  lg: '6px',
  xl: '8px',
  '2xl': '10px',
  '3xl': '12px',
  full: '9999px',
},
```

**Step 2: Update font size tokens**

Change `fontSize` (lines 29-37):

```js
fontSize: {
  'micro':   ['10px', { lineHeight: '14px', letterSpacing: '0.04em' }],
  'label':   ['11px', { lineHeight: '16px', letterSpacing: '0.05em' }],
  'caption': ['11px', { lineHeight: '16px' }],
  'body-sm': ['12px', { lineHeight: '18px' }],
  'body':    ['13px', { lineHeight: '20px' }],
  'title':   ['15px', { lineHeight: '22px' }],
  'heading': ['18px', { lineHeight: '26px' }],
  'display': ['24px', { lineHeight: '32px' }],
},
```

**Step 3: Verify build compiles**

Run: `cd client && npx vite build --mode development 2>&1 | tail -5`
Expected: Build success, no errors

**Step 4: Commit**

```bash
git add client/tailwind.config.js
git commit -m "style: update Tailwind border-radius to 4px + bump micro/label font sizes"
```

---

### Task 2: Update CSS Variables — Surfaces & New Shadow Tokens

**Files:**
- Modify: `client/src/index.css:12-32` (`:root` block)

**Step 1: Update surface colors and add shadow/transition tokens**

Replace the `:root` block (lines 12-32) with:

```css
:root {
  --surface-base: #0f1722;
  --surface-raised: #1a2332;
  --surface-sunken: #0a1019;
  --surface-overlay: #0a1018;
  --surface-deep: #060c14;
  --border-default: #1c2d44;
  --border-subtle: #182840;
  --border-strong: #2a3e58;
  --text-primary: #e5e7eb;
  --text-secondary: #9ca3af;
  --text-muted: #6b7280;
  --brand-blue: #1a5a9e;
  --brand-gold: #d4a017;
  --toolbar-gradient-start: #1a5a9e;
  --toolbar-gradient-end: #2570b5;
  --grid-header-bg: #0f1a28;
  --grid-row-alt: #111c2a;
  --field-label-color: #d4a017;
  --border-panel: #1c2d44;

  /* Modern shadow system */
  --shadow-card: 0 1px 3px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.2);
  --shadow-card-hover: 0 4px 12px rgba(0,0,0,0.4), 0 0 0 1px rgba(26,90,158,0.15);
  --shadow-dropdown: 0 8px 24px rgba(0,0,0,0.5), 0 0 0 1px rgba(30,48,72,0.5);
  --shadow-inset: inset 0 1px 2px rgba(0,0,0,0.2);
  --transition-fast: all 0.1s ease;
  --transition-default: all 0.15s ease;
}
```

**Step 2: Update base font size**

Change line 40 (`font-size: 13px`) to:

```css
html {
  font-size: 14px;
}
```

**Step 3: Verify build compiles**

Run: `cd client && npx vite build --mode development 2>&1 | tail -5`
Expected: Build success

**Step 4: Commit**

```bash
git add client/src/index.css
git commit -m "style: update CSS variables — deeper surfaces, shadow tokens, 14px base"
```

---

### Task 3: Modernize Card & Panel Classes

**Files:**
- Modify: `client/src/index.css:416-430` (card classes), `614-630` (panel-beveled/inset)

**Step 1: Update `.card-dark` and `.card-dark-hover`**

Replace lines 416-430:

```css
  .card-dark {
    background: var(--surface-raised);
    border: 1px solid var(--border-default);
    box-shadow: var(--shadow-card);
    transition: var(--transition-default);
  }

  .card-dark-hover {
    background: var(--surface-raised);
    border: 1px solid var(--border-default);
    box-shadow: var(--shadow-card);
    @apply cursor-pointer;
    transition: var(--transition-default);
  }
  .card-dark-hover:hover {
    border-color: var(--border-strong);
    box-shadow: var(--shadow-card-hover);
    transform: translateY(-1px);
  }
```

**Step 2: Modernize `.panel-beveled` and `.panel-inset`**

Replace lines 614-629:

```css
  /* --- Modern Panel Borders (replaces beveled) --- */
  .panel-beveled {
    border: 1px solid var(--border-default);
    box-shadow: var(--shadow-card);
    transition: var(--transition-default);
  }

  .panel-inset {
    border: 1px solid var(--border-subtle);
    box-shadow: var(--shadow-inset);
  }
```

**Step 3: Commit**

```bash
git add client/src/index.css
git commit -m "style: modernize card/panel classes — shadows replace bevels"
```

---

### Task 4: Modernize Input Classes

**Files:**
- Modify: `client/src/index.css:466-522` (input-dark, select-dark, textarea-dark)

**Step 1: Update `.input-dark`**

Replace lines 467-481:

```css
  .input-dark {
    @apply w-full px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none;
    background: var(--surface-sunken);
    border: 1px solid var(--border-strong);
    box-shadow: var(--shadow-inset);
    caret-color: #3b8ad4;
    transition: var(--transition-fast);
  }
  .input-dark:focus {
    border-color: var(--brand-blue);
    box-shadow: 0 0 0 1px rgba(26, 90, 158, 0.35), var(--shadow-inset);
  }
```

**Step 2: Update `.select-dark`**

Replace lines 483-506:

```css
  .select-dark {
    @apply w-full px-3 py-1.5 text-sm text-white focus:outline-none;
    background: var(--surface-sunken);
    border: 1px solid var(--border-strong);
    box-shadow: var(--shadow-inset);
    appearance: none;
    -webkit-appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%235a6e80'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 8px center;
    padding-right: 24px;
    transition: var(--transition-fast);
  }
  .select-dark:focus {
    border-color: var(--brand-blue);
    box-shadow: 0 0 0 1px rgba(26, 90, 158, 0.35), var(--shadow-inset);
  }
  .select-dark option {
    background: var(--surface-base);
    color: #e0e0e0;
  }
```

**Step 3: Update `.textarea-dark`**

Replace lines 508-522:

```css
  .textarea-dark {
    @apply w-full px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none resize-none;
    background: var(--surface-sunken);
    border: 1px solid var(--border-strong);
    box-shadow: var(--shadow-inset);
    caret-color: #3b8ad4;
    transition: var(--transition-fast);
  }
  .textarea-dark:focus {
    border-color: var(--brand-blue);
    box-shadow: 0 0 0 1px rgba(26, 90, 158, 0.35), var(--shadow-inset);
  }
```

**Step 4: Commit**

```bash
git add client/src/index.css
git commit -m "style: modernize input classes — flat borders + inset shadows"
```

---

### Task 5: Modernize Button Classes

**Files:**
- Modify: `client/src/index.css:524-568` (btn-primary through btn-xs)

**Step 1: Update all button classes**

Replace lines 524-568:

```css
  /* --- Button Styles (Modern / Flat) --- Motorola Blue primary */
  .btn-primary {
    @apply inline-flex items-center gap-1.5 px-3 py-1.5 text-white text-xs font-bold uppercase tracking-wide focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed;
    background: #164d87;
    border: 1px solid #1a5a9e;
    box-shadow: var(--shadow-card);
    transition: var(--transition-default);
  }
  .btn-primary:hover:not(:disabled) {
    background: #1a5a9e;
    transform: translateY(-0.5px);
    box-shadow: var(--shadow-card-hover);
  }
  .btn-primary:active:not(:disabled) {
    transform: translateY(0);
    box-shadow: none;
  }

  .btn-secondary {
    @apply inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wide focus:outline-none;
    background: #1e3048;
    border: 1px solid var(--border-strong);
    color: #d0d8e0;
    box-shadow: var(--shadow-card);
    transition: var(--transition-default);
  }
  .btn-secondary:hover {
    background: #2a3e58;
    transform: translateY(-0.5px);
  }

  .btn-danger {
    @apply inline-flex items-center gap-1.5 px-3 py-1.5 text-white text-xs font-bold uppercase tracking-wide focus:outline-none;
    background: #991b1b;
    border: 1px solid #dc2626;
    box-shadow: var(--shadow-card);
    transition: var(--transition-default);
  }
  .btn-danger:hover {
    background: #dc2626;
    transform: translateY(-0.5px);
  }

  .btn-success {
    @apply inline-flex items-center gap-1.5 px-3 py-1.5 text-white text-xs font-bold uppercase tracking-wide focus:outline-none;
    background: #047857;
    border: 1px solid #059669;
    box-shadow: var(--shadow-card);
    transition: var(--transition-default);
  }
  .btn-success:hover {
    background: #059669;
    transform: translateY(-0.5px);
  }

  .btn-sm {
    @apply px-2 py-1 text-[10px];
  }

  .btn-xs {
    @apply px-1.5 py-0.5 text-[9px];
  }
```

**Step 2: Commit**

```bash
git add client/src/index.css
git commit -m "style: modernize buttons — flat borders, hover lift, transitions"
```

---

### Task 6: Modernize Table, Tab, Badge, and LED Classes

**Files:**
- Modify: `client/src/index.css:244-282` (table-dark), `656-695` (tab-bar), `301-304` (badge), `576-612` (LED)

**Step 1: Update `.table-dark` header and body**

In the `.table-dark thead th` rule (around line 256), change:
- `text-[10px]` → `text-[11px]`
- Remove the `border-right: 1px solid ...` rule

In the `.table-dark tbody td` rule (around line 278), change:
- `font-size: 11px` → `font-size: 12px`

**Step 2: Update `.tab-bar-item`**

In `.tab-bar-item` (around line 668), change:
- `font-size: 10px` → `font-size: 11px`
- Add `transition: var(--transition-default);`

In `.tab-bar-item.active` (around line 690), change to:
```css
  .tab-bar-item.active {
    color: #ffffff;
    background: var(--surface-raised);
    border-color: transparent;
    border-bottom: 2px solid var(--brand-blue);
  }
```

**Step 3: Update `.badge` base class**

In the `.badge` class (around line 302), the existing 2px radius from Tailwind will auto-update to 4px via the config change. No manual change needed.

**Step 4: Update `.led-dot` to circular**

In `.led-dot` (around line 576), change:
- `border-radius: 2px` → `border-radius: 50%`

**Step 5: Commit**

```bash
git add client/src/index.css
git commit -m "style: modernize tables, tabs, LEDs — larger text, circular LEDs, blue tab indicator"
```

---

### Task 7: Modernize Toolbar & Menu Classes

**Files:**
- Modify: `client/src/index.css:698-756` (toolbar-btn), `795-833` (menu-bar), `821-833` (menu-dropdown)

**Step 1: Update `.toolbar-btn`**

Replace the toolbar-btn block (lines 698-735):

```css
  .toolbar-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 6px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: #b0bcc8;
    background: rgba(30, 48, 72, 0.6);
    border: 1px solid rgba(42, 62, 88, 0.5);
    cursor: pointer;
    transition: var(--transition-default);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .toolbar-btn:hover {
    background: rgba(42, 62, 88, 0.8);
    color: #ffffff;
    box-shadow: 0 0 0 1px rgba(255,255,255,0.06);
  }

  .toolbar-btn:active {
    background: rgba(13, 21, 32, 0.8);
  }

  .toolbar-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
    pointer-events: none;
  }
```

**Step 2: Update `.toolbar-btn-primary`**

Replace lines 737-747:

```css
  .toolbar-btn-primary {
    background: rgba(26, 90, 158, 0.7);
    border-color: rgba(59, 138, 212, 0.5);
    color: #ffffff;
  }

  .toolbar-btn-primary:hover {
    background: rgba(59, 138, 212, 0.8);
    box-shadow: 0 0 8px rgba(26, 90, 158, 0.3);
  }
```

**Step 3: Update `.menu-dropdown` to remove beveled borders**

Replace lines 821-833:

```css
  .menu-dropdown {
    position: absolute;
    z-index: 9990;
    min-width: 220px;
    background: rgba(15, 23, 34, 0.95);
    backdrop-filter: blur(8px);
    border: 1px solid var(--border-strong);
    box-shadow: var(--shadow-dropdown);
    padding: 4px 0;
  }
```

**Step 4: Commit**

```bash
git add client/src/index.css
git commit -m "style: modernize toolbar/menu classes — flat buttons, frosted dropdowns"
```

---

### Task 8: Modernize Panel Title Bar & Status Bar CSS

**Files:**
- Modify: `client/src/index.css:631-648` (panel-title-bar), `986-999` (status-bar)

**Step 1: Update `.panel-title-bar`**

Replace lines 631-648:

```css
  .panel-title-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    background: linear-gradient(180deg, rgba(30, 48, 72, 0.5) 0%, rgba(22, 34, 54, 0.5) 100%);
    border-bottom: 1px solid var(--border-default);
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #b0bcc8;
    user-select: none;
    flex-wrap: wrap;
    min-height: 26px;
  }
```

**Step 2: Update `.status-bar`**

Replace lines 986-999:

```css
  .status-bar {
    display: flex;
    align-items: center;
    gap: 0;
    height: 22px;
    background: var(--surface-base);
    border-top: 1px solid var(--border-default);
    font-size: 10px;
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
    color: #8a9aaa;
    padding: 0 8px;
    flex-shrink: 0;
  }
```

**Step 3: Commit**

```bash
git add client/src/index.css
git commit -m "style: modernize panel title bars + status bar — softer gradients, cleaner borders"
```

---

### Task 9: Update Leaflet Map Overrides for 4px Radius

**Files:**
- Modify: `client/src/index.css:1053` and `1064`

**Step 1: Update Leaflet zoom and popup radius**

Change line 1053:
- `border-radius: 0 !important;` → `border-radius: 4px !important;`

Change line 1064:
- `border-radius: 2px !important;` → `border-radius: 4px !important;`

**Step 2: Commit**

```bash
git add client/src/index.css
git commit -m "style: update Leaflet map overrides for 4px border-radius"
```

---

### Task 10: Build Verification & Visual Check

**Step 1: Run full production build**

Run: `cd client && npx vite build 2>&1 | tail -10`
Expected: Build success, no errors

**Step 2: Start dev server and check visually**

Run: `cd /Users/rmpgutah/RMPG\ Flex/.claude/worktrees/loving-meninsky && npm run dev`
Check: Dashboard page loads, toolbar renders, status bar shows circular LEDs, cards have shadows

**Step 3: Verify mobile responsive**

Check: Mobile view (768px breakpoint) — drawer navigation, bottom nav, touch-sized buttons

**Step 4: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "style: Phase 1 UI modernization — design system + layout shell complete"
```
