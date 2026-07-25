# Tailwind Text-Ramp Contrast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route 4,796 sub-AA Tailwind label utilities off the `--rmpg-*` elevation ramp onto foreground-role tokens, and add the guard that stops the surface from regrowing.

**Architecture:** Add a `fg` color scale to Tailwind bound to new `--text-*-rgb` triples; lift `--text-muted` in the blue-silver block so it is itself a legal AA target; migrate call sites by semantic role in seven directory batches; pin the residual count with a ratchet test.

**Tech Stack:** Tailwind CSS 3 (`client/tailwind.config.js`), CSS custom properties (`client/src/styles/theme-palettes.css`), Vitest, Vite 6, React 18 + TypeScript.

**Spec:** [`docs/superpowers/specs/2026-07-25-tailwind-text-ramp-contrast-design.md`](../specs/2026-07-25-tailwind-text-ramp-contrast-design.md)

**Base:** `origin/main` @ `ec6eba539c` (#3032). Re-measured after that merge — every count below is unchanged, because #3032 touched only the inline `var(--rmpg-N)` path.

### Relationship to #3032

#3032 landed `describe('the --rmpg-* ramp is never used as a text colour')` in `accentTokens.test.ts:212`. **It is a sibling of this program's guard, not a duplicate.** It matches four *inline* patterns — `color:`, `.style.color =`, `WebkitTextFillColor`, and `text:` role keys — all against `var(--rmpg-N)`. It cannot see a Tailwind class: `className="text-rmpg-500"` matches none of its regexes. It also asserts `toEqual([])`, which is right for the inline path (fully cleaned) and impossible for this one (6,318 tier-2 sites remain), so this program ratchets instead.

Place the Task 6 ratchet immediately after that block so the two read as one policy.

### Relationship to the `:root`-is-the-base-layer rule

#3032's spec establishes that `:root` is the **base layer**, not a fourth peer block — the night selector is `:root, html.theme-dark, .tactical-dark`, and `:root` is `<html>`, the same element the theme class is stamped on. So a var declared only in the night block resolves under every theme, and a guard asserting "declared in all four blocks" **false-positives** on deliberately theme-invariant vars like `--stat-accent-*`.

That rule does not conflict with Task 3. `--text-primary/secondary/muted` carry a **different value per theme** (`#e6edf5` / `#1a1a1a` / `#f2f2f2` / `#f0f4f9`), so base-only membership would be wrong for them — every block genuinely must redeclare. All-four is the correct assertion *for these specific tokens*, and Task 3's test says so in a comment rather than restating the general rule.

---

## Global Constraints

Every task inherits these. Copied verbatim from the spec and CLAUDE.md.

- **Never hardcode hex in a component.** Colors come from CSS-variable-backed Tailwind tokens.
- **Every role variable must be defined in all FOUR theme blocks** of `client/src/styles/theme-palettes.css` — `:root, html.theme-dark, .tactical-dark` / `html.theme-light` / `html.theme-legacy-black` / `html.theme-blue-silver`. A var consumed as `text-[color:var(--x)]` silently drops the color when the active block omits it.
- **For `-rgb` triples there is a FIFTH location:** the `@media print` block at `client/src/index.css:3308`. It already overrides five `--surface-*-rgb` channels for exactly this reason.
- **Per-block, never hoisted.** `.tactical-dark` is a *descendant* class that re-declares triples to force night on map/MDT/dashcam. A hoisted `:root` alias substitutes at computed-value time on the root element and the already-substituted result inherits, so a descendant could never override it.
- **Severity hues are untouchable.** Red / green / amber / orange / purple encode fixed CAD semantics and are never repurposed to fix contrast.
- **Gold has exactly two roles** — `--field-label-color` and `--panel-header-color`. Never write a raw `text-accent-gold-*` class in a component.
- **Radius is 2px everywhere.** Never `rounded-lg`.
- **Run the FULL client suite per batch**, never targeted tests only. A red test hid behind green targeted runs for four tasks during the 2026-07-24 sweep.
- **`main` is protected.** PR + passing checks, never direct push.

### Migration classification table

Applies to every migration task (Tasks 8–14). This is a role decision per element — **open the JSX and decide what the element IS**. Not a codemod.

| What the element is | Target |
|---|---|
| Field key, caption, helper text, timestamp, de-emphasized label | `text-fg-muted` |
| Sub-heading, active/selected row text, a *value* rather than its label | `text-fg-secondary` |
| Decorative divider or chrome glyph conveying no state | leave on the ramp — it is not text |
| Placeholder | `placeholder-fg-muted` |
| Disabled control text | leave; WCAG 1.4.3 exempts disabled controls |
| Anything under `.tactical-dark` | measure against *that* surface, not blue-silver |
| Numeric metric value | `text-rmpg-100` — data, not a label |

**Smell test:** if a file's converted count equals its occurrence count, nothing was split by role and something was missed.

**Known traps:**
- A `fill` carrying `fontSize`/`fontFamily` **is text** — recharts renders `tick={{ fill, fontSize: 9 }}` as an SVG `<text>`.
- `` `${color}22` `` alpha concatenation can never take a `var()` — `var(--rmpg-500)22` is invalid and the declaration drops silently. Sites feeding a hex into string concatenation stay raw hex.
- State variants must carry the prefix: `hover:text-rmpg-500` → `hover:text-fg-muted`, not `text-fg-muted`.

### Verification command (every task)

```bash
cd client && npx tsc --noEmit && npx vitest run && npx vite build
```

Baseline on `4b6996244c` is clean — worker typecheck 0, client typecheck 0, client vitest green. **Any failure is caused by your change.**

Fresh worktree prerequisite, once:

```bash
cd client && npm install --legacy-peer-deps
```

---

## File Structure

**PR 0 — mechanism (Tasks 1–7).** No call-site changes.

| File | Responsibility | Action |
|---|---|---|
| `client/src/utils/__tests__/themeContrast.test.ts` | AA matrix guard; parses the CSS instead of hardcoding | Rewrite |
| `client/src/styles/theme-palettes.css` | Palette source of truth; gains `--text-*-rgb` in 4 blocks, lifts blue-silver `--text-muted` | Modify |
| `client/src/index.css` | `@media print` block gains the 3 `--text-*-rgb` overrides | Modify `:3326`–`3332` |
| `client/tailwind.config.js` | Gains the `fg` color scale | Modify |
| `client/src/utils/chartPalette.ts` | `--text-muted` resolve fallback, kept in lockstep | Modify `:20`, `:34` |
| `client/src/utils/__tests__/chartPalette.test.ts` | Pins that fallback | Modify `:12`–`:13` |
| `client/src/utils/__tests__/accentTokens.test.ts` | Gains theme-block completeness for the triples, the Tailwind config assertion, and the ratchet | Modify |

**PRs 1–7 — migration (Tasks 8–14).** Only `.tsx`/`.ts` call sites plus the ratchet pin.

---

## Task 1: Rewrite the contrast guard to parse the CSS

The existing test pins blue-silver `surfaceBase` as `[12, 26, 43]` (`#0c1a2b`). The live value is `#22405f`. The stale value is darker, so every assertion passes with inflated headroom against a surface the app has not used since #2661/#3006. Hardcoding *is* the defect — a hardcoded guard cannot notice a palette change.

**Files:**
- Rewrite: `client/src/utils/__tests__/themeContrast.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `THEME_BLOCKS` (exported const, `{ name: string; marker: string }[]`) and helpers `blockOf(marker: string): string`, `channels(block: string, name: string): [number, number, number]`, `ratio(a: number[], b: number[]): number` — Task 3 and Task 6 reuse the `channels` resolver contract (accepts either a `#rrggbb` literal or an `-rgb` triple).

- [ ] **Step 1: Write the failing test**

Replace the entire contents of `client/src/utils/__tests__/themeContrast.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(
  resolve(__dirname, '../../styles/theme-palettes.css'),
  'utf8',
);

// WCAG 2.1 relative luminance + contrast ratio.
function lum([r, g, b]: number[]): number {
  const f = (c: number) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function ratio(a: number[], b: number[]): number {
  const L1 = lum(a);
  const L2 = lum(b);
  const [hi, lo] = L1 >= L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}

// The four palette blocks. Markers match the convention already used by
// accentTokens.test.ts's `theme-block completeness` block -- ':root,' for night,
// since ':root' is the BASE layer and the true start of that rule.
export const THEME_BLOCKS = [
  { name: 'night (:root / theme-dark / tactical-dark)', marker: ':root,' },
  { name: 'day (theme-light)', marker: 'html.theme-light {' },
  { name: 'legacy-black', marker: 'html.theme-legacy-black {' },
  { name: 'blue-silver (default)', marker: 'html.theme-blue-silver {' },
];

export function blockOf(marker: string): string {
  const start = css.indexOf(marker);
  if (start < 0) throw new Error(`theme-palettes.css: no block matching ${marker}`);
  const end = css.indexOf('\n}', start);
  if (end < 0) throw new Error(`theme-palettes.css: unterminated block ${marker}`);
  return css.slice(start, end);
}

// Resolve a token to RGB channels. Accepts either an `-rgb` triple (preferred,
// what Tailwind consumes) or a `#rrggbb` literal, so this survives Task 3
// converting the bare vars over to triples.
export function channels(block: string, name: string): [number, number, number] {
  const triple = block.match(
    new RegExp(`--${name}-rgb:\\s*(\\d{1,3})\\s+(\\d{1,3})\\s+(\\d{1,3})`),
  );
  if (triple) return [Number(triple[1]), Number(triple[2]), Number(triple[3])];

  const hex = block.match(new RegExp(`--${name}:\\s*#([0-9a-fA-F]{6})`));
  if (hex) {
    const h = hex[1];
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  }
  throw new Error(`theme-palettes.css: cannot resolve --${name} in this block`);
}

const TEXT_ROLES = ['text-primary', 'text-secondary', 'text-muted'];
const SURFACES = ['surface-base', 'surface-raised', 'surface-sunken'];

describe('theme contrast (WCAG AA, 4.5:1)', () => {
  // The affected labels are 8-11px. WCAG 1.4.3's 3:1 allowance is for LARGE
  // text only (18pt / 14pt bold); it does not apply here.
  for (const { name, marker } of THEME_BLOCKS) {
    describe(name, () => {
      const block = blockOf(marker);

      for (const role of TEXT_ROLES) {
        for (const surface of SURFACES) {
          it(`--${role} on --${surface} >= 4.5:1`, () => {
            const r = ratio(channels(block, role), channels(block, surface));
            expect(
              Number(r.toFixed(2)),
              `--${role} on --${surface} in ${name}`,
            ).toBeGreaterThanOrEqual(4.5);
          });
        }
      }
    });
  }
});

describe('contrast guard integrity', () => {
  it('reads the live surface, not the retired #0c1a2b', () => {
    // themeClassStamp.test.ts and themeBlueSilver.test.ts already had to correct
    // this same stale value. Pinning it here is what let 4,796 sub-AA labels ship.
    expect(css).not.toContain('#0c1a2b');
    expect(blockOf('html.theme-blue-silver {')).toContain('--surface-base: #22405f');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd client && npx vitest run src/utils/__tests__/themeContrast.test.ts
```

Expected: **FAIL**, exactly one assertion —
`blue-silver (default) > --text-muted on --surface-raised >= 4.5:1`,
`expected 3.81 to be greater than or equal to 4.5`.

All 35 other combinations pass. If anything else fails, stop — the resolver is wrong, not the palette.

- [ ] **Step 3: Commit the red test**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/vigorous-euler-8bffb4"
git add client/src/utils/__tests__/themeContrast.test.ts
git commit -m "test(theme): make the contrast guard read the live palette

It pinned blue-silver surfaceBase as #0c1a2b; the live value is #22405f.
The stale value is darker, so every assertion passed with inflated headroom
against a surface retired in #2661/#3006.

Now red on the one real failure: --text-muted is 3.81:1 on --surface-raised."
```

---

## Task 2: Lift `--text-muted` in the blue-silver block

At `#9bb0c7` the muted role is itself below AA on panel surfaces, so it is not a legal migration target. `#b1c1d3` is the same hue scaled 22% toward white, giving **4.62:1** — deliberately matching the headroom `--accent-gold-300` was tuned to on the same surface (4.63), so the gold and silver label roles stay balanced.

**Files:**
- Modify: `client/src/styles/theme-palettes.css:333`
- Modify: `client/src/utils/chartPalette.ts:20`, `:34`
- Modify: `client/src/utils/__tests__/chartPalette.test.ts:12-13`

**Interfaces:**
- Consumes: the AA matrix from Task 1.
- Produces: blue-silver `--text-muted` = `#b1c1d3` (`177 193 211`). Task 3 converts this line to a triple.

- [ ] **Step 1: Lift the palette value**

In `client/src/styles/theme-palettes.css`, line 333 currently reads:

```css
  --text-primary: #f0f4f9; --text-secondary: #cdd8e6; --text-muted: #9bb0c7;
```

Change to:

```css
  --text-primary: #f0f4f9; --text-secondary: #cdd8e6; --text-muted: #b1c1d3;
```

**Only the blue-silver block.** Lines 21, 151 and 237 stay as they are — those blocks already score 5.70–7.46 and changing them would be change for its own sake.

- [ ] **Step 2: Run the guard to verify it passes**

```bash
cd client && npx vitest run src/utils/__tests__/themeContrast.test.ts
```

Expected: **PASS**, 37 tests. Worst case is now blue-silver muted-on-raised at 4.62.

- [ ] **Step 3: Sync the chartPalette fallback**

`client/src/utils/chartPalette.ts` hardcodes the old value twice. Line 20:

```ts
  '--text-muted': '#9bb0c7',
```

becomes:

```ts
  '--text-muted': '#b1c1d3',
```

and line 34:

```ts
  return resolveThemeColor(varName, FALLBACKS[varName] ?? '#9bb0c7');
```

becomes:

```ts
  return resolveThemeColor(varName, FALLBACKS[varName] ?? '#b1c1d3');
```

Without this, charts keep the old value whenever the var fails to resolve.

- [ ] **Step 4: Update the test that pins the fallback**

`client/src/utils/__tests__/chartPalette.test.ts` lines 12–13:

```ts
    document.documentElement.style.setProperty('--text-muted', '#9bb0c7');
    expect(resolveThemeColor('--text-muted', '#000')).toBe('#9bb0c7');
```

become:

```ts
    document.documentElement.style.setProperty('--text-muted', '#b1c1d3');
    expect(resolveThemeColor('--text-muted', '#000')).toBe('#b1c1d3');
```

- [ ] **Step 5: Run the full client suite**

```bash
cd client && npx tsc --noEmit && npx vitest run && npx vite build
```

Expected: all green. If another test pins `#9bb0c7`, it was missed — grep for it and fix in this commit:

```bash
cd client && grep -rn "9bb0c7" src
```

- [ ] **Step 6: Commit**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/vigorous-euler-8bffb4"
git add client/src/styles/theme-palettes.css client/src/utils/chartPalette.ts \
        client/src/utils/__tests__/chartPalette.test.ts
git commit -m "fix(theme): lift blue-silver --text-muted to a legal AA target

#9bb0c7 is 3.81:1 on --surface-raised, so the muted role could not be the
target of a contrast migration. #b1c1d3 gives 4.62:1, matching the headroom
--accent-gold-300 was tuned to on the same surface.

Blue-silver only; the other three blocks already score 5.70-7.46.
chartPalette's hardcoded fallback moves in lockstep."
```

---

## Task 3: Add `--text-*-rgb` triples to all four theme blocks

Tailwind needs channel triples to support `<alpha-value>`; plain `var(--text-muted)` would break the one existing opacity modifier. Re-pointing each bare var at its own triple gives one source per block, so the 233 inline `var(--text-muted)` consumers and the new Tailwind class cannot drift.

**Files:**
- Modify: `client/src/styles/theme-palettes.css:21`, `:151`, `:237`, `:333`
- Modify: `client/src/utils/__tests__/accentTokens.test.ts`

**Interfaces:**
- Consumes: `THEME_BLOCKS`, `blockOf`, `channels` from Task 1.
- Produces: `--text-primary-rgb`, `--text-secondary-rgb`, `--text-muted-rgb` in all four blocks. Task 5's Tailwind scale binds to these names.

- [ ] **Step 1: Write the failing test**

Append to `client/src/utils/__tests__/accentTokens.test.ts`:

```ts
describe('text-role rgb triples', () => {
  // Tailwind consumes rgb(var(--x-rgb) / <alpha-value>). A missing triple in
  // ANY block makes text-fg-* resolve to nothing there. Same failure mode the
  // bare --rmpg-* aliases had before #3029.
  // All four blocks must redeclare these. That is NOT the general rule -- ':root'
  // is the base layer, so a base-only var resolves everywhere and an
  // "all four blocks" assertion false-positives on theme-invariant tokens like
  // --stat-accent-* (see #3032's spec). It holds HERE because --text-* carries a
  // different value per theme (#e6edf5 / #1a1a1a / #f2f2f2 / #f0f4f9), so
  // base-only membership would leave three themes with the night value.
  const BLOCKS = [
    { name: 'night', marker: ':root,', triples: {
      'text-primary': '230 237 245',
      'text-secondary': '195 208 222',
      'text-muted': '143 163 184',
    } },
    { name: 'day', marker: 'html.theme-light {', triples: {
      'text-primary': '26 26 26',
      'text-secondary': '51 49 43',
      'text-muted': '85 85 85',
    } },
    { name: 'legacy-black', marker: 'html.theme-legacy-black {', triples: {
      'text-primary': '242 242 242',
      'text-secondary': '207 207 207',
      'text-muted': '138 138 138',
    } },
    { name: 'blue-silver', marker: 'html.theme-blue-silver {', triples: {
      'text-primary': '240 244 249',
      'text-secondary': '205 216 230',
      'text-muted': '177 193 211',
    } },
  ];

  for (const { name, marker } of BLOCKS) {
    const start = css.indexOf(marker);
    const block = css.slice(start, css.indexOf('\n}', start));

    for (const role of ['text-primary', 'text-secondary', 'text-muted']) {
      it(`${name} defines --${role}-rgb`, () => {
        expect(block).toMatch(new RegExp(`--${role}-rgb:\\s*\\d+ \\d+ \\d+`));
      });

      it(`${name} re-points --${role} at its own triple`, () => {
        expect(block).toContain(`--${role}: rgb(var(--${role}-rgb))`);
      });
    }
  }

  it('carries the exact channel values, per block', () => {
    for (const { name, marker, triples } of BLOCKS) {
      const start = css.indexOf(marker);
      const block = css.slice(start, css.indexOf('\n}', start));
      for (const [role, value] of Object.entries(triples)) {
        expect(block, `${name} --${role}-rgb`).toContain(`--${role}-rgb: ${value}`);
      }
    }
  });

  it('repeats the triples per block rather than hoisting them', () => {
    // .tactical-dark is a DESCENDANT that re-declares triples to force night on
    // map / MDT / dashcam. A hoisted :root alias substitutes at computed-value
    // time on the root element and the substituted result inherits, so a
    // descendant could never override it. Proven in-browser during #3029.
    const count = (css.match(/--text-muted-rgb:/g) ?? []).length;
    expect(count).toBe(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd client && npx vitest run src/utils/__tests__/accentTokens.test.ts
```

Expected: **FAIL**, 25 failures — 24 from the per-block loop (4 blocks × 3 roles × 2 assertions) plus the exact-values test. The hoist test fails too (0 ≠ 4). Nothing defines these triples yet.

- [ ] **Step 3: Add the triples**

In `client/src/styles/theme-palettes.css`, replace each of the four `--text-*` lines.

Line 21 (night block):

```css
  --text-primary-rgb: 230 237 245; --text-primary: rgb(var(--text-primary-rgb));
  --text-secondary-rgb: 195 208 222; --text-secondary: rgb(var(--text-secondary-rgb));
  --text-muted-rgb: 143 163 184; --text-muted: rgb(var(--text-muted-rgb));
```

Line 151 (day block):

```css
  --text-primary-rgb: 26 26 26; --text-primary: rgb(var(--text-primary-rgb));
  --text-secondary-rgb: 51 49 43; --text-secondary: rgb(var(--text-secondary-rgb));
  --text-muted-rgb: 85 85 85; --text-muted: rgb(var(--text-muted-rgb));
```

Line 237 (legacy-black block):

```css
  --text-primary-rgb: 242 242 242; --text-primary: rgb(var(--text-primary-rgb));
  --text-secondary-rgb: 207 207 207; --text-secondary: rgb(var(--text-secondary-rgb));
  --text-muted-rgb: 138 138 138; --text-muted: rgb(var(--text-muted-rgb));
```

Line 333 (blue-silver block — note the lifted muted value from Task 2):

```css
  --text-primary-rgb: 240 244 249; --text-primary: rgb(var(--text-primary-rgb));
  --text-secondary-rgb: 205 216 230; --text-secondary: rgb(var(--text-secondary-rgb));
  --text-muted-rgb: 177 193 211; --text-muted: rgb(var(--text-muted-rgb));
```

Every triple except blue-silver's `--text-muted-rgb` restates the hex already present. Verify none drifted:

```bash
cd client && grep -c -- "--text-muted-rgb:" src/styles/theme-palettes.css   # expect 4
```

- [ ] **Step 4: Run the full client suite**

```bash
cd client && npx tsc --noEmit && npx vitest run && npx vite build
```

Expected: all green. `themeContrast.test.ts` still passes — its `channels()` resolver prefers the triple and now reads the new form.

- [ ] **Step 5: Commit**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/vigorous-euler-8bffb4"
git add client/src/styles/theme-palettes.css client/src/utils/__tests__/accentTokens.test.ts
git commit -m "feat(theme): define --text-*-rgb triples in all four palette blocks

Tailwind consumes rgb(var(--x-rgb) / <alpha-value>); a bare var() would break
the alpha modifier. Each bare var now re-points at its own triple so the 233
inline var(--text-muted) consumers and the coming text-fg-* class share one
source per block and cannot drift.

Per-block, not hoisted: .tactical-dark is a descendant and must still win."
```

---

## Task 4: Extend the `@media print` block

The print block already overrides five `--surface-*-rgb` channels, with a comment explaining that Tailwind token classes would otherwise "print dark on white." It overrides **zero** `--text-*-rgb` channels because none existed. Skip this and every migrated label prints light grey on white paper.

**Files:**
- Modify: `client/src/index.css` (insert after line 3332)
- Modify: `client/src/utils/__tests__/accentTokens.test.ts`

**Interfaces:**
- Consumes: the triple names from Task 3.
- Produces: print-context overrides. Nothing downstream consumes these.

- [ ] **Step 1: Write the failing test**

Append to `client/src/utils/__tests__/accentTokens.test.ts`:

```ts
describe('print stylesheet text channels', () => {
  // index.css:3308 is a @media print block that flips surfaces to white and
  // text to near-black with !important. It already overrides the five
  // --surface-*-rgb channels because Tailwind token classes would otherwise
  // print dark on white. The text channels need the same treatment or every
  // text-fg-* label prints light grey on paper. This is a FIFTH theme context
  // beyond the four palette blocks.
  const indexCss = readFileSync(resolve(SRC_DIR, 'index.css'), 'utf8');

  const EXPECTED = {
    'text-primary': '17 17 17',
    'text-secondary': '51 51 51',
    'text-muted': '102 102 102',
  };

  for (const [role, value] of Object.entries(EXPECTED)) {
    it(`overrides --${role}-rgb for print`, () => {
      expect(indexCss).toContain(`--${role}-rgb: ${value} !important;`);
    });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd client && npx vitest run src/utils/__tests__/accentTokens.test.ts -t "print stylesheet"
```

Expected: **FAIL**, 3 failures — no `--text-*-rgb` override exists in `index.css`.

- [ ] **Step 3: Add the overrides**

In `client/src/index.css`, the print block currently reads (lines 3327–3333):

```css
    /* Surface channels — all white for print */
    --surface-base-rgb: 255 255 255 !important;
    --surface-raised-rgb: 255 255 255 !important;
    --surface-sunken-rgb: 255 255 255 !important;
    --surface-overlay-rgb: 255 255 255 !important;
    --surface-deep-rgb: 255 255 255 !important;
```

Insert immediately after the `--surface-deep-rgb` line:

```css

    /* Text channels — dark ink on paper. Mirrors the --text-* hex overrides
       above; without these, every text-fg-* label prints its SCREEN value. */
    --text-primary-rgb: 17 17 17 !important;
    --text-secondary-rgb: 51 51 51 !important;
    --text-muted-rgb: 102 102 102 !important;
```

The channel values match the `--text-*` hex overrides already at lines 3317–3319 (`#111111`, `#333333`, `#666666`).

- [ ] **Step 4: Run the full client suite**

```bash
cd client && npx tsc --noEmit && npx vitest run && npx vite build
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/vigorous-euler-8bffb4"
git add client/src/index.css client/src/utils/__tests__/accentTokens.test.ts
git commit -m "fix(print): override --text-*-rgb so migrated labels print as ink

The @media print block already overrides five --surface-*-rgb channels
because Tailwind token classes would otherwise print dark on white. It had
no --text-*-rgb overrides, so every coming text-fg-* label would have
printed its screen value: light grey on white paper.

A -rgb triple has FIVE homes, not four."
```

---

## Task 5: Add the `fg` scale to Tailwind

**Files:**
- Modify: `client/tailwind.config.js`
- Modify: `client/src/utils/__tests__/accentTokens.test.ts`

**Interfaces:**
- Consumes: the triple names from Task 3.
- Produces: utilities `text-fg`, `text-fg-primary`, `text-fg-secondary`, `text-fg-muted`, `placeholder-fg-muted`. Tasks 8–14 consume these.

- [ ] **Step 1: Write the failing test**

Append to `client/src/utils/__tests__/accentTokens.test.ts`:

```ts
describe('fg Tailwind scale', () => {
  // Verified at the CONFIG level, not by grepping dist/. Tailwind is
  // content-scanned, so text-fg-muted only reaches dist/assets/*.css once a
  // call site uses it -- and PR 0 changes zero call sites. The emitted-CSS
  // check belongs in the first migration batch. Getting this backwards is the
  // bg-surface-hover trap: used 14x, emitted never, silently inert.
  const cfg = readFileSync(resolve(SRC_DIR, '../tailwind.config.js'), 'utf8');

  it('binds every fg step to a text-role triple', () => {
    for (const [step, role] of [
      ['DEFAULT', 'text-primary'],
      ['primary', 'text-primary'],
      ['secondary', 'text-secondary'],
      ['muted', 'text-muted'],
    ]) {
      expect(cfg).toContain(`${step}: 'rgb(var(--${role}-rgb) / <alpha-value>)'`);
    }
  });

  it('does not collide with a fontSize key', () => {
    // text-<key> resolves fontSize first. `label` IS a fontSize key, which is
    // why a `label` COLOR token must never be introduced -- text-label would
    // become ambiguous. `fg` is free.
    const fontSizeKeys = ['micro', 'label', 'caption', 'body-sm', 'body', 'title', 'heading', 'display'];
    expect(fontSizeKeys).not.toContain('fg');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd client && npx vitest run src/utils/__tests__/accentTokens.test.ts -t "fg Tailwind scale"
```

Expected: **FAIL** on the first test — no `fg` key exists in the config.

- [ ] **Step 3: Add the scale**

In `client/tailwind.config.js`, inside `theme.extend.colors`, insert immediately after the closing brace of the `'accent-silver'` block and before the `// Neutral graphite greys` comment:

```js
        // ── Foreground roles ───────────────────────────────
        // The rmpg ramp encodes surface ELEVATION and inverts between themes
        // (blue-silver --rmpg-300 is `157 175 194`, day is `70 70 70`), so it
        // is not a text scale. These are: they do not invert, and every step
        // clears WCAG AA 4.5:1 on base/raised/sunken in all four blocks.
        fg: {
          DEFAULT:   'rgb(var(--text-primary-rgb) / <alpha-value>)',
          primary:   'rgb(var(--text-primary-rgb) / <alpha-value>)',
          secondary: 'rgb(var(--text-secondary-rgb) / <alpha-value>)',
          muted:     'rgb(var(--text-muted-rgb) / <alpha-value>)',
        },
```

- [ ] **Step 4: Run the full client suite**

```bash
cd client && npx tsc --noEmit && npx vitest run && npx vite build
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/vigorous-euler-8bffb4"
git add client/tailwind.config.js client/src/utils/__tests__/accentTokens.test.ts
git commit -m "feat(theme): add the fg foreground-role scale to Tailwind

Gives text-fg-muted / text-fg-secondary / placeholder-fg-muted, bound to the
--text-*-rgb triples so <alpha-value> keeps working. Follows the existing
role-group naming (surface-base, border-strong); a top-level 'muted' key
would generate an ambiguous bg-muted.

Config-level assertion only -- Tailwind is content-scanned, so the class
cannot reach dist/ until a call site uses it in PR 1."
```

---

## Task 6: Add the ratchet

**Files:**
- Modify: `client/src/utils/__tests__/accentTokens.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `PIN` constant in the ratchet block. Tasks 8–14 each lower it.

- [ ] **Step 1: Write the test**

Insert into `client/src/utils/__tests__/accentTokens.test.ts` **immediately after** the `describe('the --rmpg-* ramp is never used as a text colour')` block that #3032 landed at line 212. The two are one policy split across two consumption paths — that one catches inline `var(--rmpg-N)` and demands zero; this one catches Tailwind utilities and ratchets. Adjacency is how the next reader learns both exist.

```ts
describe('rmpg text-ramp ratchet (Tailwind utility path)', () => {
  // Sibling to the block above. That guard matches four INLINE patterns against
  // var(--rmpg-N) -- color:, .style.color =, WebkitTextFillColor, and `text:`
  // role keys -- and none of them can see className="text-rmpg-500". This is the
  // utility half of the same defect.
  // The rmpg ramp is not a text scale. Steps 300-600 are all below WCAG AA on
  // blue-silver panel surfaces (300: 3.77, 400: 2.75, 500: 1.82, 600: 1.18 on
  // --surface-raised). This is a RATCHET over pre-existing debt: the count may
  // only go down, and the pin must be lowered whenever it does.
  //
  //   PR 0 (nothing migrated)     11114
  //   after PR 7 (tier-2 residue)  6318
  //
  // placeholder-rmpg-300|400 is 0 today; the pattern includes it so a future
  // one trips the guard rather than slipping in.
  const PIN = 11114;
  const PATTERN = /\b(?:text|placeholder)-rmpg-(?:300|400|500|600)\b/g;

  function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '__tests__') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) sourceFiles(full, out);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
  }

  const total = sourceFiles(SRC_DIR).reduce(
    (n, file) => n + (readFileSync(file, 'utf8').match(PATTERN)?.length ?? 0),
    0,
  );

  it('adds no new sub-AA text-ramp utilities', () => {
    expect(
      total,
      `Found ${total} sub-AA text-ramp utilities, pinned at ${PIN}. ` +
      'Use text-fg-muted / text-fg-secondary / placeholder-fg-muted instead.',
    ).toBeLessThanOrEqual(PIN);
  });

  it('has its pin lowered when sites are migrated', () => {
    expect(
      total,
      `Only ${total} remain but the pin is still ${PIN}. ` +
      `Lower PIN to ${total} in this same commit so the ratchet keeps holding.`,
    ).toBeGreaterThanOrEqual(PIN);
  });
});
```

- [ ] **Step 2: Run test to verify it passes at the pin**

```bash
cd client && npx vitest run src/utils/__tests__/accentTokens.test.ts -t "ratchet"
```

Expected: **PASS**, 2 tests. The pin equals the current count exactly, so both bounds are tight.

If it fails, the measured count differs from 11,114 — take the *measured* value as the pin and note the delta in the commit body. Re-measure with:

```bash
cd client && grep -rnoE "\b(text|placeholder)-rmpg-(300|400|500|600)\b" src \
  --include='*.tsx' --include='*.ts' | grep -v __tests__ | wc -l
```

- [ ] **Step 3: Verify the ratchet actually bites**

Temporarily append `text-rmpg-500` to any className in `client/src/App.tsx`, re-run, confirm the first assertion fails, then revert. A guard nobody has seen fail is a guard nobody knows works.

```bash
cd client && npx vitest run src/utils/__tests__/accentTokens.test.ts -t "ratchet"
git checkout -- src/App.tsx
```

- [ ] **Step 4: Run the full client suite**

```bash
cd client && npx tsc --noEmit && npx vitest run && npx vite build
```

- [ ] **Step 5: Commit**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/vigorous-euler-8bffb4"
git add client/src/utils/__tests__/accentTokens.test.ts
git commit -m "test(theme): ratchet the sub-AA text-ramp utility count at 11114

Memory recorded this rule as 'enforced by a text-context ban test in
accentTokens.test.ts'. No such test existed on this branch or origin/main --
the policy was written down and nothing enforced it, which is how the surface
reached 4,796 tier-1 sites.

One ratchet across all four steps, not one per tier: a tier-2-only pin would
not move when a tier-1 batch lands."
```

---

## Task 7: Open PR 0

- [ ] **Step 1: Confirm zero call sites changed**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/vigorous-euler-8bffb4"
git diff origin/main --stat -- 'client/src/pages' 'client/src/components'
```

Expected: **empty**. PR 0 is mechanism only. If anything shows, it belongs in a migration batch.

- [ ] **Step 2: Confirm the full gate**

```bash
cd client && npx tsc --noEmit && npx vitest run && npx vite build
```

- [ ] **Step 3: Push and open the PR**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/vigorous-euler-8bffb4"
git push -u origin claude/vigorous-euler-8bffb4
gh pr create -R rmpgutah/rmpg-flex --base main \
  --title "fix(theme): make the foreground roles AA-legal and guard them (PR 0 of 8)" \
  --body "$(cat <<'BODY'
Mechanism only for the Tailwind text-ramp contrast program. **Zero call-site changes.**

Spec: `docs/superpowers/specs/2026-07-25-tailwind-text-ramp-contrast-design.md`

## What this fixes on its own

`--text-muted` was 3.81:1 on `--surface-raised` in the default theme — below AA, and
therefore not a legal target for the migration that follows. Lifting it to `#b1c1d3`
(4.62:1) also carries the **233 existing inline `var(--text-muted)` sites** over the
line, before any call site moves.

## Changes

- `themeContrast.test.ts` rewritten to parse `theme-palettes.css`. It pinned blue-silver
  `surfaceBase` as `#0c1a2b`; the live value is `#22405f`, retired in #2661/#3006. The
  stale value is darker, so every assertion passed with inflated headroom. Now asserts
  all 36 combinations (4 blocks × 3 text roles × 3 surfaces) ≥ 4.5:1.
- Blue-silver `--text-muted` `#9bb0c7` → `#b1c1d3`. Other three blocks untouched
  (already 5.70–7.46). `chartPalette.ts`'s hardcoded fallback moves in lockstep.
- `--text-{primary,secondary,muted}-rgb` triples added to all four palette blocks,
  each bare var re-pointed at its own triple. Per-block, not hoisted.
- `@media print` gains the three `--text-*-rgb` overrides — a **fifth** theme context.
  Without it every migrated label prints its screen value on white paper.
- `fg` Tailwind scale → `text-fg-muted`, `text-fg-secondary`, `placeholder-fg-muted`.
- Ratchet pinning sub-AA text-ramp utilities at **11,114**, dropping to 6,318 after PR 7.

## Why not repoint the rmpg ramp

It inverts between themes — blue-silver `--rmpg-300` is `157 175 194`, day is
`70 70 70` — so "lighten 500/600" is correct in three blocks and backwards in the
fourth. It would also drag 1,198 non-text border/background/ring uses where the ramp
is correct.

## Verification

`npx tsc --noEmit && npx vitest run && npx vite build` — all green.
Ratchet confirmed to bite by temporarily adding a `text-rmpg-500` and watching it fail.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

---

## Tasks 8–14: Migration batches

All seven share one procedure. The classification table and traps in **Global Constraints** are the substance of the work; the per-task blocks below carry only what differs.

### Procedure (applies to Tasks 8–14)

- [ ] **Step A: List the batch's files** — run the task's scope command. It prints the exact file list.
- [ ] **Step B: Migrate by role** — for each file, open it and apply the Global Constraints classification table. Split by role; do not sed.
- [ ] **Step C: Apply the smell test** — for each file, compare converted count to original occurrence count. Equal means nothing was split by role. Investigate before continuing.
- [ ] **Step D: Re-measure and lower the pin** —
  ```bash
  cd client && grep -rnoE "\b(text|placeholder)-rmpg-(300|400|500|600)\b" src \
    --include='*.tsx' --include='*.ts' | grep -v __tests__ | wc -l
  ```
  Set `PIN` in `accentTokens.test.ts` to the **measured** value. The forecast in each task is a forecast, not an assertion.
- [ ] **Step E: Full suite** — `cd client && npx tsc --noEmit && npx vitest run && npx vite build`
- [ ] **Step F: Live check** — with the `client-dev` preview running on port 5183, re-run the DOM sweep below and confirm the below-3:1 count only ever falls.
- [ ] **Step G: Commit and open the PR.**

**DOM sweep** (paste into the browser console, or run via the preview tooling):

```js
(() => {
  const L=([r,g,b])=>{const f=c=>{c/=255;return c<=0.03928?c/12.92:((c+0.055)/1.055)**2.4};
    return .2126*f(r)+.7152*f(g)+.0722*f(b)};
  const cr=(a,b)=>{const x=L(a),y=L(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
  const px=s=>s.match(/\d+/g).map(Number).slice(0,3);
  const bgOf=el=>{let n=el;while(n){const b=getComputedStyle(n).backgroundColor;
    if(b&&!/rgba\(0, 0, 0, 0\)|transparent/.test(b))return px(b);n=n.parentElement}
    return [34,64,95]};
  const rows=[];
  document.querySelectorAll('body *').forEach(el=>{
    if(el.children.length) return;
    const t=(el.textContent||'').trim(); if(!t) return;
    const r=el.getBoundingClientRect(); if(r.width<1||r.height<1) return;
    const cs=getComputedStyle(el); if(cs.visibility==='hidden'||cs.opacity==='0') return;
    const ratio=cr(px(cs.color),bgOf(el));
    if(ratio<3) rows.push({text:t.slice(0,34),size:cs.fontSize,color:cs.color,ratio:+ratio.toFixed(2)});
  });
  return {belowThree: rows.length, worst: rows.sort((a,b)=>a.ratio-b.ratio).slice(0,18)};
})()
```

On `/login` before any migration this returns **19**. Expected residue after the program: the disabled `Continue` button (WCAG 1.4.3 exempts disabled controls) and two `rmpg-400` window-chrome glyphs (tier 2).

---

### Task 8 — PR 1: `client/src/components/**`

**Scope:** 166 files, 570 occurrences. Forecast pin after: **10,544**.

```bash
cd client && grep -rlE "\b(text|placeholder)-rmpg-(500|600)\b" src/components \
  --include='*.tsx' --include='*.ts' | grep -v __tests__ \
  | grep -vE '^src/components/crm/FirecrawlTab\.tsx$'
```

Verify it prints **166**. The exclusion is anchored deliberately — see Task 13 for what an unanchored one costs.

**Extra step, this batch only — confirm the class actually emits.** PR 0 could only assert the config; this is the first batch with real call sites, so it is the first chance to prove Tailwind emits the rule. Skipping it risks the `bg-surface-hover` failure mode: used 14×, emitted never, silently inert.

```bash
cd client && npx vite build && grep -o 'text-fg-muted' dist/assets/*.css | head -1
```

Expected: `text-fg-muted` present. If empty, the `fg` key is not reaching Tailwind — stop and fix the config before migrating anything else.

Commit subject: `fix(theme): route components/ labels onto the fg roles (PR 1 of 8)`

---

### Task 9 — PR 2: `client/src/pages/{admin,fleet,hr}/**`

**Scope:** 95 files, 1,035 occurrences. Forecast pin after: **9,509**.

```bash
cd client && grep -rlE "\b(text|placeholder)-rmpg-(500|600)\b" \
  src/pages/admin src/pages/fleet src/pages/hr --include='*.tsx' --include='*.ts' | grep -v __tests__
```

Note `src/pages/hr/utils/hrConstants.ts` and `src/pages/fleet/tabs/FleetAnalyticsTab.tsx` hold colors in **maps**, not JSX. Colour maps key by semantic role, not CSS property — scan for `text:` explicitly, and remember a classifier reading the nearest `<prop>:` sees a `border: string` *type annotation* and miscalls it a border.

Commit subject: `fix(theme): route admin/fleet/hr labels onto the fg roles (PR 2 of 8)`

---

### Task 10 — PR 3: `client/src/pages/{dispatch,map,warrants,mobile}/**`

**Scope:** 22 files, 205 occurrences. Forecast pin after: **9,304**.

```bash
cd client && grep -rlE "\b(text|placeholder)-rmpg-(500|600)\b" \
  src/pages/dispatch src/pages/map src/pages/warrants src/pages/mobile \
  --include='*.tsx' --include='*.ts' | grep -v __tests__
```

Two constraints bite hardest here:
- **`.tactical-dark` surfaces** — live Map, MDT, dashcam/body-cam HUDs and turn-by-turn Nav stay near-black *deliberately* so a bright UI never blinds a driver at night. Measure against that surface, not blue-silver.
- **`src/pages/map/utils/mapConstants.ts`** — if a value feeds `MAP_PALETTE` or any Mapbox paint property it stays literal hex. Mapbox GL cannot resolve `var()`, and the space-separated `rgb(r g b)` form blanks the map.
- **Warrants page** deliberately uses looser row padding and pill badges (2026-07-14 rebuild). Do not "fix" that while you are in there.

Commit subject: `fix(theme): route dispatch/map/warrants/mobile labels onto the fg roles (PR 3 of 8)`

---

### Task 11 — PR 4: `client/src/pages/{personnel,pdf-editor,document-writer,intel}/**`

**Scope:** 102 files, 465 occurrences. Forecast pin after: **8,839**.

```bash
cd client && grep -rlE "\b(text|placeholder)-rmpg-(500|600)\b" \
  src/pages/personnel src/pages/pdf-editor src/pages/document-writer src/pages/intel \
  --include='*.tsx' --include='*.ts' | grep -v __tests__
```

`pdf-editor` and `document-writer` contain **PDF generation code**. jsPDF and pdf-lib take literal color arguments — a `var()` there produces a broken document, not a themed one. If the value is passed to a PDF library, leave it. `src/pages/pdf-editor/components/PageCanvas.tsx` is on-screen canvas chrome and *is* in scope; the generators are not.

Commit subject: `fix(theme): route personnel/pdf-editor/document-writer/intel labels onto the fg roles (PR 4 of 8)`

---

### Task 12 — PR 5: remaining `client/src/pages/*/**` subdirs + three strays

**Scope:** 35 files, 353 occurrences. Forecast pin after: **8,486**.

Covers `records`, `patrol`, `navigation`, `serve`, `recon-connect`, `wallet`, `documents`, `docs`, `detached`, `skiptracer`, `flexcam`, `dashcam`, `dashboard`, plus `src/App.tsx`, `src/context/ContextMenuContext.tsx`, `src/utils/taskDueCountdown.ts`.

```bash
cd client && grep -rlE "\b(text|placeholder)-rmpg-(500|600)\b" src \
  --include='*.tsx' --include='*.ts' | grep -v __tests__ \
  | grep -vE '^src/components/|^src/pages/(admin|fleet|hr|dispatch|map|warrants|mobile|personnel|pdf-editor|document-writer|intel)/|^src/pages/[^/]+$'
```

`src/App.tsx` sets the app-shell text color. Changing it changes what every *unstyled* descendant inherits — check the shell renders unchanged before committing.

Commit subject: `fix(theme): route the remaining page subdirs onto the fg roles (PR 5 of 8)`

---

### Task 13 — PR 6: flat `client/src/pages/*.tsx`

**Scope:** 92 files, 1,607 occurrences — the densest batch. Forecast pin after: **6,879**.

```bash
cd client && grep -rlE "\b(text|placeholder)-rmpg-(500|600)\b" src/pages \
  --include='*.tsx' --include='*.ts' | grep -v __tests__ \
  | grep -E '^src/pages/[^/]+$' \
  | grep -vE '^src/pages/(EmailPage|DashboardPage)\.tsx$'
```

Verify it prints **92**. Two things about that command are load-bearing:

**The exclusion is anchored, and must stay anchored.** An unanchored
`grep -vE 'EmailPage\.tsx|DashboardPage\.tsx'` also strips
`src/pages/SecurityDashboardPage.tsx`, which belongs in *this* batch — it matches
`DashboardPage.tsx` as a substring. That single character of sloppiness produced a
514-vs-513 off-by-one twice while this plan was being written, once in the spec's
batch table and once in this very command. It silently returns 91.

**The pattern is `(text|placeholder)`, not `text`.** `src/pages/GeoDataViewerPage.tsx`
and `src/pages/ImpoundPage.tsx` carry only `placeholder-rmpg-*` and match no `text-`
pattern at all. A `text-`-only file list drops both without any error. Confirm they
appear:

```bash
cd client && grep -rlE "\b(text|placeholder)-rmpg-(500|600)\b" src/pages --include='*.tsx' \
  | grep -cE '^src/pages/(GeoDataViewer|Impound)Page\.tsx$'   # expect 2
```

Commit subject: `fix(theme): route the flat page components onto the fg roles (PR 6 of 8)`

---

### Task 14 — PR 7: megafiles

**Scope:** 3 files, 561 occurrences. Forecast pin after: **6,318** — the program's floor.

- `client/src/components/crm/FirecrawlTab.tsx` — 230 occurrences, ~11k lines
- `client/src/pages/EmailPage.tsx` — 117
- `client/src/pages/DashboardPage.tsx` — 89

Last on purpose: the classification pattern has settled across five hundred smaller decisions by now.

- [ ] **Extra step: confirm the floor is exactly the tier-2 residue**

```bash
cd client && grep -rnoE "\b(text|placeholder)-rmpg-(500|600)\b" src \
  --include='*.tsx' --include='*.ts' | grep -v __tests__ | wc -l    # expect 0
cd client && grep -rnoE "\b(text|placeholder)-rmpg-(300|400)\b" src \
  --include='*.tsx' --include='*.ts' | grep -v __tests__ | wc -l    # expect 6318
```

Tier 1 must be **0**. If not, a file escaped every batch — find it and fold it into this PR.

- [ ] **Extra step: update the spec's status**

Set `**Status:**` in `docs/superpowers/specs/2026-07-25-tailwind-text-ramp-contrast-design.md` to
`Tier 1 complete; tier 2 (6,318 sites, text-rmpg-300/400) held under the ratchet`.

Commit subject: `fix(theme): route the three megafiles onto the fg roles (PR 7 of 8)`

---

## Self-review notes

**Spec coverage.** §3.1 Tailwind scale → Task 5. §3.2 palette, five locations → Tasks 2, 3, 4. §3.2 chartPalette lockstep → Task 2. §3.3 classification → Global Constraints, applied in Tasks 8–14. §3.4 guards, all three → Tasks 1, 3, 6. §3.5 sequencing → Tasks 7–14. §4 out-of-scope → enforced by the ratchet pattern excluding `bg-`/`border-`/`ring-`. §5 verification → the per-task gate plus the DOM sweep.

**Naming consistency.** `channels()`, `blockOf()`, `ratio()`, `THEME_BLOCKS` are defined in Task 1 and referenced by that name in Tasks 3 and 6. `PIN` is defined in Task 6 and lowered by name in Tasks 8–14. `SRC_DIR`, `css`, `readFileSync`, `readdirSync`, `join`, `resolve` already exist at the top of `accentTokens.test.ts` — the appended blocks in Tasks 3–6 rely on them and add no imports.

**Known soft spot.** The forecast pins in Tasks 8–14 assume the batch boundaries hold exactly. Step D takes the measured count instead, so a drift changes one number rather than invalidating the plan.
