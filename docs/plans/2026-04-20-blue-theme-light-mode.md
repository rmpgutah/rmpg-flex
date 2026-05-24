# Blue Theme "Light Mode" Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a selectable "Light Mode" — a brighter, more blue-saturated variant of the current dark theme — toggleable via the user-menu dropdown and `Cmd/Ctrl+Shift+L`, persisted per-device via `localStorage`.

**Architecture:** CSS custom properties scoped by a `data-theme` attribute on `<html>`. A new `:root[data-theme="light"]` block overrides color vars only; component code is untouched because all components already consume `var(--surface-base)` etc. via Tailwind utilities. A small React context (`ThemeProvider`) reads/writes `localStorage` and flips the attribute. A 4-line inline script in `index.html` sets the attribute before React loads to prevent flash-of-wrong-theme.

**Tech Stack:** React 18 + TypeScript, Tailwind CSS (already wired to CSS vars), plain `localStorage`, no new dependencies.

**Design doc:** `docs/plans/2026-04-20-blue-theme-light-mode-design.md`

**Testing philosophy for this plan:** Manual verification with exact DevTools steps rather than automated tests. Reasoning: the project has Vitest + RTL installed but zero existing tests (no jsdom config, no test setup file). The logic under test is three DOM operations (read localStorage, write attribute, write localStorage) with no branching, no async, no network. Building test infrastructure for a pure-visual toggle would be disproportionate. If the `useTheme` hook later grows to handle cloud sync or system `prefers-color-scheme`, add tests then.

---

## Task 1: Extract hardcoded hex values in `.panel-beveled` and `.panel-title-bar` to CSS vars

**Rationale:** These two classes bake hex values directly, so they won't respond to the `data-theme` override. Extract to vars first (in Dark Mode — no visible change), then in Task 3 the Light Mode block can override them.

**Files:**
- Modify: `client/src/index.css` — add 4 vars in `:root` (line ~31), update `.panel-beveled` (line 615) and `.panel-title-bar` (line 632)

**Step 1: Add new CSS vars to `:root`**

In `client/src/index.css`, after line 31 (`  --border-panel: #1e3048;`), add these lines before the closing `}`:

```css
  /* Panel bevel highlight + title bar gradient — theme-aware */
  --bevel-highlight: #3a5070;
  --titlebar-gradient: linear-gradient(180deg, #1e3048 0%, #162236 50%, #1a2636 100%);
```

Note: only `--bevel-highlight` and `--titlebar-gradient` are new. The bevel's shadow and border colors reuse the existing `--surface-sunken` and `--border-strong` tokens directly at the call site (they'd otherwise duplicate the same values in both modes — the `.panel-inset` selector already uses this pattern elsewhere in the file).

**Step 2: Update `.panel-beveled` to use vars**

Replace lines 615-621 (the current `.panel-beveled` block) with:

```css
  .panel-beveled {
    border: 1px solid var(--border-strong);
    border-top-color: var(--bevel-highlight);
    border-left-color: var(--bevel-highlight);
    border-bottom-color: var(--surface-sunken);
    border-right-color: var(--surface-sunken);
  }
```

**Step 3: Update `.panel-title-bar` background + border lines to use vars**

Find the `.panel-title-bar` declaration around line 632-642. Replace three lines:

Before:
```css
background: linear-gradient(180deg, #1e3048 0%, #162236 50%, #1a2636 100%);
border-bottom: 1px solid #0d1520;
border-top: 1px solid #2a3e58;
```

After:
```css
background: var(--titlebar-gradient);
border-bottom: 1px solid var(--surface-sunken);
border-top: 1px solid var(--border-strong);
```

(The two border colors get themed "for free" via the existing `--surface-sunken` / `--border-strong` tokens — no new vars needed.)

**Step 4: Verify no visual regression**

Start dev server if not running:
```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/clever-euler/client" && npx vite --port 5173
```

Load the app at `http://localhost:5173/`, confirm the login page looks identical to before. Panels should still have their 3D beveled borders. Title bars (e.g. "SYSTEM LOGIN") should still have their gradient. If anything looks off, the var values don't match the originals — recheck.

**Step 5: Commit**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/clever-euler"
git add client/src/index.css
git commit -m "refactor(theme): extract panel bevel + title-bar hex to CSS vars

Prerequisite for [data-theme='light'] override — hex values baked
directly into class selectors don't respond to theme attribute.
Dark Mode visuals unchanged."
```

---

## Task 2: Add FOUC-prevention boot script to `index.html`

**Rationale:** If theme only applies after React mounts, first paint shows the wrong theme for ~100ms. A synchronous inline script in `<head>` reads `localStorage` and sets `data-theme` before the bundle loads.

**Files:**
- Modify: `client/index.html` — add script in `<head>` after the `<title>` tag

**Step 1: Add boot script**

In `client/index.html`, immediately after line 15 (`<title>RMPG Flex - Rocky Mountain Protective Group</title>`) and before line 16 (the Leaflet stylesheet link), add:

```html
    <script>
      // Apply theme before React loads to prevent flash-of-wrong-theme
      try {
        var t = localStorage.getItem('rmpg-theme') || 'dark';
        document.documentElement.setAttribute('data-theme', t);
      } catch (e) { /* localStorage blocked — fall through to default dark */ }
    </script>
```

**Step 2: Verify the script runs**

Reload the app at `http://localhost:5173/`. Open DevTools → Elements. Inspect the `<html>` tag. Expect: `<html lang="en" data-theme="dark">`.

If `data-theme="dark"` isn't present, the script errored — check browser console. If `dark` is there, the script is working.

**Step 3: Verify persistence path**

In DevTools → Console, run:

```javascript
localStorage.setItem('rmpg-theme', 'light');
location.reload();
```

After reload, inspect `<html>` again. Expect: `<html lang="en" data-theme="light">`. The visual appearance won't change yet (no override block exists) — we're just verifying the attribute flips. Reset:

```javascript
localStorage.setItem('rmpg-theme', 'dark');
location.reload();
```

**Step 4: Commit**

```bash
git add client/index.html
git commit -m "feat(theme): FOUC-prevention boot script for data-theme attribute

Reads localStorage synchronously before React bundle loads. Falls
through to 'dark' if storage blocked. No visual change yet — the
[data-theme='light'] override block lands in a follow-up commit."
```

---

## Task 3: Add `[data-theme="light"]` override block to `index.css`

**Rationale:** Now that vars are extracted (Task 1) and the attribute is in place (Task 2), adding the override block wires up the palette. The app still defaults to Dark Mode but Light Mode becomes visible when `data-theme="light"` is set.

**Files:**
- Modify: `client/src/index.css` — add new `:root[data-theme="light"]` block immediately after the existing `:root` block (after line 32)

**Step 1: Add the override block**

In `client/src/index.css`, after line 32 (the closing `}` of `:root`), add:

```css
/* --- Light Mode: saturated-blue theme variant ─────────────── */
:root[data-theme="light"] {
  --surface-base: #0d2a4d;
  --surface-raised: #153a6a;
  --surface-sunken: #081e3d;
  --surface-overlay: #061630;
  --surface-deep: #041022;
  --border-default: #2a5a9e;
  --border-subtle: #234d87;
  --border-strong: #3a75c2;
  --brand-blue: #2a75c2;
  --toolbar-gradient-start: #2a75c2;
  --toolbar-gradient-end: #3a8fd9;
  --grid-header-bg: #102f55;
  --grid-row-alt: #123560;
  --border-panel: #2a5a9e;
  --bevel-highlight: #4a7bbf;
  --titlebar-gradient: linear-gradient(180deg, #2a5a9e 0%, #1e4a8a 50%, #153a6a 100%);
}

/* Note: --surface-sunken / --border-strong overrides above also re-theme the
   .panel-beveled shadow/border and the .panel-title-bar borders automatically. */
```

**Step 2: Verify Light Mode renders correctly**

Reload the app. In DevTools → Console:

```javascript
localStorage.setItem('rmpg-theme', 'light');
location.reload();
```

Expected visual changes on the login page:
- Background shifts from muted navy (`#141e2b`) to saturated blue (`#0d2a4d`)
- Panel borders visibly more blue (brand-blue tinted)
- `SYSTEM LOGIN` title bar shows a brighter blue gradient
- `SIGN IN` button appears in brighter blue (`#2a75c2`)
- Gold `v5.5.0` version tag remains the same gold (unchanged per design)

Reset:

```javascript
localStorage.setItem('rmpg-theme', 'dark');
location.reload();
```

Expected: Back to current muted navy appearance.

**Step 3: Verify contrast**

Still in Light Mode, open DevTools → Lighthouse or manual contrast check: pick a piece of body text (like "AWAITING CREDENTIALS" label) and the login panel background. Expected contrast ratio ≥ 4.5:1 (WCAG AA). If it fails, adjust `--surface-base` darker or `--text-primary` brighter.

**Step 4: Commit**

```bash
git add client/src/index.css
git commit -m "feat(theme): add [data-theme='light'] saturated-blue override

Palette overrides for surfaces, borders, brand-blue, panel bevels,
and title-bar gradient. Gold, text colors, status colors, and
typography unchanged. Toggle UI lands in follow-up commits."
```

---

## Task 4: Create `useTheme` hook + `ThemeProvider` context

**Rationale:** Components need a way to read and change the theme at runtime without touching `document.documentElement` directly.

**Files:**
- Create: `client/src/hooks/useTheme.ts`

**Step 1: Create the hook file**

Create `client/src/hooks/useTheme.ts` with:

```typescript
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Theme = 'dark' | 'light';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'rmpg-theme';

function readStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Initialize from the attribute already set by the boot script in index.html
  const [theme, setThemeState] = useState<Theme>(() => {
    const attr = document.documentElement.getAttribute('data-theme');
    return attr === 'light' ? 'light' : readStoredTheme();
  });

  // Sync DOM attribute + localStorage whenever theme changes
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* storage blocked — attribute is still applied */
    }
  }, [theme]);

  // Cmd/Ctrl + Shift + L keyboard shortcut
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        setThemeState(prev => (prev === 'dark' ? 'light' : 'dark'));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const value: ThemeContextValue = {
    theme,
    setTheme: setThemeState,
    toggle: () => setThemeState(prev => (prev === 'dark' ? 'light' : 'dark')),
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within <ThemeProvider>');
  return ctx;
}
```

**Step 2: Verify it compiles**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/clever-euler/client"
npx tsc --noEmit -p tsconfig.json 2>&1 | head -20
```

Expected: no errors referencing `useTheme.ts`. If there's a TSX-specific error about the JSX in a `.ts` file, rename to `useTheme.tsx`.

**Step 3: Commit**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/clever-euler"
git add client/src/hooks/useTheme.ts
git commit -m "feat(theme): add useTheme hook + ThemeProvider context

Reads/writes localStorage, syncs <html data-theme> attribute,
registers Cmd/Ctrl+Shift+L keyboard shortcut. No UI consumes it
yet — ThemeToggle component lands in follow-up commit."
```

---

## Task 5: Wrap `<App />` in `<ThemeProvider>` in `main.tsx`

**Files:**
- Modify: `client/src/main.tsx` — add provider wrapper

**Step 1: Import and wrap**

Replace the contents of `client/src/main.tsx` with:

```typescript
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ThemeProvider } from './hooks/useTheme';
import './index.css';

// Remove the inline pre-splash once React takes over
const preSplash = document.getElementById('pre-splash');
if (preSplash) {
  preSplash.style.opacity = '0';
  setTimeout(() => preSplash.remove(), 300);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>
);
```

**Step 2: Verify shortcut works**

Reload the app. Focus the page, press `Cmd+Shift+L` (Mac) or `Ctrl+Shift+L` (Windows/Linux). Expect: theme flips immediately. Press again: flips back. Check DevTools → Application → Local Storage → `rmpg-theme` key updates accordingly.

**Step 3: Commit**

```bash
git add client/src/main.tsx
git commit -m "feat(theme): wrap App in ThemeProvider

Enables useTheme hook and Cmd/Ctrl+Shift+L shortcut across the app."
```

---

## Task 6: Create `ThemeToggle` menu-item component

**Files:**
- Create: `client/src/components/ThemeToggle.tsx`

**Step 1: Create the component**

Create `client/src/components/ThemeToggle.tsx` with:

```typescript
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';

interface Props {
  onClick?: () => void; // optional extra handler (e.g. close parent dropdown)
}

export default function ThemeToggle({ onClick }: Props) {
  const { theme, toggle } = useTheme();
  const Icon = theme === 'dark' ? Moon : Sun;
  const label = theme === 'dark' ? 'Dark Mode' : 'Light Mode';

  return (
    <button
      onClick={() => {
        toggle();
        onClick?.();
      }}
      className="menu-item w-full"
      aria-label={`Switch theme (currently ${label})`}
    >
      <span className="menu-item-icon">
        <Icon style={{ width: 12, height: 12 }} />
      </span>
      <span className="menu-item-label">{label}</span>
    </button>
  );
}
```

**Step 2: Verify it compiles**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/clever-euler/client"
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "themetoggle" || echo "clean"
```

Expected: `clean` (no errors mentioning ThemeToggle).

**Step 3: Commit**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/clever-euler"
git add client/src/components/ThemeToggle.tsx
git commit -m "feat(theme): ThemeToggle menu-item component

Renders as a standard .menu-item button. Icon + label swap based on
current theme. Closes parent dropdown on click if onClick prop passed."
```

---

## Task 7: Insert `<ThemeToggle />` in `Layout.tsx` profile dropdown

**Files:**
- Modify: `client/src/components/Layout.tsx` — add import, insert between "System Settings" and "Sign Out"

**Step 1: Add the import**

Near the top of `client/src/components/Layout.tsx` (around line 13 where `LogOut` is imported from `lucide-react`), add a new import line below the existing imports:

```typescript
import ThemeToggle from './ThemeToggle';
```

(Find the best spot — alongside other local component imports.)

**Step 2: Insert the toggle in the dropdown**

Locate the profile dropdown code around line 856-868. You'll see this structure:

```tsx
{isAdmin && (
  <button onClick={() => { setProfileDropdownOpen(false); navigate('/admin'); }} className="menu-item w-full">
    <span className="menu-item-icon"><Settings style={{ width: 12, height: 12 }} /></span>
    <span className="menu-item-label">System Settings</span>
  </button>
)}

<div className="menu-separator" />

<button onClick={() => { setProfileDropdownOpen(false); logout(); }} className="menu-item w-full">
  ...Sign Out...
</button>
```

Insert the theme toggle immediately before the `<div className="menu-separator" />`:

```tsx
<ThemeToggle onClick={() => setProfileDropdownOpen(false)} />
```

Final structure should read: System Settings (conditional) → **ThemeToggle (new)** → separator → Sign Out.

**Step 3: Visually verify**

Reload the app, log in, click the profile icon in the top-right to open the dropdown. Expect to see a new menu item showing "🌙 Dark Mode" (or "☀️ Light Mode" if you set Light). Click it — dropdown closes, theme flips. Reopen dropdown — icon + label have swapped.

**Step 4: Commit**

```bash
git add client/src/components/Layout.tsx
git commit -m "feat(theme): add ThemeToggle to profile menu dropdown

Slots between System Settings and Sign Out. Closes the dropdown on
click. Users can also use Cmd/Ctrl+Shift+L anywhere in the app."
```

---

## Task 8: Full-app visual verification pass

**Rationale:** The CSS var approach should theme everything automatically, but components with inline `style={{ background: '#...' }}` or Tailwind arbitrary values like `bg-[#141e2b]` bypass the vars. A walk-through catches these regressions.

**Files:** None modified — this is a QA pass that may generate follow-up commits.

**Step 1: Walk through key pages in Light Mode**

Set Light Mode via `Cmd+Shift+L` or `localStorage.setItem('rmpg-theme', 'light')` + reload.

For each page below, verify: (a) background is the saturated blue (`#0d2a4d`), (b) panel borders are visible, (c) text remains readable, (d) status badges (green/red/amber) still legible, (e) no hardcoded dark-navy patches look out of place.

Pages to check:
- `/login` (already verified in Task 3)
- `/dashboard`
- `/dispatch`
- `/map`
- `/personnel`
- `/hr`
- `/admin`
- `/reports`
- `/patrol`
- `/incidents`
- `/records`

**Step 2: If regressions found**

For any page with a visible "dark patch" (still showing `#141e2b` when the rest is `#0d2a4d`):

1. Open DevTools → inspect the offending element
2. If the `background` is an inline `style` attribute with a hex like `#141e2b`, convert to a className using `bg-surface-base` (or the matching semantic utility)
3. If it's a Tailwind arbitrary value like `bg-[#141e2b]`, change to `bg-surface-base`
4. Commit each fix separately with a clear message

**Step 3: Contrast spot-check**

Using Chrome DevTools → Lighthouse → Accessibility audit on one representative page in Light Mode. Expected: no new contrast failures introduced by the theme. If there are, adjust the `--text-primary` value in the Light Mode block or the offending surface to a darker value.

**Step 4: Reset to Dark Mode for the PR screenshot**

```javascript
localStorage.setItem('rmpg-theme', 'dark');
location.reload();
```

Take a screenshot of the login page in Dark Mode and Light Mode side-by-side for the PR description.

**Step 5: Commit any regression fixes**

If Step 2 generated fixes, commit them as:

```bash
git add <files>
git commit -m "fix(theme): resolve hardcoded hex bypasses found during Light Mode QA"
```

If no regressions found, skip this commit.

---

## Task 9: Update design-system memory

**Files:**
- Modify: `/Users/rmpgutah/.claude/projects/-Users-rmpgutah-RMPG-Flex/memory/design-system.md` — document the new theme architecture

**Step 1: Append a theme section**

Add to the existing `design-system.md` file, a new section:

```markdown
## Theme System (added 2026-04-20)

Two themes, selectable per-device via localStorage:

- **Dark Mode** (default) — Muted navy, `#141e2b` base, `#1a5a9e` brand blue
- **Light Mode** — Saturated blue, `#0d2a4d` base, `#2a75c2` brand blue

Theme is applied via `data-theme="dark|light"` attribute on `<html>`. A
`:root[data-theme="light"]` block in `index.css` overrides only the color
custom properties — component code is theme-agnostic because it consumes
CSS vars (`var(--surface-base)` etc.) through Tailwind utilities.

Toggle: profile menu → "Dark Mode" / "Light Mode" item, or `Cmd/Ctrl+Shift+L`.
Implementation: `client/src/hooks/useTheme.ts` + `<ThemeProvider>` in `main.tsx`.
FOUC prevention: inline boot script in `client/index.html`.

**Always use CSS vars, not hardcoded hex** — otherwise elements won't respond
to theme switches. The common violations and their fixes:

- `bg-[#141e2b]` → `bg-surface-base`
- `bg-[#0d1520]` → `bg-surface-sunken`
- `border-[#1e3048]` → `border-rmpg-700`
- `style={{ background: '#141e2b' }}` → `className="bg-surface-base"`
```

**Step 2: Commit (memory file is outside the worktree, no git add needed)**

The memory file lives outside the repo and is auto-synced by the harness. No commit required.

---

## Task 10: Final build + ship

**Step 1: Build**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/clever-euler/client"
npx vite build 2>&1 | tail -5
```

Expected: `✓ built in Xs`, no errors.

**Step 2: Type-check**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | tail -10
```

Expected: no errors.

**Step 3: Push + PR**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/clever-euler"
git push -u origin claude/clever-euler
gh pr create --title "feat(theme): add Light Mode — saturated-blue variant" --body "$(cat <<'EOF'
## Summary
- Adds a selectable "Light Mode" — saturated-blue variant of the current (now "Dark") theme
- Toggle via profile menu or `Cmd/Ctrl+Shift+L`
- Persisted per-device via localStorage, default is Dark Mode
- Zero component code changes — pure CSS variable swap

## Design doc
See `docs/plans/2026-04-20-blue-theme-light-mode-design.md`

## Test plan
- [ ] First load with no localStorage → renders Dark Mode
- [ ] Toggle via menu → flips live, persists across refresh
- [ ] Toggle via Cmd/Ctrl+Shift+L → same behavior
- [ ] Second tab inherits stored theme with no flash
- [ ] Major pages (Dashboard, Dispatch, Map, Personnel, HR, Admin) render correctly in Light Mode
- [ ] Contrast ratio ≥ 4.5:1 on Light Mode surfaces

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Summary of changes

| File | Change | Lines |
|---|---|---|
| `client/src/index.css` | Extract 4 panel-related vars, add `[data-theme="light"]` block | ~25 new |
| `client/index.html` | FOUC-prevention boot script | +6 |
| `client/src/hooks/useTheme.ts` | NEW — context + hook + shortcut | ~50 |
| `client/src/components/ThemeToggle.tsx` | NEW — menu item | ~25 |
| `client/src/main.tsx` | Wrap App in ThemeProvider | +2 |
| `client/src/components/Layout.tsx` | Insert ThemeToggle in dropdown | +3 |

Total: ~110 new/modified lines across 6 files. No backend changes. No DB changes. No Tailwind config changes. No service worker cache bump needed (CSS-only).
