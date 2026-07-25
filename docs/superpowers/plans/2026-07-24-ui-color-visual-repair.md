# UI Color & Visual Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the black overlays and off-theme surfaces on the live RMPG Flex UI, and reintroduce gold as a third brand color alongside Blue and Silver — on field labels, section headers, and map arterials — without letting decorative gold be mistaken for a warning state.

**Architecture:** Fix bottom-up. First move the theme-invariant chrome variables in `client/src/index.css` into the themed palette (this alone cascades to all 139 routes), then add explicitly-named `--accent-gold` / `--accent-silver` tokens rather than repointing the overloaded `--brand-gold`, then repair the theme-class stamping so correctness stops depending on CSS source order, then give the map a fixed Blue/Silver/Gold palette, and finally sweep the per-page hex long tail in reviewable directory-sized batches.

**Tech Stack:** React 18, TypeScript, Vite 6, Tailwind (CSS-variable-backed tokens), Mapbox GL JS, vitest + jsdom.

**Spec:** [`docs/superpowers/specs/2026-07-24-ui-color-visual-repair-design.md`](../specs/2026-07-24-ui-color-visual-repair-design.md)

## Global Constraints

- **Never hardcode hex** in components. Colors come from CSS-variable-backed Tailwind tokens in `client/src/styles/theme-palettes.css` — the single source of palette truth.
- **Do not modify** severity, priority, or unit-status hues: `--sev-*`, `--stat-accent-*`, `--spm-pri-1..9`, `--spm-stat-*`. These encode CAD semantics, not brand chrome.
- **Do not modify** `--window-chrome-close` `#ef4444` / `--window-chrome-minimize` `#d4a017` / `--window-chrome-maximize` `#22c55e`. Deliberate traffic-light triad.
- **Do not touch** PDF generators (`*Pdf*.ts`, `pdfTokens.ts`, `pdf-editor/` canvas), Mapbox paint literals outside `mapboxBasemap.ts`, `.tactical-dark` fixed values, or test fixtures/snapshots.
- **Border radius is 2px everywhere** — never `rounded-lg`.
- **Gold appears only** via `--field-label-color`, `--panel-header-color`, or the map palette. Any other gold surface is a defect by definition.
- **Gold is split by role, and this is measured, not preference** (decided 2026-07-24 after running the contrast numbers):
  - **Text roles** (field labels, panel/section headers, map major place labels) use `--accent-gold-300 #d9bd72`. It passes WCAG AA on all three navy surfaces (5.83 / 4.63 / 7.02 against base / raised / sunken).
  - **Graphic roles** (map arterial *lines*) use `--accent-gold-500 #b8912f`. Lines are graphical objects, which need only 3:1 per WCAG §1.4.11; `#b8912f` passes at 3.63 on navy base.
  - **`#b8912f` must NOT be used for text.** It measures 2.88:1 on `--surface-raised` — below AA, and raised panels are exactly where field labels sit.
  - Legacy `#d4a017` is banned outright: it fails AA too (4.50 / 3.57 / 5.41) *and* has the worst separation from `--sev-warn` (1.11).
  - Gold remains banned from badges, chips, status icons, and anything that reports a condition. Static chrome cannot signal state; transient indicators can, which is where amber-confusion actually bites.
- **`--brand-gold` stays aliased to silver** under Blue & Silver. ~500 files consume the `brand-gold-*` ramp expecting silver; repointing it would flip them all to gold.
- **Every `setPaint`/`setLayout` in `mapboxBasemap.ts` stays guarded** — a cosmetic restyle must never blank a map.
- **Gates (all must pass, baseline is clean so any failure is yours):**
  `npm run typecheck` (root) · `npm test` (root) · `cd client && npx tsc --noEmit` · `cd client && npx vitest run` · `cd client && npx vite build`
- **Tests touching theme resolution must set `localStorage.setItem(BLUE_SILVER_FLAG_KEY, '0')`** in setup, or default-on Blue & Silver forces `dark` and the assertion is meaningless.
- Commit messages end with: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

## Environment Prerequisite

A fresh worktree has no `client/node_modules`; without it `tsc` reports ~97,000 phantom `Cannot find module` errors.

```bash
cd client && npm install --legacy-peer-deps
```

A repo-wide pre-commit hook runs the Worker vitest suite (~17s) on every commit, and `core.hooksPath` is shared across worktrees.

## Measured Baseline (2026-07-24)

| Gate | Result |
|---|---|
| Worker typecheck | 0 errors |
| Worker vitest | 246 files, 2004 passed, 1 skipped |
| Client typecheck | 0 errors |
| Client vitest | 443 files, 3101 passed |

Clean. Any failure during implementation is caused by this work — a red gate is a hard stop, **with one documented exception below.**

### Known flake — do NOT chase it

`tests/pdfSign.test.ts` and `tests/footage/flexcamRoute.test.ts` (7 tests total)
intermittently fail with **`Test timed out in 5000ms`** when the machine is under
load. SLH-DSA post-quantum keygen genuinely costs seconds per call, and the
suite's per-test timeout is 5s.

Verified 2026-07-24: these 7 failed during a loaded full-suite run (49.9s
duration) and then passed 22/22 when the two files were run in isolation (`npx
vitest run tests/pdfSign.test.ts tests/footage/flexcamRoute.test.ts`).

This work does not touch `/src/`, so **any** failure in these two files is a
flake. Distinguishing it is unambiguous:

- **Flake:** `Test timed out in 5000ms` on post-quantum signing or flexcam routes.
- **Real failure:** an assertion comparing wrong values.

If the pre-commit hook trips on this, re-run the two files in isolation to
confirm, then retry the commit. Do not "fix" crypto code, do not raise the
timeout, and do not disable the tests — none of that is in scope for a
presentation-layer change.

## File Structure

**Created:**
- `client/src/utils/chartPalette.ts` — resolves chart series/axis/grid/legend colors from CSS variables. Single owner of chart color decisions.
- `client/src/utils/__tests__/chartPalette.test.ts`
- `client/src/utils/__tests__/mapPalette.test.ts`
- `client/scripts/audit-hex.mjs` — Class D classifier. Reports in-scope vs excluded hex literals.
- `client/src/utils/liveAudit.ts` — the computed-style audit, extracted so it is reusable and testable rather than pasted into a browser console.
- `client/src/utils/__tests__/liveAudit.test.ts`

**Modified:**
- `client/src/index.css` — remove theme-invariant chrome vars from `:root` (lines 13–33); the values move into the themed palette.
- `client/src/styles/theme-palettes.css` — add `--accent-gold`/`--accent-silver` ramps, `--panel-header-color`, and per-theme chrome vars for all four themes.
- `client/src/utils/theme.ts` — fix dual-class stamping (line ~131); fix stale `BLUE_SILVER_CHROME` (line 76).
- `client/index.html` — mirror both fixes in the pre-paint boot script (lines 45–52, 81).
- `client/src/utils/mapboxBasemap.ts` — fixed `MAP_PALETTE`; rewrite the now-contradicted header comment.
- `client/tailwind.config.js` — expose `accent-gold-*` / `accent-silver-*` token scales.
- `CLAUDE.md` — amend the Blue & Silver rule to Blue/Silver/Gold; correct the stale baseline claim.

---

### Task 1: Theme-invariant chrome variables move into the palette

Fixes E1–E4. This is the highest-leverage task in the plan: `--titlebar-gradient` is pure black on every panel title bar in every theme except day, and Blue & Silver has no override.

**Files:**
- Modify: `client/src/index.css:13-33` (remove chrome vars), `client/src/index.css:4298-4305` (remove now-duplicated day overrides)
- Modify: `client/src/styles/theme-palettes.css` (add chrome vars to all four theme blocks)
- Test: `client/src/utils/__tests__/liveAudit.test.ts`
- Create: `client/src/utils/liveAudit.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `findBlackOverlays(root: HTMLElement, opts?: { minArea?: number }): OverlayFinding[]` and `findGoldLeaks(root: HTMLElement): GoldFinding[]` from `client/src/utils/liveAudit.ts`, where
  `type OverlayFinding = { selector: string; backgroundColor: string; luminance: number; area: number }` and
  `type GoldFinding = { selector: string; property: string; value: string }`.
  Tasks 2, 4, and 6 reuse both.

- [ ] **Step 1: Write the failing test**

Create `client/src/utils/__tests__/liveAudit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { findBlackOverlays, findGoldLeaks } from '../liveAudit';

function mount(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

describe('findBlackOverlays', () => {
  it('flags a large near-black background that is not blue-dominant', () => {
    const host = mount('<div style="background-color: rgb(6,6,6); width: 200px; height: 100px"></div>');
    const found = findBlackOverlays(host);
    expect(found).toHaveLength(1);
    expect(found[0].luminance).toBeLessThan(26);
  });

  it('does not flag the navy surface ramp', () => {
    const host = mount('<div style="background-color: rgb(20,40,64); width: 200px; height: 100px"></div>');
    expect(findBlackOverlays(host)).toHaveLength(0);
  });

  it('ignores elements below the area threshold', () => {
    const host = mount('<div style="background-color: rgb(0,0,0); width: 4px; height: 4px"></div>');
    expect(findBlackOverlays(host)).toHaveLength(0);
  });
});

describe('findGoldLeaks', () => {
  it('flags legacy brand gold', () => {
    const host = mount('<span style="color: rgb(212,160,23)">x</span>');
    const found = findGoldLeaks(host);
    expect(found).toHaveLength(1);
    expect(found[0].property).toBe('color');
  });

  it('does not flag warning amber, which is a legitimate severity hue', () => {
    const host = mount('<span style="color: rgb(245,158,11)">x</span>');
    expect(findGoldLeaks(host)).toHaveLength(0);
  });

  it('does not flag the approved deepened gold', () => {
    const host = mount('<span style="color: rgb(184,145,47)">x</span>');
    expect(findGoldLeaks(host)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/__tests__/liveAudit.test.ts`
Expected: FAIL — `Failed to resolve import "../liveAudit"`

- [ ] **Step 3: Write minimal implementation**

Create `client/src/utils/liveAudit.ts`:

```ts
// client/src/utils/liveAudit.ts
// Computed-style audit used to verify the Blue/Silver/Gold theme on real pages.
// Extracted from an ad-hoc browser-console script so it is testable and reusable.
//
// "Black overlay" = a large painted background darker than the navy ramp floor
// (--surface-overlay #142840, luminance ~37) that is NOT blue-dominant. Blue
// dominance is the discriminator: a dark navy surface is correct, a dark neutral
// or warm surface is a theme escape.

export type OverlayFinding = {
  selector: string;
  backgroundColor: string;
  luminance: number;
  area: number;
};

export type GoldFinding = { selector: string; property: string; value: string };

/** Legacy brand-gold ramp values. These must never render post-migration —
 *  brand gold is now #b8912f (184 145 47). Warning amber is deliberately absent
 *  from this set: it is a legitimate severity hue, not a leak. */
const LEGACY_GOLD = new Set([
  '212,160,23', '232,184,32', '245,208,96', '184,136,15',
  '147,108,10', '160,116,18', '176,130,30', '100,73,7', '120,88,8',
]);

const MIN_AREA = 1200;
const LUMINANCE_FLOOR = 26;
const AUDITED_PROPS = ['color', 'backgroundColor', 'borderTopColor', 'borderLeftColor'] as const;

type Rgba = { r: number; g: number; b: number; a: number };

function parseColor(value: string | null | undefined): Rgba | null {
  const match = /rgba?\(([^)]+)\)/.exec(value ?? '');
  if (!match) return null;
  const parts = match[1].split(',').map((n) => parseFloat(n));
  if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) return null;
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
}

function luminance({ r, g, b }: Rgba): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function describe(el: Element): string {
  const cls = (el.className || '').toString().trim().split(/\s+/).slice(0, 3).join('.');
  return cls ? `${el.tagName.toLowerCase()}.${cls}` : el.tagName.toLowerCase();
}

function area(el: Element): number {
  const rect = el.getBoundingClientRect();
  // jsdom reports 0x0; fall back to inline width/height so tests are meaningful.
  if (rect.width && rect.height) return rect.width * rect.height;
  const style = (el as HTMLElement).style;
  return (parseFloat(style?.width || '0') || 0) * (parseFloat(style?.height || '0') || 0);
}

export function findBlackOverlays(root: HTMLElement, opts?: { minArea?: number }): OverlayFinding[] {
  const minArea = opts?.minArea ?? MIN_AREA;
  const findings: OverlayFinding[] = [];
  for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
    const bg = parseColor(getComputedStyle(el).backgroundColor);
    if (!bg || bg.a < 0.3) continue;
    const size = area(el);
    if (size < minArea) continue;
    const blueDominant = bg.b > bg.r + 8;
    const L = luminance(bg);
    if (L >= LUMINANCE_FLOOR || blueDominant) continue;
    findings.push({
      selector: describe(el),
      backgroundColor: getComputedStyle(el).backgroundColor,
      luminance: Math.round(L),
      area: Math.round(size),
    });
  }
  return findings;
}

export function findGoldLeaks(root: HTMLElement): GoldFinding[] {
  const findings: GoldFinding[] = [];
  for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
    const style = getComputedStyle(el);
    for (const prop of AUDITED_PROPS) {
      const color = parseColor(style[prop]);
      if (!color || color.a < 0.3) continue;
      if (!LEGACY_GOLD.has(`${color.r},${color.g},${color.b}`)) continue;
      findings.push({ selector: describe(el), property: prop, value: style[prop] });
      break;
    }
  }
  return findings;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/__tests__/liveAudit.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 5: Delete the theme-invariant chrome vars from `index.css`**

In `client/src/index.css`, replace lines 13–33 (the `:root` block) with:

```css
:root {
  /* Surface, border, text, brand-color, app-chrome, AND module-bar/bevel/titlebar
     vars are owned by client/src/styles/theme-palettes.css (imported above).
     Nothing color-valued belongs in this block — anything defined here is
     theme-invariant by construction and silently escapes the theme system.
     That is what made every panel title bar render a pure-black gradient under
     Blue & Silver (--titlebar-gradient) and the active nav tile render black
     (--toolbar-nav-active). See the 2026-07-24 UI color repair spec. */

  /* Window chrome traffic-light triad — intentionally theme-invariant.
     These are control affordances (close/minimize/maximize), not brand chrome. */
  --window-chrome-close: #ef4444;
  --window-chrome-minimize: #d4a017;
  --window-chrome-maximize: #22c55e;

  /* Typography — centralized font tokens */
  --font-mono: 'Consolas', 'Courier New', ui-monospace, SFMono-Regular, monospace;
  --font-sans: 'Calibri', Arial, Helvetica, sans-serif;
}
```

Also delete the two now-duplicated day-theme overrides at `client/src/index.css:4301-4302` (`--bevel-highlight` and `--titlebar-gradient`), since those values move into the `html.theme-light` block of the palette in Step 6.

- [ ] **Step 6: Add the chrome vars to every theme block in the palette**

In `client/src/styles/theme-palettes.css`, append to the **`:root, html.theme-dark, .tactical-dark`** block (before its closing brace):

```css
  /* Module-bar (F-key nav) + panel bevel/titlebar — NIGHT.
     Moved out of index.css:13-33 on 2026-07-24: those were theme-invariant and
     escaped the theme system entirely. */
  --toolbar-nav-text: #8fa3b8;
  --toolbar-nav-text-hover: #e6edf5;
  --toolbar-nav-text-active: var(--brand-blue);
  --toolbar-nav-hover: rgba(255, 255, 255, 0.05);
  --toolbar-nav-active: #0a1018;
  --bevel-highlight: #3a4f66;
  --titlebar-gradient: linear-gradient(180deg, #1d2d3f 0%, #15212e 50%, #1d2d3f 100%);
```

Append to the **`html.theme-light`** block:

```css
  --toolbar-nav-text: #555555;
  --toolbar-nav-text-hover: #1a1a1a;
  --toolbar-nav-text-active: var(--brand-blue);
  --toolbar-nav-hover: rgba(0, 0, 0, 0.05);
  --toolbar-nav-active: #d6d3c8;
  --bevel-highlight: #c3cdd8;
  --titlebar-gradient: linear-gradient(180deg, #ece9dd 0%, #d6d3c8 50%, #c9c5b8 100%);
```

Append to the **`html.theme-legacy-black`** block (preserves the pure-black kill-switch exactly):

```css
  --toolbar-nav-text: #9a9a9a;
  --toolbar-nav-text-hover: #dcdcdc;
  --toolbar-nav-text-active: var(--brand-blue);
  --toolbar-nav-hover: rgba(255, 255, 255, 0.05);
  --toolbar-nav-active: rgba(0, 0, 0, 0.38);
  --bevel-highlight: #3a3a3a;
  --titlebar-gradient: linear-gradient(180deg, #0b0b0b 0%, #060606 50%, #0b0b0b 100%);
```

Append to the **`html.theme-blue-silver`** block — this is the fix:

```css
  /* Module-bar + bevel/titlebar — BLUE & SILVER. Derived from the navy ramp so
     the active nav tile reads as *sunken navy*, not a black hole, and panel
     title bars read as a raised navy step instead of the inherited pure black. */
  --toolbar-nav-text: #9bb0c7;
  --toolbar-nav-text-hover: #f0f4f9;
  --toolbar-nav-text-active: var(--brand-blue);
  --toolbar-nav-hover: rgba(255, 255, 255, 0.06);
  --toolbar-nav-active: #142840;
  --bevel-highlight: #46688c;
  --titlebar-gradient: linear-gradient(180deg, #2c4f74 0%, #22405f 50%, #2c4f74 100%);
```

- [ ] **Step 7: Verify the black overlay is gone in the built CSS**

Run: `cd client && npx vite build 2>&1 | tail -5`
Expected: build succeeds.

Run: `cd client && grep -c "0, 0, 0, 0.38" dist/assets/*.css`
Expected: `1` — the only remaining occurrence is inside the `theme-legacy-black` block, which is correct.

- [ ] **Step 8: Run the full gates**

Run: `cd client && npx tsc --noEmit && npx vitest run 2>&1 | tail -5`
Expected: 0 typecheck errors; 444 test files passed, 3107 tests passed (443 + the new file; 3101 + 6 new tests).

- [ ] **Step 9: Commit**

```bash
git add client/src/index.css client/src/styles/theme-palettes.css client/src/utils/liveAudit.ts client/src/utils/__tests__/liveAudit.test.ts
git commit -m "$(cat <<'EOF'
fix(theme): move theme-invariant chrome vars into the themed palette

index.css:13-33 held color vars outside the theme system, so they never
re-themed. --titlebar-gradient painted a pure-black gradient on every
panel title bar in every theme except day, and --toolbar-nav-active
painted rgba(0,0,0,0.38) on the active nav tile. Blue & Silver had no
override for either, so it inherited pure black.

All four theme blocks now own these vars. Blue & Silver derives them
from its navy ramp. legacy-black keeps its exact previous values.

Adds liveAudit.ts (findBlackOverlays/findGoldLeaks) so this class of
defect is detectable by test rather than by eye.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Explicit `--accent-gold` / `--accent-silver` tokens

**Files:**
- Modify: `client/src/styles/theme-palettes.css` (`html.theme-blue-silver` block)
- Modify: `client/tailwind.config.js`
- Test: `client/src/utils/__tests__/accentTokens.test.ts` (create)

**Interfaces:**
- Consumes: nothing from Task 1 (independent; ordered after only to keep commits small).
- Produces: CSS variables `--accent-gold`, `--accent-gold-{300,400,500,600,700}(-rgb)`, `--accent-silver`, `--accent-silver-{300,400,500,600,700}(-rgb)`, `--panel-header-color`; Tailwind color scales `accent-gold-*` and `accent-silver-*`. Tasks 3 and 5 consume these.

- [ ] **Step 1: Write the failing test**

Create `client/src/utils/__tests__/accentTokens.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(__dirname, '../../styles/theme-palettes.css'), 'utf8');

function blueSilverBlock(): string {
  const start = css.indexOf('html.theme-blue-silver {');
  expect(start).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('\n}', start));
}

describe('Blue & Silver accent tokens', () => {
  const block = blueSilverBlock();

  it('defines the deepened brand gold, not legacy #d4a017', () => {
    expect(block).toContain('--accent-gold-500: #b8912f');
    expect(block).not.toContain('#d4a017');
  });

  it('defines the full gold and silver ramps with rgb triples', () => {
    for (const step of [300, 400, 500, 600, 700]) {
      expect(block).toMatch(new RegExp(`--accent-gold-${step}:`));
      expect(block).toMatch(new RegExp(`--accent-gold-${step}-rgb:`));
      expect(block).toMatch(new RegExp(`--accent-silver-${step}:`));
      expect(block).toMatch(new RegExp(`--accent-silver-${step}-rgb:`));
    }
  });

  it('keeps --brand-gold rendering silver for the ~500 existing consumers', () => {
    expect(block).toMatch(/--brand-gold:\s*var\(--accent-silver-500\)/);
  });

  it('routes both gold text roles through the AA-passing 300 step', () => {
    // 300 (#d9bd72), NOT 500 (#b8912f): 500 measures 2.88:1 on --surface-raised,
    // below WCAG AA, and raised panels are where field labels live.
    expect(block).toMatch(/--field-label-color:\s*var\(--accent-gold-300\)/);
    expect(block).toMatch(/--panel-header-color:\s*var\(--accent-gold-300\)/);
  });

  it('does not alter the warning severity hues', () => {
    expect(block).toContain('--sev-warn: #f59e0b');
    expect(block).toContain('--sev-caution: #facc15');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/__tests__/accentTokens.test.ts`
Expected: FAIL — `expect(block).toContain('--accent-gold-500: #b8912f')` fails; the token does not exist.

- [ ] **Step 3: Add the tokens**

In `client/src/styles/theme-palettes.css`, inside `html.theme-blue-silver`, replace the existing gold-ramp comment block and `--brand-gold` declaration region with:

```css
  /* ── Accent tokens (2026-07-24). Explicitly named so "silver" and "gold" are
     separate, addressable colors instead of one overloaded --brand-gold.

     --brand-gold is retained as a SILVER alias on purpose: ~500 files consume
     the brand-gold-* Tailwind ramp expecting silver (that swap is this theme's
     original identity). Repointing it at real gold would flip all of them at
     once. The alias is removed only after Task 6 migrates those consumers. */
  --accent-silver-300: #e5e9ee; --accent-silver-300-rgb: 229 233 238;
  --accent-silver-400: #d0d8e0; --accent-silver-400-rgb: 208 216 224;
  --accent-silver-500: #c3ccd6; --accent-silver-500-rgb: 195 204 214;
  --accent-silver-600: #a0adbd; --accent-silver-600-rgb: 160 173 189;
  --accent-silver-700: #7c8b9e; --accent-silver-700-rgb: 124 139 158;
  --accent-silver: var(--accent-silver-500);

  /* Deepened antique brass — NOT legacy #d4a017. Legacy gold is a near-neighbour
     of --sev-warn #f59e0b (~38 deg vs ~43 deg hue), so at 9-11px CAD type on navy
     decorative gold became indistinguishable from "overdue/threshold breached".
     Hue alone cannot separate them; saturation and peak brightness do. Amber is
     ~95% saturated with a 245 peak channel and reads as a glow; this is ~74%
     saturated with a 184 peak channel and reads as metal. Severity hues are
     deliberately left untouched. */
  --accent-gold-300: #d9bd72; --accent-gold-300-rgb: 217 189 114;
  --accent-gold-400: #c9a74e; --accent-gold-400-rgb: 201 167  78;
  --accent-gold-500: #b8912f; --accent-gold-500-rgb: 184 145  47;
  --accent-gold-600: #977626; --accent-gold-600-rgb: 151 118  38;
  --accent-gold-700: #745a1d; --accent-gold-700-rgb: 116  90  29;
  --accent-gold: var(--accent-gold-500);

  /* Compat alias — renders SILVER. See note above. */
  --brand-gold: var(--accent-silver-500);
  --brand-gold-300-rgb: 229 233 238; --brand-gold-400-rgb: 208 216 224;
  --brand-gold-500-rgb: 195 204 214; --brand-gold-600-rgb: 160 173 189;
  --brand-gold-700-rgb: 124 139 158;
  --brand-gold-rgb: 195 204 214;

  /* The only two gold roles in the app (per the 2026-07-24 design decision):
     field labels and section/panel headers. Everything else stays silver. Any
     gold surface NOT resolving through these two vars or the map palette is a
     defect, which is what makes the live audit assertion mechanical.

     These point at the 300 step, NOT 500. Measured 2026-07-24: 500 (#b8912f)
     is 3.63/2.88/4.36 against base/raised/sunken navy — below WCAG AA 4.5:1
     for the 9-11px type these labels use, and raised panels are exactly where
     field labels sit. 300 (#d9bd72) is 5.83/4.63/7.02 and passes everywhere.
     500 is retained for map arterial LINES, which are graphical objects needing
     only 3:1 (WCAG 1.4.11) and pass at 3.63. Do not "restore" 500 here. */
  --field-label-color: var(--accent-gold-300);
  --panel-header-color: var(--accent-gold-300);
```

Remove the old `--brand-gold: #c3ccd6;` declaration from the `--brand-blue` line (leave `--brand-blue: #5a9ae0;` intact) and remove the superseded `--brand-gold-*-rgb` / `--field-label-color` lines further down the block so each variable is declared exactly once.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/__tests__/accentTokens.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: Expose the Tailwind scales**

In `client/tailwind.config.js`, inside `theme.extend.colors`, add:

```js
        'accent-gold': {
          300: 'rgb(var(--accent-gold-300-rgb) / <alpha-value>)',
          400: 'rgb(var(--accent-gold-400-rgb) / <alpha-value>)',
          500: 'rgb(var(--accent-gold-500-rgb) / <alpha-value>)',
          600: 'rgb(var(--accent-gold-600-rgb) / <alpha-value>)',
          700: 'rgb(var(--accent-gold-700-rgb) / <alpha-value>)',
        },
        'accent-silver': {
          300: 'rgb(var(--accent-silver-300-rgb) / <alpha-value>)',
          400: 'rgb(var(--accent-silver-400-rgb) / <alpha-value>)',
          500: 'rgb(var(--accent-silver-500-rgb) / <alpha-value>)',
          600: 'rgb(var(--accent-silver-600-rgb) / <alpha-value>)',
          700: 'rgb(var(--accent-silver-700-rgb) / <alpha-value>)',
        },
```

- [ ] **Step 6: Verify contrast, and tune if it fails**

Run:

```bash
cd client && node -e "
const srgb=c=>{c/=255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4)};
const L=([r,g,b])=>0.2126*srgb(r)+0.7152*srgb(g)+0.0722*srgb(b);
const ratio=(a,b)=>{const[x,y]=[L(a),L(b)].sort((m,n)=>n-m);return (x+0.05)/(y+0.05)};
const surfaces={base:[34,64,95],raised:[44,79,116],sunken:[26,51,80]};
const fg={gold500:[184,145,47],gold400:[201,167,78],silver500:[195,204,214]};
for(const[fn,fv]of Object.entries(fg))for(const[sn,sv]of Object.entries(surfaces))
console.log(fn.padEnd(11),sn.padEnd(7),ratio(fv,sv).toFixed(2));
"
```

This is now a **regression check, not an exploration** — the values were measured on 2026-07-24 and the role split was decided from the results. Confirm you reproduce these:

| Foreground | base | raised | sunken | Verdict |
|---|---|---|---|---|
| `gold300 #d9bd72` (text roles) | 5.83 | 4.63 | 7.02 | passes AA |
| `gold500 #b8912f` (map lines only) | 3.63 | **2.88** | 4.36 | fails AA — never use for text |
| `silver500 #c3ccd6` | 6.57 | 5.22 | 7.92 | passes AA |

If your numbers differ, a token value was transcribed wrong — fix the token, do not adjust the table. If `gold300`'s minimum drops below 4.5, stop and report; do not silently pick a different step.

- [ ] **Step 7: Run the full gates**

Run: `cd client && npx tsc --noEmit && npx vitest run 2>&1 | tail -5 && npx vite build 2>&1 | tail -3`
Expected: 0 typecheck errors; all tests pass; build succeeds.

- [ ] **Step 8: Commit**

```bash
git add client/src/styles/theme-palettes.css client/tailwind.config.js client/src/utils/__tests__/accentTokens.test.ts
git commit -m "$(cat <<'EOF'
feat(theme): add explicit --accent-gold / --accent-silver tokens

Reintroduces gold as a third brand color without flipping the ~500 files
that consume the brand-gold-* ramp expecting silver. --brand-gold stays
aliased to silver; two new dedicated vars carry gold's only two roles
(--field-label-color, --panel-header-color).

Brand gold is #b8912f, not legacy #d4a017: legacy gold is a hue
neighbour of --sev-warn #f59e0b, and decorative chrome must not be
mistaken for an overdue/threshold alert in a CAD system. Separation
comes from saturation and peak brightness, not hue. Severity hues are
untouched.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Stop stamping two theme classes; fix the stale chrome color

Fixes E5 and E6. `theme.ts` (`applyThemePreference`) and the pre-paint boot script must change together — if they disagree, the page flashes one theme then swaps.

**Files:**
- Modify: `client/src/utils/theme.ts:76`, `client/src/utils/theme.ts:130-134`
- Modify: `client/index.html:45-52`, `client/index.html:81`
- Test: `client/src/utils/__tests__/themeClassStamp.test.ts` (create)

**Interfaces:**
- Consumes: `--surface-base` `#22405f` from the palette (Task 1/2 context).
- Produces: no new exported symbols. `applyThemePreference(value, options?)` keeps its existing signature.

- [ ] **Step 1: Write the failing test**

Create `client/src/utils/__tests__/themeClassStamp.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { applyThemePreference, BLUE_SILVER_FLAG_KEY, LEGACY_FLAG_KEY } from '../theme';

// NOTE: the exported function is applyThemePreference(value, options?), NOT
// applyTheme. Pass { persist: false, syncNative: false } so the test does not
// write localStorage back or reach for the Capacitor status-bar module.
const apply = () => applyThemePreference('dark', { persist: false, syncNative: false });

describe('theme class stamping', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
    document.documentElement.style.cssText = '';
  });

  it('does not stamp theme-dark alongside theme-blue-silver', () => {
    // Blue & Silver is default-ON when the flag is absent.
    apply();
    const cls = document.documentElement.className;
    expect(cls).toContain('theme-blue-silver');
    expect(cls).toContain('dark');
    expect(cls.split(/\s+/)).not.toContain('theme-dark');
  });

  it('stamps theme-dark when Blue & Silver is opted out', () => {
    localStorage.setItem(BLUE_SILVER_FLAG_KEY, '0');
    apply();
    const cls = document.documentElement.className;
    expect(cls.split(/\s+/)).toContain('theme-dark');
    expect(cls).not.toContain('theme-blue-silver');
  });

  it('legacy black wins and stamps neither theme-dark nor theme-blue-silver', () => {
    localStorage.setItem(LEGACY_FLAG_KEY, '1');
    apply();
    const cls = document.documentElement.className;
    expect(cls).toContain('theme-legacy-black');
    expect(cls).not.toContain('theme-blue-silver');
    expect(cls.split(/\s+/)).not.toContain('theme-dark');
  });

  it('uses the current navy surface-base as the chrome color, not the stale #0c1a2b', () => {
    apply();
    expect(document.documentElement.style.backgroundColor).toBe('rgb(34, 64, 95)');
  });
});
```

**Note on the class assertions:** `expect(cls).not.toContain('theme-dark')` would
be a false negative — the substring `theme-dark` does not appear in
`theme-blue-silver`, but a naive substring check on class strings is fragile in
general. The assertions above split on whitespace and check for the exact class
token instead.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/__tests__/themeClassStamp.test.ts`
Expected: FAIL — first test fails because `className` contains `theme-dark`; last test fails because the color is `rgb(12, 26, 43)` (`#0c1a2b`).

- [ ] **Step 3: Fix `theme.ts`**

At `client/src/utils/theme.ts:76`, replace:

```ts
const BLUE_SILVER_CHROME = '#0c1a2b';
```

with:

```ts
// Must track --surface-base in the html.theme-blue-silver block of
// theme-palettes.css. Was #0c1a2b, which the 2026-07-07 navy repair pass
// orphaned when surface-base moved to #22405f — the page root and browser
// theme-color then painted markedly darker than the surfaces above them,
// reading as a dark band behind content.
const BLUE_SILVER_CHROME = '#22405f';
```

At `client/src/utils/theme.ts:130-134` (inside `applyThemePreference`), replace:

```ts
  html.classList.remove('theme-dark', 'theme-light', 'theme-legacy-black', 'theme-blue-silver', 'dark');
  html.classList.add(`theme-${theme}`);
  if (theme === 'dark' || legacy || blueSilver) html.classList.add('dark');
  if (legacy) html.classList.add('theme-legacy-black');
  if (blueSilver) html.classList.add('theme-blue-silver');
```

with:

```ts
  html.classList.remove('theme-dark', 'theme-light', 'theme-legacy-black', 'theme-blue-silver', 'dark');
  // Exactly ONE palette class is stamped. Previously `theme-${theme}` was added
  // unconditionally, so Blue & Silver shipped as "theme-dark dark
  // theme-blue-silver" and only won because its block appears later in
  // theme-palettes.css. That made the entire app's appearance depend on CSS
  // source order — a bundler reordering, or any equal-specificity theme-dark
  // rule declared after it, would silently revert every surface to night.
  if (legacy) html.classList.add('theme-legacy-black');
  else if (blueSilver) html.classList.add('theme-blue-silver');
  else html.classList.add(`theme-${theme}`);
  if (theme === 'dark' || legacy || blueSilver) html.classList.add('dark');
```

- [ ] **Step 4: Mirror the fix in the pre-paint boot script**

In `client/index.html`, replace lines 45–49:

```js
          html.classList.remove('theme-dark', 'theme-light', 'theme-legacy-black', 'theme-blue-silver', 'dark');
          html.classList.add('theme-' + theme);
          if (theme === 'dark' || legacy || blueSilver) html.classList.add('dark');
          if (legacy) html.classList.add('theme-legacy-black');
          if (blueSilver) html.classList.add('theme-blue-silver');
```

with:

```js
          // Must resolve IDENTICALLY to applyThemePreference() in src/utils/theme.ts, or
          // the pre-paint class and the runtime class disagree and the page
          // visibly swaps themes after hydration. Exactly one palette class.
          html.classList.remove('theme-dark', 'theme-light', 'theme-legacy-black', 'theme-blue-silver', 'dark');
          if (legacy) html.classList.add('theme-legacy-black');
          else if (blueSilver) html.classList.add('theme-blue-silver');
          else html.classList.add('theme-' + theme);
          if (theme === 'dark' || legacy || blueSilver) html.classList.add('dark');
```

On line 52, change `'#0c1a2b'` to `'#22405f'`. On line 81, change `html.theme-blue-silver #pre-splash { background: #0c1a2b; }` to `background: #22405f;`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/__tests__/themeClassStamp.test.ts`
Expected: PASS — 4 tests

- [ ] **Step 6: Verify no other test depended on the dual-class behavior**

Run: `cd client && npx vitest run src/utils/__tests__/themeOverride.test.ts src/utils/__tests__/themeLegacy.test.ts`
Expected: PASS. If either fails, it is asserting on the old dual-class output; per CLAUDE.md such tests must set `localStorage.setItem(BLUE_SILVER_FLAG_KEY, '0')` in setup. Add that rather than weakening the new assertion.

- [ ] **Step 7: Run the full gates**

Run: `cd client && npx tsc --noEmit && npx vitest run 2>&1 | tail -5 && npx vite build 2>&1 | tail -3`
Expected: 0 typecheck errors; all tests pass; build succeeds.

- [ ] **Step 8: Commit**

```bash
git add client/src/utils/theme.ts client/index.html client/src/utils/__tests__/themeClassStamp.test.ts
git commit -m "$(cat <<'EOF'
fix(theme): stamp exactly one palette class; un-stale the chrome color

applyThemePreference added `theme-${theme}` unconditionally before adding
theme-blue-silver, so the live app shipped as
class="theme-dark dark theme-blue-silver". Blue & Silver won only
because its block sits later in theme-palettes.css, making the whole
app's appearance depend on CSS source order.

Also fixes BLUE_SILVER_CHROME, orphaned at #0c1a2b when the 2026-07-07
navy repair moved --surface-base to #22405f. The page root, browser
theme-color, and #pre-splash were painting far darker than the surfaces
above them.

The pre-paint boot script in index.html is changed identically; if the
two resolve differently the page swaps themes after hydration.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Chart palette helper

Fixes Class B — `.recharts-legend-item-text` renders hardcoded `rgb(212,160,23)` on every charted route.

**Files:**
- Create: `client/src/utils/chartPalette.ts`, `client/src/utils/__tests__/chartPalette.test.ts`
- Modify: chart consumers found by the grep in Step 5

**Interfaces:**
- Consumes: `--accent-silver-*`, `--accent-gold-*`, `--sev-*`, `--brand-blue`, `--text-muted`, `--border-subtle` (Task 2).
- Produces: from `client/src/utils/chartPalette.ts` —
  `chartSeriesColors(): string[]`,
  `chartAxisColor(): string`,
  `chartGridColor(): string`,
  `chartLegendColor(): string`,
  `resolveThemeColor(varName: string, fallback: string): string`.

- [ ] **Step 1: Write the failing test**

Create `client/src/utils/__tests__/chartPalette.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  chartSeriesColors, chartAxisColor, chartGridColor, chartLegendColor, resolveThemeColor,
} from '../chartPalette';

describe('chartPalette', () => {
  beforeEach(() => {
    document.documentElement.style.cssText = '';
  });

  it('resolves a theme variable when set', () => {
    document.documentElement.style.setProperty('--text-muted', '#9bb0c7');
    expect(resolveThemeColor('--text-muted', '#000')).toBe('#9bb0c7');
  });

  it('falls back when the variable is unset', () => {
    expect(resolveThemeColor('--not-a-real-var', '#123456')).toBe('#123456');
  });

  it('never returns legacy brand gold from any accessor', () => {
    const all = [...chartSeriesColors(), chartAxisColor(), chartGridColor(), chartLegendColor()];
    expect(all.join(' ').toLowerCase()).not.toContain('#d4a017');
    expect(all.join(' ')).not.toContain('212, 160, 23');
  });

  it('returns a non-empty, duplicate-free series palette', () => {
    const series = chartSeriesColors();
    expect(series.length).toBeGreaterThanOrEqual(4);
    expect(new Set(series).size).toBe(series.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/__tests__/chartPalette.test.ts`
Expected: FAIL — `Failed to resolve import "../chartPalette"`

- [ ] **Step 3: Write the implementation**

Create `client/src/utils/chartPalette.ts`:

```ts
// client/src/utils/chartPalette.ts
// Single owner of chart color decisions. Recharts takes literal color strings
// (a `var(--x)` reference is not resolved inside SVG paint attributes), so
// colors are read off <html> at call time instead of being hardcoded.
//
// This exists because chart internals were carrying literal #d4a017, which is
// legacy gold: it never re-themed, and it survived the Blue & Silver migration
// as a visible gold leak on every charted route.
//
// Call these at RENDER time, not at module scope — a module-level constant is
// captured before the theme class is stamped and freezes the wrong palette.

const FALLBACKS: Record<string, string> = {
  '--brand-blue': '#5a9ae0',
  '--accent-silver-500': '#c3ccd6',
  '--accent-gold-500': '#b8912f',
  '--sev-ok': '#22c55e',
  '--sev-warn': '#f59e0b',
  '--sev-special': '#c084fc',
  '--text-muted': '#9bb0c7',
  '--border-subtle': '#2a4763',
};

export function resolveThemeColor(varName: string, fallback: string): string {
  try {
    const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return value || fallback;
  } catch {
    return fallback;
  }
}

function themeColor(varName: string): string {
  return resolveThemeColor(varName, FALLBACKS[varName] ?? '#9bb0c7');
}

/** Categorical series palette, ordered for maximum adjacent separation.
 *  Severity hues appear here as CATEGORY colors only; a chart encoding real
 *  severity should map its own values to --sev-* directly rather than relying
 *  on this ordering. */
export function chartSeriesColors(): string[] {
  return [
    themeColor('--brand-blue'),
    themeColor('--accent-silver-500'),
    themeColor('--accent-gold-500'),
    themeColor('--sev-ok'),
    themeColor('--sev-special'),
    themeColor('--sev-warn'),
  ];
}

export function chartAxisColor(): string {
  return themeColor('--text-muted');
}

export function chartGridColor(): string {
  return themeColor('--border-subtle');
}

export function chartLegendColor(): string {
  return themeColor('--text-muted');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/__tests__/chartPalette.test.ts`
Expected: PASS — 4 tests

- [ ] **Step 5: Find and convert the chart consumers**

Run: `cd client && grep -rln "recharts" src --include='*.tsx' | xargs grep -lE "#d4a017|212, ?160, ?23"`

For each file returned, replace the hardcoded gold in recharts props with the helper. Import it:

```ts
import { chartSeriesColors, chartAxisColor, chartGridColor, chartLegendColor } from '../utils/chartPalette';
```

(adjust the relative path per file) and substitute inside the component body — for example a `<Legend wrapperStyle={{ color: '#d4a017' }} />` becomes `<Legend wrapperStyle={{ color: chartLegendColor() }} />`, and `<Line stroke="#d4a017" />` becomes `<Line stroke={chartSeriesColors()[2]} />`. Call the helpers inside the component render, never at module scope.

- [ ] **Step 6: Verify no chart still carries legacy gold**

Run: `cd client && grep -rlE "#d4a017|212, ?160, ?23" $(grep -rln "recharts" src --include='*.tsx') 2>/dev/null | wc -l`
Expected: `0`

- [ ] **Step 7: Run the full gates**

Run: `cd client && npx tsc --noEmit && npx vitest run 2>&1 | tail -5 && npx vite build 2>&1 | tail -3`
Expected: 0 typecheck errors; all tests pass; build succeeds.

- [ ] **Step 8: Commit**

```bash
git add client/src/utils/chartPalette.ts client/src/utils/__tests__/chartPalette.test.ts client/src/pages client/src/components
git commit -m "$(cat <<'EOF'
fix(charts): resolve chart colors from theme vars instead of literal gold

Chart internals carried literal #d4a017, so recharts legends and series
rendered legacy gold on every charted route regardless of theme — a
visible gold leak that survived the Blue & Silver migration.

chartPalette.ts becomes the single owner of chart color decisions.
Helpers must be called at render time; a module-scope constant is
captured before the theme class is stamped and freezes the wrong palette.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Fixed Blue/Silver/Gold map palette

**Files:**
- Modify: `client/src/utils/mapboxBasemap.ts` (whole file — header comment through `applyRmpgBasemap`)
- Create: `client/src/utils/__tests__/mapPalette.test.ts`

**Interfaces:**
- Consumes: nothing at runtime — the palette is intentionally literal, not variable-derived.
- Produces: `MAP_PALETTE` (frozen object with keys `land`, `water`, `arterial`, `road`, `roadMinor`, `boundary`, `labelMajor`, `labelMinor`, `halo`), and the existing `applyRmpgBasemap(map, opts?: { variant?: BasemapVariant })` signature unchanged. `getThemeColorRgb` is retained as an export for any current importer.

- [ ] **Step 1: Write the failing test**

Create `client/src/utils/__tests__/mapPalette.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { MAP_PALETTE, isArterialLayer, isMajorLabelLayer } from '../mapboxBasemap';

describe('MAP_PALETTE', () => {
  it('is fixed and does not depend on the active theme', () => {
    const before = { ...MAP_PALETTE };
    document.documentElement.className = 'theme-legacy-black';
    expect({ ...MAP_PALETTE }).toEqual(before);
    document.documentElement.className = '';
  });

  it('uses deep gold for arterial lines and lighter gold for major label text', () => {
    // Split by WCAG role: lines need 3:1, text needs 4.5:1 on navy.
    expect(MAP_PALETTE.arterial).toBe('#b8912f');
    expect(MAP_PALETTE.labelMajor).toBe('#d9bd72');
  });

  it('uses silver for secondary roads and minor labels', () => {
    expect(MAP_PALETTE.road).toBe('#c3ccd6');
    expect(MAP_PALETTE.labelMinor).toBe('#a0adbd');
  });

  it('uses navy for land and a darker navy for water', () => {
    expect(MAP_PALETTE.land).toBe('#22405f');
    expect(MAP_PALETTE.water).toBe('#142840');
  });
});

describe('layer matchers', () => {
  it('treats motorway, trunk and primary as arterials', () => {
    for (const id of ['road-motorway', 'bridge-trunk', 'road-primary-case']) {
      expect(isArterialLayer(id)).toBe(true);
    }
  });

  it('does not treat secondary or residential as arterials', () => {
    for (const id of ['road-secondary', 'road-residential', 'road-tertiary']) {
      expect(isArterialLayer(id)).toBe(false);
    }
  });

  it('treats city, town and major settlement labels as major', () => {
    for (const id of ['place-city-lg', 'place-town', 'settlement-major-label']) {
      expect(isMajorLabelLayer(id)).toBe(true);
    }
  });

  it('does not treat neighbourhood labels as major', () => {
    expect(isMajorLabelLayer('place-neighbourhood')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/__tests__/mapPalette.test.ts`
Expected: FAIL — `MAP_PALETTE`, `isArterialLayer`, `isMajorLabelLayer` are not exported.

- [ ] **Step 3: Replace the header comment**

The existing header (lines 1–23) documents the opposite of the new behavior and must not be left contradicting the code. Replace lines 1–23 of `client/src/utils/mapboxBasemap.ts` with:

```ts
// client/src/utils/mapboxBasemap.ts
// Runtime re-skin of a stock Mapbox style into RMPG's FIXED map palette.
// Call on the map's `style.load` event so it re-applies after every style swap.
// Every mutation is guarded: a layer missing from a given stock style is skipped,
// never thrown — the restyler must never blank the map an operator depends on.
//
// PALETTE IS FIXED, NOT THEME-DERIVED (2026-07-24 decision). Every variant —
// dark, tactical-dark, legacy-black, day — renders the same Blue/Silver/Gold so
// map appearance is predictable for operators and a future app-theme change
// cannot silently degrade map legibility.
//
// This SUPERSEDES the 2026-07-07 decision that maps follow the active theme via
// getComputedStyle on <html>. That approach also meant the map's accent tracked
// --brand-gold, which resolves to SILVER under Blue & Silver — so the map had no
// gold at all. Gold is now explicit and unconditional.
//
// Assignment: Blue = land/water/background. Gold = major arterials
// (motorway/trunk/primary) and major place labels (city/town/settlement-major).
// Silver = secondary/minor roads, admin boundaries, and all minor labels.
//
// Mapbox GL's style-spec color parser accepts hex and the legacy comma-separated
// rgb()/rgba() form only. The modern space-separated CSS4 form that Tailwind's
// rgb(var(--x)/<alpha>) tokens use fails with "color expected" and blanks the map.
```

- [ ] **Step 4: Add the palette, the matchers, and rewrite `applyDark`/`applySatellite`**

Replace the `FALLBACK_RGB` / `FALLBACK_HEX` constants and the bodies of `applyDark` and `applySatellite` in `client/src/utils/mapboxBasemap.ts`. Keep `readVar`, `getThemeColorRgb`, `getThemeColorHex`, `isDev`, `setPaint`, `setLayout`, and `forEachLayer` exactly as they are — `getThemeColorRgb` remains exported for existing importers.

Add above `applyDark`:

```ts
/** Fixed map palette. Literal values by design — see the header note. */
export const MAP_PALETTE = Object.freeze({
  land: '#22405f',        // navy base
  water: '#142840',       // darker navy step
  // GOLD, split by WCAG role. Arterials are LINES (graphical objects, 3:1 per
  // 1.4.11) so they take the deep brass, which measures 3.63 on navy. Major
  // place labels are TEXT (4.5:1 per 1.4.3) so they take the lighter 300-step
  // gold, which measures 4.63+. Do not unify these two on #b8912f — that would
  // put unreadable text on the map.
  arterial: '#b8912f',    // GOLD (deep)  — motorway / trunk / primary LINES
  labelMajor: '#d9bd72',  // GOLD (light) — city / town / settlement-major TEXT
  road: '#c3ccd6',        // silver — secondary / tertiary
  roadMinor: '#7c8b9e',   // dim silver — residential / service
  boundary: '#46688c',    // subtle navy-silver border
  labelMinor: '#a0adbd',  // silver — everything else
  halo: '#142840',        // halo matches the map's own darkest surface
});

const ARTERIAL_RE = /motorway|trunk|primary/i;
const MAJOR_LABEL_RE = /place-(city|town)|settlement-major/i;
const ROAD_RE = /road|street|bridge|tunnel|motorway|trunk|primary|secondary|tertiary/i;
const MID_ROAD_RE = /secondary|tertiary/i;
const LAND_RE = /land|landcover|landuse|national-park|park/i;
const WATER_RE = /water|ocean|river|bathymetry/i;
const NOISE_LABEL_RE = /poi|transit|airport|natural-point/i;

export function isArterialLayer(id: string): boolean {
  return ARTERIAL_RE.test(id);
}

export function isMajorLabelLayer(id: string): boolean {
  return MAJOR_LABEL_RE.test(id);
}
```

Replace `applyDark` with:

```ts
function applyDark(map: mapboxgl.Map): void {
  const P = MAP_PALETTE;

  setPaint(map, 'background', 'background-color', P.land);
  forEachLayer(map,
    (id, type) => type === 'background' || LAND_RE.test(id),
    (id, type) => {
      if (type === 'fill') setPaint(map, id, 'fill-color', P.land);
      if (type === 'background') setPaint(map, id, 'background-color', P.land);
    });

  forEachLayer(map, (id) => WATER_RE.test(id),
    (id, type) => {
      if (type === 'fill') setPaint(map, id, 'fill-color', P.water);
      if (type === 'line') setPaint(map, id, 'line-color', P.water);
    });

  // Roads: gold arterials carry the wayfinding spine, silver steps down.
  forEachLayer(map, (id, type) => type === 'line' && ROAD_RE.test(id),
    (id) => {
      if (isArterialLayer(id)) {
        setPaint(map, id, 'line-color', P.arterial);
        setPaint(map, id, 'line-opacity', 0.85);
      } else if (MID_ROAD_RE.test(id)) {
        setPaint(map, id, 'line-color', P.road);
        setPaint(map, id, 'line-opacity', 0.55);
      } else {
        setPaint(map, id, 'line-color', P.roadMinor);
        setPaint(map, id, 'line-opacity', 0.45);
      }
    });

  forEachLayer(map, (id, type) => type === 'line' && /admin|boundary/i.test(id),
    (id) => setPaint(map, id, 'line-color', P.boundary));

  forEachLayer(map, (id, type) => type === 'symbol',
    (id) => {
      if (NOISE_LABEL_RE.test(id)) {
        setLayout(map, id, 'visibility', 'none');
        return;
      }
      setPaint(map, id, 'text-halo-color', P.halo);
      setPaint(map, id, 'text-halo-width', 1.2);
      setPaint(map, id, 'text-color',
        isArterialLayer(id) || isMajorLabelLayer(id) ? P.labelMajor : P.labelMinor);
    });
}
```

Replace `applySatellite` with:

```ts
function applySatellite(map: mapboxgl.Map): void {
  const P = MAP_PALETTE;
  // Imagery is left alone; only the overlay roads/labels are made legible.
  forEachLayer(map, (id, type) => type === 'line' && ROAD_RE.test(id),
    (id) => { if (isArterialLayer(id)) setPaint(map, id, 'line-color', P.arterial); });
  forEachLayer(map, (id, type) => type === 'symbol',
    (id) => {
      setPaint(map, id, 'text-halo-color', P.halo);
      setPaint(map, id, 'text-halo-width', 1.4);
      setPaint(map, id, 'text-color',
        isMajorLabelLayer(id) ? P.labelMajor : P.labelMinor);
    });
}
```

- [ ] **Step 5: Route the bright basemap through the dark restyle**

In `applyRmpgBasemap`, replace the variant dispatch:

```ts
    if (variant === 'satellite') applySatellite(map);
    else if (variant === 'dark') applyDark(map);
    // 'light' = print path: intentionally minimal, leave stock light style as-is.
```

with:

```ts
    if (variant === 'satellite') applySatellite(map);
    else if (variant === 'print') { /* leave stock light style for print output */ }
    else applyDark(map);
```

Widen the type on line 27 to `export type BasemapVariant = 'dark' | 'satellite' | 'light' | 'print';`, so `'light'` now falls through to `applyDark` — this is what fixes the bright tan basemap observed on the dashboard mini-map. Only an explicit `'print'` opts out.

- [ ] **Step 6: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/__tests__/mapPalette.test.ts`
Expected: PASS — 8 tests

- [ ] **Step 7: Check for callers that relied on `'light'` meaning "unstyled"**

Run: `cd client && grep -rn "variant: *'light'\|variant=\"light\"\|BasemapVariant" src --include='*.tsx' --include='*.ts'`

For each hit that is genuinely a print/export path, change it to `'print'`. Any hit that is an on-screen map should stay `'light'` and now correctly receives the dark restyle. Report which callers were changed.

- [ ] **Step 8: Run the full gates**

Run: `cd client && npx tsc --noEmit && npx vitest run 2>&1 | tail -5 && npx vite build 2>&1 | tail -3`
Expected: 0 typecheck errors; all tests pass; build succeeds.

- [ ] **Step 9: Commit**

```bash
git add client/src/utils/mapboxBasemap.ts client/src/utils/__tests__/mapPalette.test.ts client/src/pages client/src/components
git commit -m "$(cat <<'EOF'
feat(map): fixed Blue/Silver/Gold map palette across all variants

Maps previously derived their accent from --brand-gold via getComputedStyle,
which resolves to SILVER under Blue & Silver — so the map had no gold at
all. The palette is now fixed and literal: gold on major arterials and
major place labels, silver on secondary/minor roads and minor labels,
navy land with a darker navy water step.

Fixed for every variant (dark, tactical-dark, legacy-black, day) so map
appearance is predictable for operators. This supersedes the 2026-07-07
"maps follow the active theme" decision; the file header is rewritten
rather than left contradicting the code.

Variant 'light' now falls through to the dark restyle, fixing the bright
tan basemap on the dashboard mini-map. Only the new explicit 'print'
variant opts out. All setPaint/setLayout calls stay guarded.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Class D classifier

Builds the tooling that makes the long-tail sweep safe. No component edits in this task — its deliverable is a trustworthy work-list.

**Files:**
- Create: `client/scripts/audit-hex.mjs`, `client/src/utils/__tests__/hexClassifier.test.ts`
- Create: `client/src/utils/hexClassifier.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: from `client/src/utils/hexClassifier.ts` —
  `classifyFile(path: string): 'excluded' | 'in-scope'` and
  `EXCLUSION_REASONS: Record<string, RegExp>`.
  `client/scripts/audit-hex.mjs` imports `classifyFile` and prints a per-directory tally.

- [ ] **Step 1: Write the failing test**

Create `client/src/utils/__tests__/hexClassifier.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { classifyFile } from '../hexClassifier';

describe('classifyFile', () => {
  it('excludes PDF generators, whose hex is a literal jsPDF argument', () => {
    for (const p of [
      'src/utils/dispatchGuidePdfGenerator.ts',
      'src/utils/pdfTokens.ts',
      'src/pages/fleet/utils/fleetPdfReports.ts',
      'src/utils/navTripPdf.ts',
    ]) {
      expect(classifyFile(p)).toBe('excluded');
    }
  });

  it('excludes the pdf-editor canvas renderer', () => {
    expect(classifyFile('src/pages/pdf-editor/components/PageCanvas.tsx')).toBe('excluded');
  });

  it('excludes the map basemap module, which owns its own fixed palette', () => {
    expect(classifyFile('src/utils/mapboxBasemap.ts')).toBe('excluded');
    expect(classifyFile('src/utils/mapMarkers.ts')).toBe('excluded');
  });

  it('excludes tests and fixtures', () => {
    expect(classifyFile('src/utils/__tests__/mapboxSafeLayer.test.ts')).toBe('excluded');
    expect(classifyFile('src/utils/liveAudit.ts')).toBe('excluded');
  });

  it('includes ordinary page and component chrome', () => {
    for (const p of [
      'src/pages/CrashReportsPage.tsx',
      'src/pages/AlarmTrackingPage.tsx',
      'src/components/StatsCard.tsx',
    ]) {
      expect(classifyFile(p)).toBe('in-scope');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/__tests__/hexClassifier.test.ts`
Expected: FAIL — `Failed to resolve import "../hexClassifier"`

- [ ] **Step 3: Write the implementation**

Create `client/src/utils/hexClassifier.ts`:

```ts
// client/src/utils/hexClassifier.ts
// Decides whether a file's hex literals are migratable chrome or load-bearing.
//
// Roughly 5,690 hex literals live across 549 client files, and a blind
// hex-to-token sweep breaks five separate categories. Exclusions are therefore
// deny-by-default and matched on path, because the cost of wrongly migrating a
// PDF color argument or a Mapbox paint literal is a broken document or a blank
// map, while the cost of wrongly excluding a file is only that a human looks at
// it later.

export const EXCLUSION_REASONS: Record<string, RegExp> = {
  // jsPDF / pdf-lib take literal color arguments; CSS variables are meaningless.
  pdfGenerator: /(^|\/)[^/]*[Pp]df[^/]*\.(ts|tsx)$/,
  pdfEditorCanvas: /(^|\/)pdf-editor\//,
  // Mapbox GL rejects var(--x); these modules own resolved color strings.
  mapboxPaint: /(^|\/)(mapboxBasemap|mapboxSafeLayer|mapMarkers|mapboxMap)\.ts$/,
  // Tests and fixtures assert on literal values on purpose.
  tests: /(__tests__|\.test\.|\.spec\.)/,
  // The audit tooling itself must keep literal reference values.
  auditTooling: /(^|\/)(liveAudit|hexClassifier|chartPalette)\.ts$/,
};

export function classifyFile(path: string): 'excluded' | 'in-scope' {
  const normalized = path.replace(/\\/g, '/');
  for (const re of Object.values(EXCLUSION_REASONS)) {
    if (re.test(normalized)) return 'excluded';
  }
  return 'in-scope';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/__tests__/hexClassifier.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: Write the reporting script**

Create `client/scripts/audit-hex.mjs`:

```js
// client/scripts/audit-hex.mjs
// Reports migratable hex literals per directory, so the Class D sweep can be
// batched into reviewable PRs instead of one unreviewable 549-file diff.
// Usage: node scripts/audit-hex.mjs [--list <dir>]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { classifyFile } from '../src/utils/hexClassifier.ts';

const ROOT = 'src';
const HEX = /#[0-9a-fA-F]{6}\b|rgba?\(\s*0\s*,\s*0\s*,\s*0\s*[,)]/g;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const tally = new Map();
let excludedFiles = 0, excludedHits = 0;

for (const file of walk(ROOT)) {
  const hits = (readFileSync(file, 'utf8').match(HEX) ?? []).length;
  if (!hits) continue;
  const rel = relative('.', file);
  if (classifyFile(rel) === 'excluded') { excludedFiles++; excludedHits += hits; continue; }
  const bucket = rel.split('/').slice(0, 3).join('/');
  const prev = tally.get(bucket) ?? { files: 0, hits: 0, paths: [] };
  tally.set(bucket, { files: prev.files + 1, hits: prev.hits + hits, paths: [...prev.paths, rel] });
}

const listDir = process.argv.includes('--list') ? process.argv[process.argv.indexOf('--list') + 1] : null;
if (listDir) {
  for (const [bucket, v] of tally) if (bucket.startsWith(listDir)) v.paths.forEach((p) => console.log(p));
} else {
  const rows = [...tally.entries()].sort((a, b) => b[1].hits - a[1].hits);
  let totalFiles = 0, totalHits = 0;
  for (const [bucket, v] of rows) {
    console.log(String(v.hits).padStart(6), String(v.files).padStart(4) + ' files ', bucket);
    totalFiles += v.files; totalHits += v.hits;
  }
  console.log('\nIN SCOPE :', totalHits, 'literals across', totalFiles, 'files,', rows.length, 'batches');
  console.log('EXCLUDED :', excludedHits, 'literals across', excludedFiles, 'files');
}
```

- [ ] **Step 6: Run it and record the real work-list**

Run: `cd client && npx tsx scripts/audit-hex.mjs`
Expected: a per-directory tally, then an `IN SCOPE` / `EXCLUDED` summary. The in-scope total will be well below 5,690 because PDF generators alone account for a large share.

Paste the output into the commit message. This is the authoritative batch list for Task 7 — do not invent batches by hand.

- [ ] **Step 7: Run the full gates**

Run: `cd client && npx tsc --noEmit && npx vitest run 2>&1 | tail -5`
Expected: 0 typecheck errors; all tests pass.

- [ ] **Step 8: Commit**

```bash
git add client/src/utils/hexClassifier.ts client/src/utils/__tests__/hexClassifier.test.ts client/scripts/audit-hex.mjs
git commit -m "$(cat <<'EOF'
chore(theme): add Class D hex classifier and per-directory audit script

A blind hex-to-token sweep breaks five categories: PDF color arguments,
Mapbox paint literals, tactical-dark fixed values, fixed CAD palettes,
and test fixtures. Exclusions are deny-by-default and path-matched,
because wrongly migrating a PDF color breaks a document while wrongly
excluding a file only means a human reviews it later.

audit-hex.mjs produces the authoritative per-directory batch list for
the sweep, so it can ship as reviewable PRs rather than one 549-file diff.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Class D sweep — one batch per PR

**Repeat this task once per batch** from the `audit-hex.mjs` tally, highest hit-count first. Each batch is its own PR, cut from current `origin/main`.

**Files:**
- Modify: the files listed by `npx tsx scripts/audit-hex.mjs --list <batch-dir>`

**Interfaces:**
- Consumes: `classifyFile` (Task 6); the `accent-gold-*` / `accent-silver-*` Tailwind scales (Task 2); `findBlackOverlays` / `findGoldLeaks` (Task 1).
- Produces: no new symbols.

- [ ] **Step 1: Get the batch file list**

Run: `cd client && npx tsx scripts/audit-hex.mjs --list src/pages/<area>`
Record the exact list. Work only these files.

- [ ] **Step 2: Convert each literal to a token**

Substitution table — apply by *role*, not by matching the old value:

| Old literal role | Replacement |
|---|---|
| Page/panel background | `bg-surface-base` / `bg-surface-raised` / `bg-surface-sunken` |
| Black overlay / scrim on non-tactical surface | `bg-surface-overlay` (or `bg-surface-overlay/80` if it must stay translucent) |
| Border / divider | `border-border-default` / `border-border-subtle` |
| Primary text | `text-text-primary` |
| Secondary / muted text | `text-text-secondary` / `text-text-muted` |
| Structural accent, icon, divider highlight | `text-accent-silver-500` / `border-accent-silver-600` |
| Field label | `text-[color:var(--field-label-color)]` |
| Section / panel header | `text-[color:var(--panel-header-color)]` |
| Legacy gold `#d4a017` used decoratively | `text-accent-silver-500` — **not** gold. Gold has only two roles. |
| Green / red / amber conveying state | leave alone, or map to `text-sev-ok` / `text-sev-critical` / `text-sev-warn` |

If a literal encodes severity, priority, or unit status, **leave it** — those are CAD semantics. If you cannot determine the role, leave it and note the file in the PR body rather than guessing.

> **⚠️ THE SAME HEX IS OFTEN TWO DIFFERENT ROLES. This table is a role map, not a
> find-and-replace map.** Batch 1 proved it: `AlarmTrackingPage.tsx` used
> `#0a0a0a` for the true page background (5 sites) *and* for recessed inputs and
> Cancel buttons inside raised modals (21 sites). A mechanical
> `#0a0a0a → bg-surface-base` substitution would have flattened the depth ladder
> and made every modal input look like page background. The correct result split
> that one hex across `bg-surface-base` and `bg-surface-sunken` by reading the JSX
> at each site.
>
> So for every occurrence: **open the JSX and decide what the element IS** — page,
> card, well, hover, border, label, header, icon, or value. Never map by the hex
> value alone. If a batch's conversion count exactly equals its occurrence count
> for every hex, that is a smell: it means nothing was split by role, and the
> file almost certainly had at least one hex serving two purposes.
>
> The highest-risk classification is `#d4a017` (legacy gold): label vs. header vs.
> icon vs. value are four different destinations, and only the first two may stay
> gold. Icons are silver. Values are `text-rmpg-100`.

- [ ] **Step 3: Verify the batch dropped to zero in-scope literals**

Run: `cd client && npx tsx scripts/audit-hex.mjs | grep "src/pages/<area>"`
Expected: no output — the batch no longer appears in the tally.

- [ ] **Step 4: Run the full gates**

Run: `cd client && npx tsc --noEmit && npx vitest run 2>&1 | tail -5 && npx vite build 2>&1 | tail -3`
Expected: 0 typecheck errors; all tests pass; build succeeds.

- [ ] **Step 5: Verify live**

Start the dev server via the preview tooling (never `npm run dev` in a raw shell), open each route the batch touched, and run in the page console:

```js
import('/src/utils/liveAudit.ts').then(({ findBlackOverlays, findGoldLeaks }) => {
  console.log('overlays', findBlackOverlays(document.body));
  console.log('goldLeaks', findGoldLeaks(document.body));
});
```

Expected: `overlays` empty except elements inside `.tactical-dark`; `goldLeaks` empty. Capture a before/after screenshot per route.

- [ ] **Step 6: Commit and open the PR**

```bash
git add client/src
git commit -m "$(cat <<'EOF'
fix(theme): migrate <area> hex literals to theme tokens

Converts hardcoded hex in <area> to CSS-variable-backed Tailwind tokens
so these surfaces re-theme instead of escaping the theme system.
Severity, priority, and unit-status hues are left untouched — they
encode CAD semantics, not brand chrome.

Verified: findBlackOverlays and findGoldLeaks both clean on the affected
routes outside .tactical-dark.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
gh pr create -R rmpgutah/rmpg-flex --base main --title "fix(theme): migrate <area> hex literals to theme tokens" --body "See docs/superpowers/plans/2026-07-24-ui-color-visual-repair.md Task 7.

Batch: \`src/pages/<area>\`
Literals removed: <n>
Files touched: <m>
Left in place (role unclear): <list, or 'none'>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

`-R rmpgutah/rmpg-flex` is required — without it `gh` may target a fork.

---

### Task 8: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (Styling row of the Tech Stack table; the Design tokens section)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Amend the Styling row**

In the Tech Stack table, replace the `Styling` cell describing "Blue & Silver theme" with a description of **Blue / Silver / Gold**: navy surfaces, silver structural accent, and deepened gold (`#b8912f`) restricted to field labels, section/panel headers, and map arterials. Note that red/green/amber remain reserved for severity.

- [ ] **Step 2: Amend the Design tokens section**

Add, after the existing bullet list:

```markdown
- **Gold (reintroduced 2026-07-24).** Blue & Silver is now Blue / Silver / **Gold**.
  Legacy `#d4a017` is banned: it is a hue neighbour of `--sev-warn #f59e0b`
  (decorative chrome must never read as an overdue/threshold alert) *and* it fails
  WCAG AA on navy (4.50 / 3.57 / 5.41 against base / raised / sunken).
  Gold is **split by WCAG role**, measured 2026-07-24:
  - **Text** — `--accent-gold-300 #d9bd72`, which passes AA everywhere
    (5.83 / 4.63 / 7.02). Used by `--field-label-color`, `--panel-header-color`,
    and the map's major place labels.
  - **Graphics** — `--accent-gold-500 #b8912f`, used only for map arterial lines.
    Graphical objects need 3:1 (WCAG 1.4.11) and this passes at 3.63.
    **Never use `#b8912f` for text**: it is 2.88:1 on `--surface-raised`, and
    raised panels are exactly where field labels sit.

  Gold has exactly **two** app roles, both routed through variables:
  `--field-label-color` and `--panel-header-color`. Any other gold surface is a
  defect. Gold is banned from badges, chips, status icons, and anything reporting
  a condition — static chrome cannot signal state, transient indicators can.
  Everything structural — borders, dividers, secondary text, icons, brand chrome,
  active/selected state — stays silver (`--accent-silver-*`).
- **`--brand-gold` is a compat alias that renders SILVER.** ~500 files consume the
  `brand-gold-*` Tailwind ramp expecting silver; that swap was the original theme's
  identity. Prefer `--accent-silver-*` / `--accent-gold-*` in new code.
- **Nothing color-valued belongs in `index.css`.** Colors defined there are
  theme-invariant by construction and escape the theme system. That is what made
  every panel title bar render a pure-black gradient under Blue & Silver.
- **Maps use a FIXED palette** (`MAP_PALETTE` in `client/src/utils/mapboxBasemap.ts`),
  identical across dark / tactical-dark / legacy / day: navy land, darker navy
  water, gold arterials and major place labels, silver minor roads and labels.
  This supersedes the 2026-07-07 "maps follow the active theme" decision.
- **Exactly one palette class** is stamped on `<html>`. `theme.ts` and the
  pre-paint script in `index.html` must resolve identically or the page swaps
  themes after hydration.
```

- [ ] **Step 3: Correct the stale baseline claim**

In the Testing & CI section, remove or correct the note about "12 pre-existing client typecheck errors" and "9 pre-existing client test failures" — as of 2026-07-24 both are clean (worker typecheck 0, worker vitest 246 files/2004 passed, client typecheck 0, client vitest 443 files/3101 passed). Add the worktree prerequisite: `cd client && npm install --legacy-peer-deps`, without which `tsc` reports ~97,000 phantom module errors.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: amend theme rule to Blue/Silver/Gold; correct stale test baseline

Documents the reintroduced gold accent and its two permitted roles, the
--brand-gold silver-alias trap, the "no colors in index.css" rule, the
fixed map palette, and the single-palette-class invariant.

Also corrects the recorded client baseline: the documented 12 typecheck
errors and 9 test failures are stale; all four gates are clean as of
2026-07-24.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage.** Section 1 (token layer) → Task 2. Section 2A (black overlay) → Task 1. Section 2B (chart gold) → Task 4. Section 2C (dual theme class) → Task 3. Section 3 (map palette) → Task 5. Section 4 (Class D) → Tasks 6 and 7. Section 5 (verification) → the baseline table plus gate steps in every task. E1–E4 → Task 1. E5–E6 → Task 3. `--panel-header-color` → Task 2 Step 3. CLAUDE.md amendment → Task 8.

**Gap found and closed.** The spec requires gold on section/panel headers, but defining `--panel-header-color` does nothing until a component consumes it. Task 7's substitution table routes section/panel headers to `text-[color:var(--panel-header-color)]`, and `PanelTitleBar.tsx` is in scope for whichever batch contains `src/components`. Flagged here so it is not missed: **if no batch touches `PanelTitleBar.tsx`, gold headers will not appear** — verify that file is in the Task 7 work-list.

**Type consistency.** `findBlackOverlays` / `findGoldLeaks` are named identically in Tasks 1, 6, and 7. `classifyFile` returns the same `'excluded' | 'in-scope'` union in Task 6's implementation and test. `MAP_PALETTE` keys used in `applyDark`/`applySatellite` match the frozen object and the Task 5 test. `chartSeriesColors` / `chartAxisColor` / `chartGridColor` / `chartLegendColor` / `resolveThemeColor` match between implementation, test, and Task 4 Step 5 usage. `BasemapVariant` gains `'print'` in Task 5 Step 5, consistent with the dispatch in the same step.

**Known limitation.** Task 7 is intentionally repeated per batch rather than enumerated, because the batch list does not exist until `audit-hex.mjs` runs in Task 6. Batches must come from that output, never hand-invented.
