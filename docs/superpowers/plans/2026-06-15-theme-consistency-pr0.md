# Theme Consistency PR 0 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the app's shared chrome (menus/dropdowns/toolbars/tables/badges) so it's legible in both day and night — fixing the visible light-mode breakage — and ship the token-reference doc + a CI hex ratchet that the page-by-page sweep PRs depend on.

**Architecture:** Swap hardcoded hex in shared chrome (CSS classes in `index.css` + shared components) for the existing day/night theme tokens from `theme-palettes.css`. Add a pure-function `--check` mode to the existing `scripts/theme-hex-audit.mjs` plus a `docs/theme-cleaned-files.txt` allowlist and a CI workflow that fails only when a cleaned file reintroduces hex. Presentation only; no API/DB.

**Tech Stack:** React + TS + Tailwind (client), CSS custom properties, a Node ESM script, vitest (root suite covers `tests/`), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-06-15-theme-consistency-pr0-design.md`

---

## File Structure

- **Modify** `scripts/theme-hex-audit.mjs` — add exported pure `findDisallowedHex(text)` + `--check` mode (reads the allowlist, exits non-zero on a cleaned-file regression). Single responsibility: hex detection + ratchet.
- **Create** `tests/themeHexAudit.test.ts` — unit test for `findDisallowedHex` (root vitest suite).
- **Create** `docs/theme-tokens.md` — the hex→token playbook for sweep PRs.
- **Create** `docs/theme-cleaned-files.txt` — ratchet allowlist (seeded with already-clean chrome files).
- **Modify** `client/src/index.css` — fix the `.menu-dropdown` / `.menu-item*` chrome block (the headline light-mode bug).
- **Modify** `client/src/components/StatsCard.tsx` — convert its 5 hardcoded hex to tokens.
- **Modify** `client/src/components/Layout.tsx` — convert the hardcoded `#888888` focus-ring hex (shared toolbar chrome) to a token.
- **Create** `.github/workflows/theme-hex-guard.yml` — runs the ratchet on PRs.
- **Modify** `client/public/sw.js` — bump `CACHE_NAME`.

**Setup note (do once before Task 1):** this is a fresh worktree. Install deps so tests/build run and the pre-commit hook passes:
```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/theme-consistency" && npm install && cd client && npm install
```

---

## Task 1: Audit script `--check` mode (TDD)

**Files:**
- Modify: `scripts/theme-hex-audit.mjs`
- Test: `tests/themeHexAudit.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/themeHexAudit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { findDisallowedHex, ALLOWED_HEX } from '../scripts/theme-hex-audit.mjs';

describe('findDisallowedHex', () => {
  it('flags raw 6-digit hex', () => {
    expect(findDisallowedHex('color: #1a2b3c; background: #ffffff')).toEqual(['#1a2b3c', '#ffffff']);
  });
  it('allows brand gold #d4a017 (case-insensitive)', () => {
    expect(findDisallowedHex('color: #d4a017')).toEqual([]);
    expect(findDisallowedHex('color: #D4A017')).toEqual([]);
  });
  it('returns empty for token-only text', () => {
    expect(findDisallowedHex('color: var(--spm-text); background: var(--surface-base)')).toEqual([]);
  });
  it('exposes brand gold in the allow-set', () => {
    expect(ALLOWED_HEX.has('#d4a017')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/theme-consistency" && npx vitest run tests/themeHexAudit.test.ts`
Expected: FAIL — `findDisallowedHex`/`ALLOWED_HEX` are not exported by the script.

- [ ] **Step 3: Rewrite the script with exported pure helpers + `--check` mode**

Replace the entire contents of `scripts/theme-hex-audit.mjs` with:

```js
#!/usr/bin/env node
// Scans client/src for raw 6-digit hex (the un-themed long tail) and provides a
// --check ratchet: fails if any file listed in docs/theme-cleaned-files.txt
// reintroduces a disallowed hex. Brand gold (#d4a017) is allowed everywhere.
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ALLOWED_HEX = new Set(['#d4a017']); // brand gold stays constant
const HEX = /#[0-9a-fA-F]{6}\b/g;

/** Pure: all disallowed raw hex in `text` (excludes ALLOWED_HEX, case-insensitive). */
export function findDisallowedHex(text) {
  const matches = text.match(HEX) || [];
  return matches.filter((h) => !ALLOWED_HEX.has(h.toLowerCase()));
}

export function listClientFiles() {
  return execSync('git ls-files client/src', { encoding: 'utf8' })
    .split('\n').filter((f) => /\.(tsx?|css)$/.test(f));
}

function readAllowlist(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n')
    .map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
}

function main() {
  const check = process.argv.includes('--check');
  let total = 0;
  const perFile = [];
  for (const f of listClientFiles()) {
    let txt; try { txt = readFileSync(f, 'utf8'); } catch { continue; }
    const n = findDisallowedHex(txt).length;
    if (n) { perFile.push([f, n]); total += n; }
  }
  perFile.sort((a, b) => b[1] - a[1]);
  console.log(`Raw disallowed hex: ${total} across ${perFile.length} files`);
  for (const [f, n] of perFile.slice(0, 50)) console.log(`${String(n).padStart(5)}  ${f}`);

  if (check) {
    const cleaned = readAllowlist('docs/theme-cleaned-files.txt');
    const offenders = [];
    for (const f of cleaned) {
      let txt; try { txt = readFileSync(f, 'utf8'); } catch { continue; }
      const bad = findDisallowedHex(txt);
      if (bad.length) offenders.push([f, [...new Set(bad)]]);
    }
    if (offenders.length) {
      console.error('\n❌ Theme ratchet: cleaned files reintroduced disallowed hex:');
      for (const [f, bad] of offenders) console.error(`   ${f}: ${bad.join(', ')}`);
      process.exit(1);
    }
    console.log(`✅ Theme ratchet: ${cleaned.length} cleaned file(s) hex-free.`);
  }
}

// Run main only when invoked directly (not when imported by tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/theme-consistency" && npx vitest run tests/themeHexAudit.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Smoke-run the script both modes**

Run: `node scripts/theme-hex-audit.mjs | head -3`
Expected: prints `Raw disallowed hex: <N> across <M> files`.
Run: `node scripts/theme-hex-audit.mjs --check; echo "exit=$?"`
Expected: since `docs/theme-cleaned-files.txt` doesn't exist yet, allowlist is empty → prints `✅ Theme ratchet: 0 cleaned file(s) hex-free.` and `exit=0`.

- [ ] **Step 6: Commit**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/theme-consistency"
git add scripts/theme-hex-audit.mjs tests/themeHexAudit.test.ts
git commit -m "feat(theme): hex-audit --check ratchet + pure findDisallowedHex"
```

---

## Task 2: Token playbook + ratchet allowlist

**Files:**
- Create: `docs/theme-tokens.md`
- Create: `docs/theme-cleaned-files.txt`

- [ ] **Step 1: Create the token playbook**

Create `docs/theme-tokens.md`:

```markdown
# Theme Tokens — the hex→token playbook

RMPG Flex has a day/night theme. **Never hardcode hex** in components; use the
CSS-variable-backed tokens so a color re-themes between night (steel-blue, default)
and day (light grey) automatically. Palette source of truth:
`client/src/styles/theme-palettes.css`.

## Token families
| Need | Use | Notes |
|---|---|---|
| Page/panel surface | `bg-surface-base` / `-raised` / `-sunken` / `-overlay` | dark at night, light in day |
| Body text | `text-rmpg-200/300` or `var(--spm-text)` | inverts by theme |
| Muted/secondary text | `text-rmpg-400/500` or `var(--spm-text-muted)` | |
| Borders | `border-rmpg-700/800` or `var(--spm-border)` | |
| Steel-blue accent | `var(--spm-accent)` | links/active |
| Selection / active row | `var(--spm-select)` + white text | the Spillman selected look |
| Toolbar nav | `var(--toolbar-nav-*)` | bar buttons |
| Tables | `var(--grid-*)` | header/rows |
| Info banners | `var(--info-*)` | |
| Brand gold | `#d4a017` (constant) | the ONE allowed hardcoded hex |

## Common hex → token
| Hardcoded | Replace with |
|---|---|
| `#0d1722` / dark base | `bg-surface-base` |
| `#141414` / raised dark | `bg-surface-raised` |
| `#888888` neutral text/ring | `text-rmpg-400` / `var(--spm-text-muted)` |
| `#ffffff` text on a panel | `text-rmpg-100` / `var(--spm-text)` (NOT raw white — invisible in day) |
| dark border `#2e2e2e`/`#222` | `var(--spm-border)` / `border-rmpg-800` |

## Do NOT tokenize
- **Brand gold `#d4a017`** — intentionally constant.
- **`.tactical-dark` surfaces** (live Map / dashcam & body-cam HUD / MDT / turn-by-turn Nav) — these stay dark in day on purpose (a bright map blinds a night driver). Leave their dark hex alone.

## Workflow when sweeping a page
1. `node scripts/theme-hex-audit.mjs` to see counts.
2. Replace the page's hex with tokens above; test in BOTH themes (toggle Night/Day in the header).
3. Add the now-clean file path to `docs/theme-cleaned-files.txt`.
4. `node scripts/theme-hex-audit.mjs --check` must pass.
```

- [ ] **Step 2: Create the ratchet allowlist (seed with already-clean chrome files)**

Create `docs/theme-cleaned-files.txt`:

```
# Files declared theme-clean (no disallowed hardcoded hex). CI fails if any of
# these reintroduce raw hex (brand gold #d4a017 is always allowed).
# Add a file here only after it passes `node scripts/theme-hex-audit.mjs --check`.
client/src/components/PanelTitleBar.tsx
client/src/components/IconButton.tsx
client/src/pages/dashboard/SpmGroup.tsx
client/src/pages/dashboard/DashboardViewSelector.tsx
client/src/pages/dashboard/dashboardViews.ts
```

- [ ] **Step 3: Verify the seeded allowlist is actually clean**

Run: `cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/theme-consistency" && node scripts/theme-hex-audit.mjs --check; echo "exit=$?"`
Expected: `✅ Theme ratchet: 5 cleaned file(s) hex-free.` and `exit=0`. (If any seeded file flags hex, REMOVE it from the list — do not weaken the check.)

- [ ] **Step 4: Commit**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/theme-consistency"
git add docs/theme-tokens.md docs/theme-cleaned-files.txt
git commit -m "docs(theme): token playbook + ratchet allowlist seed"
```

---

## Task 3: Fix the menu-dropdown chrome (the light-mode bug)

**Files:**
- Modify: `client/src/index.css` (the `.menu-dropdown` / `.menu-item*` block, ~lines 1722–1791)

- [ ] **Step 1: Apply the token swaps**

In `client/src/index.css`, change the menu chrome rules as follows (find each rule by its selector; do not alter unrelated properties).

`.menu-dropdown` — replace the hardcoded bevel borders with a single themed border:
```css
  .menu-dropdown {
    position: absolute;
    z-index: 9990;
    min-width: 220px;
    background: var(--surface-base);
    border: 1px solid var(--spm-border);
    box-shadow: 4px 4px 12px rgba(0, 0, 0, 0.35), 0 2px 6px rgba(0, 0, 0, 0.2);
    padding: 2px 0;
  }
```
(Delete the four `border-top-color/left/bottom/right-color` hardcoded lines.)

`.menu-item` — themed default text:
```css
  .menu-item {
    display: flex;
    align-items: center;
    width: 100%;
    padding: 4px 10px;
    font-size: 11px;
    color: var(--spm-text);
    background: transparent;
    border: 1px solid transparent;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
    text-align: left;
    gap: 6px;
    white-space: nowrap;
  }
```

`.menu-item:hover` — Spillman selected look (steel-blue bg + white text works in BOTH themes):
```css
  .menu-item:hover {
    background: var(--spm-select);
    color: #ffffff;
  }
```
(Leave `.menu-item:hover .menu-item-shortcut { color: rgba(255,255,255,0.6); }` and `.menu-item:hover .menu-item-arrow { color: #ffffff; }` as-is — white-on-steel-blue is legible in both themes.)

`.menu-item.active` — accent color that reads on the surface in both themes:
```css
  .menu-item.active {
    color: var(--spm-accent) !important;
  }
```

`.menu-item-disabled` — visibly dimmed but not invisible:
```css
  .menu-item-disabled {
    color: var(--spm-text-muted) !important;
    opacity: 0.55;
    cursor: default;
    pointer-events: none;
  }
```

- [ ] **Step 2: Confirm no remaining hardcoded text/border hex in the menu block**

Run: `cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/theme-consistency" && sed -n '1720,1795p' client/src/index.css | grep -nE "#[0-9a-fA-F]{6}"`
Expected: the only matches are inside `rgba(...)` is N/A (we used rgba with 0/255 only) and the `.menu-item:hover` `#ffffff` + shortcut/arrow whites (intentional, on steel-blue). No `#d0d0d0`, `#2e2e2e`, `#383838`, `#050505`, `#505050` remain.

- [ ] **Step 3: Build to confirm CSS is valid**

Run: `cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/theme-consistency/client" && npx vite build 2>&1 | tail -2`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/theme-consistency"
git add client/src/index.css
git commit -m "fix(theme): menu dropdowns legible in day mode (tokens, not hardcoded dark)"
```

---

## Task 4: Clean StatsCard + Layout focus rings

**Files:**
- Modify: `client/src/components/StatsCard.tsx` (5 hardcoded hex)
- Modify: `client/src/components/Layout.tsx` (`#888888` focus-ring hex)
- Modify: `docs/theme-cleaned-files.txt` (add StatsCard once clean)

- [ ] **Step 1: Inspect StatsCard's hex**

Run: `cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/theme-consistency" && grep -nE "#[0-9a-fA-F]{6}" client/src/components/StatsCard.tsx`
For each hex, replace per `docs/theme-tokens.md`:
- A surface/background hex → the matching `bg-surface-*` token class (or `var(--surface-*)` if in an inline style).
- A neutral text/border hex (e.g. `#888888`, `#222…`) → `text-rmpg-400` / `border-rmpg-800` (className) or `var(--spm-text-muted)` / `var(--spm-border)` (inline style).
- **Brand gold `#d4a017`** (if present) → leave it (allowed).
Apply the minimal change that preserves the current night appearance while letting day mode invert. Keep all layout/markup identical.

- [ ] **Step 2: Convert Layout.tsx focus-ring hex**

Run: `cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/theme-consistency" && grep -nE "ring-\[#888888\]|#888888" client/src/components/Layout.tsx`
For each `focus-visible:ring-[#888888]` (and equivalent `ring-[#888888]`), replace `[#888888]` with the token class `rmpg-500` → i.e. `focus-visible:ring-rmpg-500`. Do NOT attempt to clean every other hex in Layout.tsx (it's a large shell file and is NOT being added to the allowlist this PR) — only the `#888888` focus rings, which are the visible shared-chrome offenders.

- [ ] **Step 3: Typecheck**

Run: `cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/theme-consistency/client" && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Verify StatsCard is now hex-clean, then add it to the allowlist**

Run: `cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/theme-consistency" && node -e "import('./scripts/theme-hex-audit.mjs').then(m=>{const t=require('fs').readFileSync('client/src/components/StatsCard.tsx','utf8');console.log('disallowed:', m.findDisallowedHex(t))})"`
Expected: `disallowed: []`. If non-empty, fix the remaining hex before continuing.

Then append `client/src/components/StatsCard.tsx` to `docs/theme-cleaned-files.txt` (new line, above any trailing blank line).

Run: `node scripts/theme-hex-audit.mjs --check; echo "exit=$?"`
Expected: `✅ Theme ratchet: 6 cleaned file(s) hex-free.` and `exit=0`.

- [ ] **Step 5: Commit**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/theme-consistency"
git add client/src/components/StatsCard.tsx client/src/components/Layout.tsx docs/theme-cleaned-files.txt
git commit -m "fix(theme): tokenize StatsCard colors + Layout focus rings"
```

---

## Task 5: CI ratchet workflow + SW bump + final verification

**Files:**
- Create: `.github/workflows/theme-hex-guard.yml`
- Modify: `client/public/sw.js` (bump `CACHE_NAME`)

- [ ] **Step 1: Create the CI workflow**

Create `.github/workflows/theme-hex-guard.yml`:

```yaml
name: Theme Hex Guard
on:
  pull_request:
    paths:
      - 'client/src/**'
      - 'docs/theme-cleaned-files.txt'
      - 'scripts/theme-hex-audit.mjs'
  push:
    branches: [main]
jobs:
  theme-hex-ratchet:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      # Reports the global hex total (informational) and FAILS only if a file
      # listed in docs/theme-cleaned-files.txt reintroduces disallowed hex.
      - name: Theme hex ratchet
        run: node scripts/theme-hex-audit.mjs --check
```

- [ ] **Step 2: Bump the service worker cache**

Run: `cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/theme-consistency" && grep -nE "const CACHE_NAME" client/public/sw.js`
Increment the version number by 1 (match the exact existing format, e.g. `rmpg-flex-v975` → `rmpg-flex-v976`). Only change the number.

- [ ] **Step 3: Final verification — mirror CI**

Run each, confirm PASS:
```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/theme-consistency"
node scripts/theme-hex-audit.mjs --check        # exit 0, "6 cleaned file(s) hex-free"
cd client && npx tsc --noEmit                    # clean
cd client && npx vitest run                      # all pass (incl. new audit test if root-run; see note)
cd client && npx vite build                      # succeeds
```
Note: `tests/themeHexAudit.test.ts` is in the ROOT suite. Also run the root suite: `cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/theme-consistency" && npx vitest run tests/themeHexAudit.test.ts` → PASS.

- [ ] **Step 4: Commit**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/theme-consistency"
git add .github/workflows/theme-hex-guard.yml client/public/sw.js
git commit -m "ci(theme): hex-ratchet workflow + SW cache bump"
```

- [ ] **Step 5: Manual both-themes check (human — WAF blocks headless)**

Flag for the user: in a real browser, toggle Night↔Day (header Sun/Moon) and confirm:
- ENFORCE (and other module) dropdowns are fully legible in BOTH themes — no blank/washed-out items (the "Court Tracker" bug is gone).
- Menus/toolbars/tables/badges look flush in night, legible in day.
- Legacy-black kill-switch (`localStorage rmpg_theme_legacy='1'`) still renders pure-black chrome.
- Map / MDT stay dark in day (tactical surfaces untouched).

---

## Self-Review notes

- **Spec coverage:** global-chrome fix (Tasks 3–4), token doc (Task 2), CI ratchet + allowlist + script `--check` (Tasks 1, 2, 5), light-mode menu bug (Task 3), SW bump (Task 5), manual both-theme QA (Task 5 Step 5). All covered. The spec mentioned seeding the allowlist with Dashboard — corrected here: `DashboardPage.tsx` still has 87 hex (it's a PR-1 page sweep), so the allowlist is seeded only with genuinely-clean files (the dashboard *sub-components* + shared chrome components).
- **Placeholder scan:** none — every code step has concrete content. StatsCard's exact swaps are per-hex (the file has only 5; the engineer inspects + maps via the playbook) which is acceptable since the mapping rule is explicit and the audit `--check` is the objective gate.
- **Type/name consistency:** `findDisallowedHex` / `ALLOWED_HEX` / `--check` / `docs/theme-cleaned-files.txt` used identically across Tasks 1, 2, 4, 5.
- **Tactical-dark guard:** Tasks explicitly avoid touching `.tactical-dark` surfaces; brand gold `#d4a017` allowlisted in the script.
