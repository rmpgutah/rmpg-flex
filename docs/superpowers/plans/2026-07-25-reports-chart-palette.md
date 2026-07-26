# Reports Chart Palette Rebuild — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two degenerate local palettes in `ReportsPage.tsx` with validated, theme-aware scales, and correct the same class of failure on the map.

**Architecture:** Priority becomes an *ordinal* heat ramp (colorblind-safe by construction) driven by new `--chart-pri-1..4` CSS variables defined in all four theme blocks and resolved at render time by `chartPalette.ts`. Chart plot areas move onto a recessed `--surface-deep` well, which is what makes a compliant 4-step ramp geometrically possible on Blue & Silver. The incidents pie becomes sorted horizontal bars in a single color, because incident types are nominal.

**Tech Stack:** React 18 + TypeScript + Vite 6 + Tailwind, Recharts, Vitest.

**Spec:** [`docs/superpowers/specs/2026-07-25-reports-chart-palette-design.md`](../specs/2026-07-25-reports-chart-palette-design.md)

## Global Constraints

- **Never hardcode hex in `client/src/pages/`.** Colors route through CSS variables resolved at render time.
- **Three documented exceptions, all raw hex by design — do not "fix" them into `var()`:**
  1. `chartPalette.ts`'s `FALLBACKS` map — the existing convention in that file (`'--brand-blue': '#5a9ae0'`); it is the last-resort value when `getComputedStyle` fails, so it cannot itself be a variable.
  2. `statusColors.ts` / `mapMarkers.ts` — the map concat contract (`${color}22`) requires literal hex.
  3. Test files that recompute contrast — they assert against literal expected values on purpose.
- **Every new CSS variable must exist in ALL FOUR theme blocks** of `client/src/styles/theme-palettes.css`: `:root,` (night) / `html.theme-light {` / `html.theme-legacy-black {` / `html.theme-blue-silver {`.
- **Never put `var()` into `PRIORITY_HEX` or `UNIT_STATUS_HEX`.** `mapMarkers.ts` builds `${color}22`, `${color}55`, `${color}99`, `${color}b3`; `var(--x)22` is invalid CSS and fails silently.
- **Do not use `--accent-silver-*` or `--accent-gold-*`** — they exist only in the blue-silver block.
- **Radius is 2px everywhere.** Never `rounded-lg`.
- **Baseline is clean** (457 test files / 3194 tests passing). Any failure is caused by your change.
- **Run the FULL client suite before landing**, not just targeted tests.
- Fresh worktree: run `cd client && npm install --legacy-peer-deps` first, or `tsc` reports ~97,000 phantom errors.

**Final values** (generated in OKLCH, all validated — do not re-derive, copy verbatim):

| context | P1 | P2 | P3 | P4 |
|---|---|---|---|---|
| night | `#ff6b57` | `#c96e40` | `#936a48` | `#6a5c4e` |
| day | `#600200` | `#6f2c00` | `#754d2c` | `#78695c` |
| legacy-black | `#ff614d` | `#c46a3c` | `#8f6644` | `#66584a` |
| blue-silver | `#ff9483` | `#e08355` | `#a87e5b` | `#7e6f61` |
| map (`PRIORITY_HEX`) | `#ffbeb2` | `#fc9c6e` | `#c29673` | `#968778` |

---

### Task 1: Chart tokens in all four theme blocks

Adds `--chart-pri-1..4` and `--chart-plot-surface`, guarded by a test that **parses the CSS** rather than pinning literals (the existing `themeContrast.test.ts` pins a stale `#0c1a2b` and would pass regardless of the CSS — do not copy that pattern).

**Files:**
- Create: `client/src/utils/__tests__/chartTokens.test.ts`
- Modify: `client/src/styles/theme-palettes.css` (4 insertions)

**Interfaces:**
- Consumes: nothing.
- Produces: CSS custom properties `--chart-pri-1`, `--chart-pri-2`, `--chart-pri-3`, `--chart-pri-4`, `--chart-plot-surface` in all four palette blocks.

- [ ] **Step 1: Write the failing test**

Create `client/src/utils/__tests__/chartTokens.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(__dirname, '../../styles/theme-palettes.css'), 'utf8');

const BLOCKS = [
  { name: 'night', marker: ':root,' },
  { name: 'day', marker: 'html.theme-light {' },
  { name: 'legacy-black', marker: 'html.theme-legacy-black {' },
  { name: 'blue-silver', marker: 'html.theme-blue-silver {' },
];

const RAMP = ['--chart-pri-1', '--chart-pri-2', '--chart-pri-3', '--chart-pri-4'];

function blockBody(marker: string): string {
  const start = css.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('\n}', start));
}

function declared(body: string, name: string): string | null {
  const m = body.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  return m ? m[1].toLowerCase() : null;
}

// ── WCAG relative luminance / contrast ──
function srgb(c: number) { const v = c / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
function lum(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * srgb((n >> 16) & 255) + 0.7152 * srgb((n >> 8) & 255) + 0.0722 * srgb(n & 255);
}
function contrast(a: string, b: string) {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// ── OKLCH lightness (Ottosson) — only the L channel is needed ──
function oklabL(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const [R, G, B] = [srgb((n >> 16) & 255), srgb((n >> 8) & 255), srgb(n & 255)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
}

describe('chart palette tokens', () => {
  for (const block of BLOCKS) {
    const body = () => blockBody(block.marker);

    it(`${block.name} defines the full priority ramp and the plot surface`, () => {
      const b = body();
      for (const name of [...RAMP, '--chart-plot-surface']) {
        expect(b, `${block.name} is missing ${name}`).toMatch(new RegExp(`${name}\\s*:`));
      }
    });

    it(`${block.name} priority ramp clears 3:1 against its plot well`, () => {
      const b = body();
      const well = declared(b, '--chart-plot-surface')!;
      expect(well, `${block.name} --chart-plot-surface must be a literal hex`).toBeTruthy();
      for (const name of RAMP) {
        const hex = declared(b, name)!;
        expect(hex, `${block.name} ${name} must be a literal hex`).toBeTruthy();
        expect(contrast(hex, well), `${block.name} ${name} (${hex}) on ${well}`).toBeGreaterThanOrEqual(3);
      }
    });

    it(`${block.name} priority ramp is a monotone ordinal scale`, () => {
      const b = body();
      const Ls = RAMP.map((n) => oklabL(declared(b, n)!));
      const deltas = Ls.slice(1).map((L, i) => L - Ls[i]);
      // All steps move the same direction, and each gap clears the 0.06 ordinal floor.
      expect(deltas.every((d) => d < 0) || deltas.every((d) => d > 0), `${block.name} ΔL ${deltas}`).toBe(true);
      for (const d of deltas) expect(Math.abs(d), `${block.name} ΔL ${deltas}`).toBeGreaterThanOrEqual(0.06);
    });
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd client && npx vitest run src/utils/__tests__/chartTokens.test.ts
```

Expected: FAIL — 12 failures, `night is missing --chart-pri-1` etc.

- [ ] **Step 3: Add the tokens to the night block**

In `client/src/styles/theme-palettes.css`, find the unique anchor line (line ~19):

```css
  --surface-deep: #060b10;   --surface-deep-rgb: 6 11 16;
```

Insert immediately AFTER it:

```css

  /* ── Chart palette ────────────────────────────────────────────────
     --chart-pri-* is an ORDINAL heat ramp (P1 urgent → P4 routine), not a
     categorical set. Generated in OKLCH: hues 30→64° (one warm arc), chroma
     0.200→0.028 descending, lightness evenly spaced 0.075 apart, anchored so
     P4 lands just above 3:1 on --chart-plot-surface.
     Recession is carried by DESATURATION, not by luminance collapse — that is
     what lets P4 recede without dropping under the contrast floor.
     A ramp (not 4 distinct hues) is deliberate: under deuteranopia the hues
     collapse and this degrades to a pure lightness ramp, which is still
     readable. A 4-hue categorical set scored deutan ΔE 1.2 here.
     P4 stays WARM (hue ~65°), never neutral gray — a gray dot is ambiguous
     with the en-route / off-duty unit-status grays (see statusColors.ts).
     Verified by chartTokens.test.ts. Do not hand-edit one step in isolation. */
  --chart-pri-1: #ff6b57; --chart-pri-2: #c96e40;
  --chart-pri-3: #936a48; --chart-pri-4: #6a5c4e;
  --chart-plot-surface: #060b10;
```

- [ ] **Step 4: Add the tokens to the day block**

Find the unique anchor (line ~149):

```css
  --surface-deep: #c9c5b8;   --surface-deep-rgb: 201 197 184;
```

Insert immediately AFTER it:

```css

  /* Chart palette — see the night block for the full rationale. Day inverts:
     marks are DARK on a light well, so the ramp runs dark→light. */
  --chart-pri-1: #600200; --chart-pri-2: #6f2c00;
  --chart-pri-3: #754d2c; --chart-pri-4: #78695c;
  --chart-plot-surface: #c9c5b8;
```

- [ ] **Step 5: Add the tokens to the legacy-black block**

Find the unique anchor (line ~235):

```css
  --surface-deep: #000000; --surface-deep-rgb: 0 0 0;
```

Insert immediately AFTER it:

```css

  /* Chart palette — see the night block for the full rationale. */
  --chart-pri-1: #ff614d; --chart-pri-2: #c46a3c;
  --chart-pri-3: #8f6644; --chart-pri-4: #66584a;
  --chart-plot-surface: #000000;
```

- [ ] **Step 6: Add the tokens to the blue-silver block**

Find the unique anchor (line ~327):

```css
  --surface-deep: #142840;   --surface-deep-rgb: 20 40 64;
```

Insert immediately AFTER it:

```css

  /* Chart palette — see the night block for the full rationale.
     This is the DEFAULT theme and the binding case: --surface-base #22405f is a
     mid-tone, so a 3:1 floor there pins every mark into OKLCH L ∈ [0.67, 1.0] —
     too narrow for four steps. Charts draw on this recessed well instead. */
  --chart-pri-1: #ff9483; --chart-pri-2: #e08355;
  --chart-pri-3: #a87e5b; --chart-pri-4: #7e6f61;
  --chart-plot-surface: #142840;
```

- [ ] **Step 7: Run the test to verify it passes**

```bash
cd client && npx vitest run src/utils/__tests__/chartTokens.test.ts
```

Expected: PASS — 12 passed.

- [ ] **Step 8: Commit**

```bash
git add client/src/styles/theme-palettes.css client/src/utils/__tests__/chartTokens.test.ts
git commit -m "feat(theme): add validated --chart-pri-* ordinal ramp to all four theme blocks"
```

---

### Task 2: `chartPalette.ts` accessors

**Files:**
- Modify: `client/src/utils/chartPalette.ts`
- Test: `client/src/utils/__tests__/chartPalette.test.ts`

**Interfaces:**
- Consumes: the CSS variables from Task 1.
- Produces:
  - `chartPriorityColors(): string[]` — 4 entries, index 0 = P1.
  - `chartPriorityColor(priority: string | number | null | undefined): string` — accepts `'P1'`, `'1'`, or `1`; returns the P4 step for anything unrecognised.
  - `chartPlotSurface(): string`.

- [ ] **Step 1: Write the failing test**

Append to `client/src/utils/__tests__/chartPalette.test.ts` (and add the three names to the existing top import):

```ts
describe('chart priority ramp', () => {
  beforeEach(() => {
    document.documentElement.style.cssText = '';
    document.documentElement.style.setProperty('--chart-pri-1', '#ff9483');
    document.documentElement.style.setProperty('--chart-pri-2', '#e08355');
    document.documentElement.style.setProperty('--chart-pri-3', '#a87e5b');
    document.documentElement.style.setProperty('--chart-pri-4', '#7e6f61');
    document.documentElement.style.setProperty('--chart-plot-surface', '#142840');
  });

  it('returns the four ramp steps in P1..P4 order', () => {
    expect(chartPriorityColors()).toEqual(['#ff9483', '#e08355', '#a87e5b', '#7e6f61']);
  });

  it('resolves the plot surface', () => {
    expect(chartPlotSurface()).toBe('#142840');
  });

  it('accepts both the "P1" and bare "1" key shapes', () => {
    // The map's ActiveCall.priority is a bare number string while the typed
    // CallPriority is 'P1'. Both must resolve or markers silently go gray.
    expect(chartPriorityColor('P1')).toBe('#ff9483');
    expect(chartPriorityColor('1')).toBe('#ff9483');
    expect(chartPriorityColor(1)).toBe('#ff9483');
    expect(chartPriorityColor('p4')).toBe('#7e6f61');
  });

  it('falls back to the most recessive step, never to a failing color', () => {
    expect(chartPriorityColor(undefined)).toBe('#7e6f61');
    expect(chartPriorityColor('banana')).toBe('#7e6f61');
    expect(chartPriorityColor('9')).toBe('#7e6f61');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd client && npx vitest run src/utils/__tests__/chartPalette.test.ts
```

Expected: FAIL — `chartPriorityColors is not a function`.

- [ ] **Step 3: Correct the stale comment and add fallbacks**

In `client/src/utils/chartPalette.ts`, replace lines 2-4:

```ts
// Single owner of chart color decisions. Recharts takes literal color strings
// (a `var(--x)` reference is not resolved inside SVG paint attributes), so
// colors are read off <html> at call time instead of being hardcoded.
```

with:

```ts
// Single owner of chart color decisions. Colors are read off <html> at call
// time rather than hardcoded.
//
// NOTE: `var()` DOES resolve in SVG presentation attributes in current Chrome
// (verified Chrome 148: `fill="var(--x)"` computes correctly). The previous
// claim here that it does not was wrong. Resolving via getComputedStyle is
// still preferred — it keeps one owner for the decision and does not depend on
// that browser behavior.
```

Then add to the `FALLBACKS` object (blue-silver values, since that is the default theme):

```ts
  '--chart-pri-1': '#ff9483',
  '--chart-pri-2': '#e08355',
  '--chart-pri-3': '#a87e5b',
  '--chart-pri-4': '#7e6f61',
  '--chart-plot-surface': '#142840',
```

- [ ] **Step 4: Add the accessors**

Append to `client/src/utils/chartPalette.ts`:

```ts
/** Ordinal priority heat ramp, index 0 = P1 (urgent) … index 3 = P4 (routine).
 *  This is a RAMP, not a categorical set — see theme-palettes.css. */
export function chartPriorityColors(): string[] {
  return [
    themeColor('--chart-pri-1'),
    themeColor('--chart-pri-2'),
    themeColor('--chart-pri-3'),
    themeColor('--chart-pri-4'),
  ];
}

/** Ramp step for one priority. Accepts 'P1' | '1' | 1 — the typed CallPriority
 *  is 'P1' but the map's ActiveCall carries a bare number string, and a lookup
 *  that misses used to fall through to a gray that failed contrast. Unknown
 *  input returns the most recessive step, which still clears 3:1. */
export function chartPriorityColor(priority: string | number | null | undefined): string {
  const ramp = chartPriorityColors();
  const n = Number(String(priority ?? '').trim().replace(/^p/i, ''));
  return Number.isInteger(n) && n >= 1 && n <= 4 ? ramp[n - 1] : ramp[3];
}

/** Recessed plot-area surface. A mid-tone panel background compresses the legal
 *  lightness band below what a 4-step ramp needs; charts draw on this instead. */
export function chartPlotSurface(): string {
  return themeColor('--chart-plot-surface');
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd client && npx vitest run src/utils/__tests__/chartPalette.test.ts
```

Expected: PASS — all tests, including the pre-existing four.

- [ ] **Step 6: Commit**

```bash
git add client/src/utils/chartPalette.ts client/src/utils/__tests__/chartPalette.test.ts
git commit -m "feat(charts): add priority-ramp and plot-surface accessors to chartPalette"
```

---

### Task 3: ReportsPage priority charts

**Files:**
- Modify: `client/src/pages/ReportsPage.tsx` (constant ~line 109; render sites ~1226, ~1699, ~1708)

**Interfaces:**
- Consumes: `chartPriorityColor`, `chartPlotSurface` from Task 2.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Replace the constant**

Delete `PRIORITY_COLORS` (lines ~109-114):

```ts
const PRIORITY_COLORS: Record<string, string> = {
  P1: '#dc2626',
  P2: 'var(--brand-gold)',
  P3: 'var(--text-muted)',
  P4: 'var(--rmpg-500)',
};
```

It is replaced entirely by `chartPriorityColor()`. Nothing goes in its place — the
values must be resolved at render time, not captured at module scope (a module
constant is evaluated before the theme class is stamped on `<html>`).

- [ ] **Step 2: Extend the import**

Change line ~49 from:

```ts
import { chartSeriesColors } from '../utils/chartPalette';
```

to:

```ts
import { chartSeriesColors, chartPriorityColor, chartPlotSurface } from '../utils/chartPalette';
```

- [ ] **Step 3: Update the three call sites**

At ~line 1226, in `priorityChartData`:

```ts
    fill: PRIORITY_COLORS[item.priority] || 'var(--rmpg-500)',
```

becomes:

```ts
    fill: chartPriorityColor(item.priority),
```

At ~line 1699, in the Response Time by Priority data map — the same one-line change:

```ts
    fill: chartPriorityColor(item.priority),
```

At ~line 1708, the `<Cell>`:

```tsx
                      <Cell key={i} fill={PRIORITY_COLORS[item.priority] || 'var(--rmpg-500)'} />
```

becomes:

```tsx
                      <Cell key={i} fill={chartPriorityColor(item.priority)} />
```

- [ ] **Step 4: Add the recessed plot well**

Wrap only the `<ResponsiveContainer>` — not the "No data" empty state, which should stay on the panel surface.

**"Calls by Priority" panel** (~line 1582). Replace:

```tsx
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={priorityChartData}>
```

with:

```tsx
              <div className="p-2" style={{ background: chartPlotSurface() }}>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={priorityChartData}>
```

and replace the matching closing (~line 1594):

```tsx
              </ResponsiveContainer>
              )}
```

with:

```tsx
              </ResponsiveContainer>
              </div>
              )}
```

**"Response Time by Priority" panel** (~line 1694). Replace:

```tsx
              <ResponsiveContainer width="100%" height={240}>
```

with:

```tsx
              <div className="p-2" style={{ background: chartPlotSurface() }}>
              <ResponsiveContainer width="100%" height={240}>
```

and add `</div>` on the line immediately after that block's `</ResponsiveContainer>`.

The global 2px radius override applies automatically — do not add a rounded class.

- [ ] **Step 5: Verify no references remain**

```bash
cd client && grep -n "PRIORITY_COLORS" src/pages/ReportsPage.tsx
```

Expected: no output.

- [ ] **Step 6: Typecheck**

```bash
cd client && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/ReportsPage.tsx
git commit -m "fix(reports): route priority charts through the validated ordinal ramp"
```

---

### Task 4: Pie → sorted horizontal bars

Incident types are **nominal**, so coloring each slice differently double-encodes value as hue. One series → one color.

**Files:**
- Modify: `client/src/pages/ReportsPage.tsx` (imports ~18-34; `PIE_COLORS` ~107; `incidentsChartData` ~1217; JSX ~1522-1566)

**Interfaces:**
- Consumes: `chartSeriesColors`, `chartPlotSurface` from Task 2.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Delete `PIE_COLORS`**

Delete line ~107 entirely:

```ts
const PIE_COLORS = ['var(--text-muted)', 'var(--brand-gold)', 'var(--text-muted)', '#a855f7', '#22c55e', '#22c55e', 'var(--rmpg-500)', '#ec4899', '#8b5cf6'];
```

- [ ] **Step 2: Update the recharts imports**

`PieChart` and `Pie` become unused; `LabelList` is needed for the direct value labels. In the import block at lines ~18-34, remove these two lines:

```ts
  PieChart,
  Pie,
```

and add:

```ts
  LabelList,
```

- [ ] **Step 3: Rewrite the chart data**

Replace `incidentsChartData` (~line 1217):

```ts
  const incidentsChartData = (incidentsData?.by_type ?? []).map((item, i) => ({
    name: formatGroupKey(item.type),
    value: item.count,
    fill: PIE_COLORS[i % PIE_COLORS.length],
  }));
```

with:

```ts
  // Sorted descending; the bar length encodes the count and the Y axis encodes
  // the category, so color carries no information and stays constant.
  // Beyond MAX_INCIDENT_BARS the tail folds into a visible "Other" bar rather
  // than being silently dropped.
  const MAX_INCIDENT_BARS = 10;
  const incidentsSorted = [...(incidentsData?.by_type ?? [])].sort((a, b) => b.count - a.count);
  const incidentsHead = incidentsSorted.slice(0, MAX_INCIDENT_BARS);
  const incidentsTail = incidentsSorted.slice(MAX_INCIDENT_BARS);
  const incidentsChartData = [
    ...incidentsHead.map((item) => ({ name: formatGroupKey(item.type), value: item.count })),
    ...(incidentsTail.length
      ? [{ name: `Other (${incidentsTail.length})`, value: incidentsTail.reduce((s, i) => s + i.count, 0) }]
      : []),
  ];
```

- [ ] **Step 4: Replace the chart JSX**

Replace the whole block from `<div className={isMobile ? '' : 'flex items-start gap-4'}>` through its closing `</div>` (the `ResponsiveContainer` plus the adjacent legend list, ~lines 1535-1566) with:

```tsx
                <div className="p-2" style={{ background: chartPlotSurface() }}>
                  <ResponsiveContainer width="100%" height={Math.max(200, incidentsChartData.length * 26)}>
                    <BarChart
                      data={incidentsChartData}
                      layout="vertical"
                      margin={{ top: 4, right: 36, bottom: 4, left: 4 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" horizontal={false} />
                      <XAxis type="number" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={110}
                        tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                      />
                      <Tooltip {...chartTooltipStyle()} />
                      <Bar dataKey="value" fill={chartSeriesColors()[0]} radius={[0, 2, 2, 0]}>
                        <LabelList
                          dataKey="value"
                          position="right"
                          style={{ fill: 'var(--text-secondary)', fontSize: 10, fontFamily: 'monospace' }}
                        />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
```

The legend list is removed rather than reproduced — each bar now shows its own
category name (Y axis) and count (right-hand label), so a separate legend would
be a third copy of the same two facts.

- [ ] **Step 5: Verify nothing dangles**

```bash
cd client && grep -n "PIE_COLORS\|PieChart\|<Pie" src/pages/ReportsPage.tsx
```

Expected: no output.

- [ ] **Step 6: Typecheck and build**

```bash
cd client && npx tsc --noEmit && npx vite build
```

Expected: no errors; build succeeds.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/ReportsPage.tsx
git commit -m "fix(reports): replace 9-color incidents pie with sorted single-color bars"
```

---

### Task 5: Map priority colors and marker ink

Two defects here, both proven by measurement:

1. `PRIORITY_HEX` keys are `'P1'..'P4'` but `ActiveCall.priority` is a bare number string (see the `priority: '1'` fixture in `mapMarkers.test.ts`), so **the lookup misses and every call marker renders `#888888`**. Changing the hex values without fixing the key would be a no-op.
2. The marker hardcodes `color:#fff` for its `P{n}` label. White text needs fill luminance ≤ 0.183 while 3:1 against the navy land needs ≥ 0.245 — unsatisfiable. Inverting the ink resolves it.

**Files:**
- Modify: `client/src/utils/statusColors.ts` (lines 55-65)
- Modify: `client/src/pages/map/utils/mapMarkers.ts` (lines ~220-234)
- Test: `client/src/pages/map/utils/__tests__/mapMarkers.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (raw hex here by design — the concat contract forbids `var()`).
- Produces: `priorityHex(priority: string | number | null | undefined): string` exported from `statusColors.ts`; `CALL_MARKER_INK` exported from `mapMarkers.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `client/src/pages/map/utils/__tests__/mapMarkers.test.ts`, and extend the existing `../mapMarkers` import with `CALL_MARKER_INK`:

```ts
import { PRIORITY_HEX, priorityHex } from '../../../../utils/statusColors';
import { MAP_PALETTE } from '../../../../utils/mapboxBasemap';

function srgbC(c: number) { const v = c / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
function lumOf(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * srgbC((n >> 16) & 255) + 0.7152 * srgbC((n >> 8) & 255) + 0.0722 * srgbC(n & 255);
}
function ratio(a: string, b: string) {
  const [x, y] = [lumOf(a), lumOf(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

describe('map priority palette', () => {
  it('is raw 6-digit hex — the ${color}NN concat contract forbids var()', () => {
    for (const [k, v] of Object.entries(PRIORITY_HEX)) {
      expect(v, `${k} must be raw hex`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('clears 3:1 against the fixed map land', () => {
    for (const [k, v] of Object.entries(PRIORITY_HEX)) {
      expect(ratio(v, MAP_PALETTE.land), `${k} (${v}) on land`).toBeGreaterThanOrEqual(3);
    }
  });

  it('the P{n} ink clears 4.5:1 against every priority fill', () => {
    for (const [k, v] of Object.entries(PRIORITY_HEX)) {
      expect(ratio(CALL_MARKER_INK, v), `ink on ${k} (${v})`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('resolves both the "P1" and bare "1" key shapes', () => {
    expect(priorityHex('P1')).toBe(PRIORITY_HEX.P1);
    expect(priorityHex('1')).toBe(PRIORITY_HEX.P1);
    expect(priorityHex(4)).toBe(PRIORITY_HEX.P4);
    expect(priorityHex('nonsense')).toBe(PRIORITY_HEX.P4);
  });

  it('gives a call marker its real priority color, not the gray fallback', () => {
    // Regression: PRIORITY_HEX is keyed 'P1'..'P4' but ActiveCall.priority is a
    // bare number string ('1' in the fixture above), so the old direct lookup
    // always missed and every marker rendered #888888.
    // Compare through a probe element so the assertion is agnostic to how jsdom
    // normalizes a color (hex vs rgb()).
    const probe = document.createElement('div');
    probe.style.background = PRIORITY_HEX.P1;
    const el = buildCallMarkerEl(call);
    expect(el.style.background).toBe(probe.style.background);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd client && npx vitest run src/pages/map/utils/__tests__/mapMarkers.test.ts
```

Expected: FAIL — `priorityHex is not a function` / `CALL_MARKER_INK` undefined.

- [ ] **Step 3: Update `statusColors.ts`**

Replace the comment and constant at lines 55-65 with:

```ts
// Priority palette is an ORDINAL heat ramp (urgent→routine), generated in OKLCH
// against the map's FIXED navy land (#22405f) — see
// docs/superpowers/specs/2026-07-25-reports-chart-palette-design.md.
// Every step clears 3:1 on that land; the previous values did not (P1 measured
// 2.21, P4 2.01). P3/P4 stay WARM rather than reusing the unit-status grays
// (#888888 enroute / off_duty) — a gray dot was ambiguous between a
// low-priority call and an en-route/off-duty unit.
// MUST stay raw 6-digit hex: mapMarkers.ts builds `${color}22` / `99` / `b3`,
// and `var(--x)22` is invalid CSS that fails silently.
// The themed equivalent for charts is --chart-pri-* in theme-palettes.css.
export const PRIORITY_HEX: Record<string, string> = {
  P1: '#ffbeb2',
  P2: '#fc9c6e',
  P3: '#c29673',
  P4: '#968778',
};

/** Look up a priority color tolerantly. The typed CallPriority is 'P1', but the
 *  map's ActiveCall carries a bare number string ('1'), and a direct
 *  PRIORITY_HEX[...] lookup on that shape silently missed and fell through to a
 *  gray fallback. Unknown input returns the most recessive step. */
export function priorityHex(priority: string | number | null | undefined): string {
  const n = Number(String(priority ?? '').trim().replace(/^p/i, ''));
  return Number.isInteger(n) && n >= 1 && n <= 4 ? PRIORITY_HEX[`P${n}`] : PRIORITY_HEX.P4;
}
```

- [ ] **Step 4: Update `mapMarkers.ts`**

Add the ink constant near the top of the file, after the imports:

```ts
/** Ink for the marker's P{n} label. The fills are light (they must clear 3:1
 *  against the navy land), so the label is dark: with white ink the fill would
 *  need luminance <= 0.183 for 4.5:1 text AND >= 0.245 for 3:1 vs land, which
 *  is unsatisfiable. Measured >= 5.27:1 on every PRIORITY_HEX step. */
export const CALL_MARKER_INK = '#0d1520';
```

Change the import of `PRIORITY_COLORS` usage inside `buildCallMarkerEl` (line ~221) from:

```ts
  const color = PRIORITY_COLORS[call.priority] || '#888888';
```

to:

```ts
  const color = priorityHex(call.priority);
```

`priorityHex` has to reach `mapMarkers.ts`, which imports from `./mapConstants`, not from `statusColors` directly. `mapConstants.ts` imports on line 6 and re-exports on line 9 as two separate statements — extend both.

Line 6 becomes:

```ts
import { UNIT_STATUS_HEX, UNIT_STATUS_ABBREV, PRIORITY_HEX, priorityHex } from '../../../utils/statusColors';
```

Line 9 becomes:

```ts
export { UNIT_STATUS_HEX as UNIT_STATUS_COLORS, UNIT_STATUS_ABBREV as UNIT_STATUS_LABELS, PRIORITY_HEX as PRIORITY_COLORS, priorityHex };
```

Then `mapMarkers.ts` line 2 becomes:

```ts
import { UNIT_STATUS_COLORS, UNIT_STATUS_LABELS, PRIORITY_COLORS, priorityHex } from './mapConstants';
```

`PRIORITY_COLORS` stays in that import — `buildCallPopupHtml` and the clustering path still use it.

Finally change the label ink (line ~233):

```ts
  inner.style.cssText = `transform:rotate(-45deg);font-size:8px;font-weight:700;color:#fff;font-family:ui-monospace,monospace;`;
```

to:

```ts
  inner.style.cssText = `transform:rotate(-45deg);font-size:8px;font-weight:700;color:${CALL_MARKER_INK};font-family:ui-monospace,monospace;`;
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd client && npx vitest run src/pages/map/utils/__tests__/mapMarkers.test.ts
```

Expected: PASS, including the pre-existing `el.textContent === 'P1'` assertion.

- [ ] **Step 6: Commit**

```bash
git add client/src/utils/statusColors.ts client/src/pages/map/utils/mapMarkers.ts client/src/pages/map/utils/mapConstants.ts client/src/pages/map/utils/__tests__/mapMarkers.test.ts
git commit -m "fix(map): correct priority marker contrast, ink, and the missed key lookup"
```

---

### Task 6: Full-suite verification

A red test hid behind green targeted runs for four tasks during the 2026-07-24 sweep. The full suite is the gate.

**Files:** none modified unless a failure is found.

- [ ] **Step 1: Worker typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 2: Client typecheck**

```bash
cd client && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Full client suite**

```bash
cd client && npx vitest run
```

Expected: 458 test files / 3210+ tests passing, 0 failures. Baseline was 457 files / 3194 tests; this plan adds one file (Task 1) and cases to two existing files.

Any failure is caused by this change — baseline is clean. Investigate, do not re-run hoping.

- [ ] **Step 4: Production build**

```bash
cd client && npx vite build
```

Expected: build succeeds.

- [ ] **Step 5: Confirm the new tokens reach the bundle**

A Tailwind/CSS token that never lands in the built stylesheet silently does nothing (`bg-surface-hover` was used 14× while emitting no CSS).

```bash
cd client && grep -c -- "--chart-pri-1" dist/assets/*.css
```

Expected: at least 4 (one per theme block).

- [ ] **Step 6: Commit any fixes**

```bash
git add -A && git commit -m "test: verify chart palette rebuild against the full suite"
```

---

## Self-Review

**Spec coverage:**

| spec section | task |
|---|---|
| §3.1 recessed plot well | Task 1 (`--chart-plot-surface`), Tasks 3-4 (applied) |
| §3.2 ordinal ramp values | Task 1 |
| §3.3 token surface + `chartPalette.ts`, stale-comment correction | Tasks 1, 2 |
| §3.4 pie → sorted bars, `PIE_COLORS` deleted | Task 4 |
| §3.5 map hex + marker ink | Task 5 |
| §3.6 CSS-parsing validation test (assertions 1-6) | Task 1 (1-3), Task 5 (4-6) |
| §5 verification | Task 6 |

**Deviation from spec, deliberate:** Task 4 adds a top-10 + visible "Other" fold. The spec did not specify a cap; unbounded rows would make the panel grow without limit inside a 2-column grid. The fold is explicit (labeled with its count), not a silent truncation.

**Not covered, by design:** spec §4 out-of-scope items (`UNIT_STATUS_HEX.off_duty` invalid-concat bug; `themeContrast.test.ts` stale constant) have no task.
