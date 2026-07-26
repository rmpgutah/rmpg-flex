# Tailwind text-ramp contrast — routing 4,796 label sites off `--rmpg-*`

**Date:** 2026-07-25
**Status:** Approved, not yet implemented
**Base:** `origin/main` @ `ec6eba539c`
**Predecessors:** #3029 (`6fad12930a`, bare `--rmpg-*` aliases), #3031 (`1c6844e92f`, 129 inline sites re-pointed by role), #3032 (`ec6eba539c`, inline text-context guard)

> **#3032 merged mid-authoring and closes the inline path for good.** Its
> `describe('the --rmpg-* ramp is never used as a text colour')` guard
> (`accentTokens.test.ts:212`) matches four inline patterns against `var(--rmpg-N)` —
> `color:`, `.style.color =`, `WebkitTextFillColor`, `text:` role keys — and demands
> **zero** offenders. **It cannot see a Tailwind class**; `className="text-rmpg-500"`
> matches none of its regexes. Every count in this spec was re-measured on
> `ec6eba539c` and is unchanged, because #3032 touched only inline sites.
>
> #3032 also establishes that **`:root` is the base layer**, not a fourth peer block,
> so "declared in all four blocks" is the wrong guard rule *in general*. It remains the
> right assertion for `--text-*`, which carries a different value per theme — see §3.2.

---

## 1. Problem

`--rmpg-*` encodes **surface elevation**, not foreground emphasis, and it *inverts*
between themes — blue-silver `--rmpg-300-rgb` is `157 175 194` (light), while
`html.theme-light` `--rmpg-300-rgb` is `70 70 70` (dark). Using it as a text scale
therefore cannot be made correct by adjusting values; the scale means different
things in different blocks.

This is already recorded policy ("the ramp is NOT a text-color scale"). The inline
`style={{ color: 'var(--rmpg-500)' }}` path was closed by #3029 + #3031, which left
only 4 intentional bare inline sites repo-wide.

**The Tailwind-utility path was never touched, and it is the larger surface.**

### 1.1 Measured contrast — `html.theme-blue-silver` (the app default)

Foreground ramp steps against the three panel surfaces
(`--surface-base #22405f`, `--surface-raised #2c4f74`, `--surface-sunken #1a3350`):

| step | `text-` uses | base | raised | sunken | AA (4.5:1)? |
|---|---:|---:|---:|---:|---|
| `rmpg-100` | 2,716 | 8.17 | 6.48 | 9.83 | pass |
| `rmpg-200` | 1,253 | 6.47 | 5.14 | 7.79 | pass |
| `rmpg-300` | 1,913 | 4.75 | **3.77** | 5.72 | **fails on raised** |
| `rmpg-400` | 4,405 | **3.47** | **2.75** | **4.18** | **fails on all three** |
| `rmpg-500` | 3,934 | **2.30** | **1.82** | **2.77** | **fails on all three** |
| `rmpg-600` | 666 | **1.48** | **1.18** | **1.78** | **fails on all three** |

`text-rmpg-600` additionally fails in **all four** theme blocks (1.96–2.30 dark,
2.07–3.10 light, 1.99–2.12 legacy-black), so this is not a blue-silver-only defect.

Counts measured on `4b6996244c`:

```bash
grep -rnoE "\btext-rmpg-(500|600)\b" client/src --include='*.tsx' --include='*.ts' \
  | grep -v __tests__ | wc -l     # 4600, across 513 files
```

**Tier-1 scope is 4,796 sites across 515 files** — the 4,600 `text-` occurrences plus
196 `placeholder-rmpg-(500|600)`, which are text at 1.18–1.82:1 and belong here rather
than in the non-text bucket (§4). The two extra files carry only the `placeholder-`
form; see the derivation in §3.5.

### 1.2 Live confirmation

A DOM sweep of the unauthenticated `/login` route on the `client-dev` preview
(port 5183, `html class="theme-blue-silver dark"`) found **19 elements below 3:1**,
16 of them at exactly **2.30:1** in `rgb(99, 118, 143)` — including every field label
in the SYSTEM and DEVICE panels (`APPLICATION`, `VERSION`, `BUILD`, `OPERATOR`,
`JURISDICTION`, `SERVER`, `BROWSER`, `OS`, `TYPE`, `DISPLAY`, `VIEWPORT`,
`CONNECTION`) at **8px**.

Two of the 19 are correctly *not* in scope: the disabled `Continue` button (WCAG 1.4.3
exempts disabled controls) and two `rmpg-400` window-chrome glyphs (tier 2, below).

### 1.3 Why it went unnoticed

`client/src/utils/__tests__/themeContrast.test.ts:17` pins blue-silver's
`surfaceBase` as `[12, 26, 43]` (`#0c1a2b`). The live value is `#22405f`. The stale
value is *darker*, so every assertion in the file passes with inflated headroom
against a surface the app has not used since #2661/#3006.

Two sibling tests (`themeClassStamp.test.ts:42`, `themeBlueSilver.test.ts:40`) already
call out and correct this exact stale value. The one test whose entire job is contrast
is the one still measuring it.

Separately: memory recorded this rule as *"now enforced by a text-context ban test in
`accentTokens.test.ts`."* Verified against both this branch and `origin/main` — that
test **does not exist**. `accentTokens.test.ts` has four describe blocks (accent
tokens, theme-block completeness, bare-alias completeness, dead CSS variables) and
none of them is it. The policy was written down; nothing enforced it.

---

## 2. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **Bar is WCAG AA, 4.5:1** | The affected labels are 8–11px. WCAG 1.4.3's 3:1 allowance applies only to large text (18pt / 14pt bold); citing it here would be misapplying the exemption. Confirmed by the user against a true-size side-by-side render. |
| D2 | **Mechanism (a): a foreground-role Tailwind scale** | (b) repointing the ramp is invalid — it inverts per theme and drags 1,394 non-text uses. (c) migrating to `rmpg-300` does not reach AA (3.77 on raised). |
| D3 | **Tiered scope; this program is tier 1 only** | AA's real footprint is **11,114** sites across four ramp steps (10,918 `text-` + 196 `placeholder-`). `500/600` (**4,796** = tier 1) are the "cannot read it" tier at 1.18–2.77; `300/400` (**6,318** = tier 2) are "readable but sub-AA" at 2.75–4.18. Different urgency, different risk, and 11k sites is not one reviewable program. |
| D4 | **Lift `--text-muted` in blue-silver only** | At `#9bb0c7` it is 3.81 on raised — itself below AA, so it is not a legal migration target as-is. `#b1c1d3` yields 4.62. The other three blocks already score 5.70–7.46; changing them would be change for its own sake. |
| D5 | **Token named `fg`, not top-level `muted`** | Matches the repo's existing role-group pattern (`surface-base`, `border-strong`). A top-level `muted` key would generate an ambiguous `bg-muted` (muted background? or the muted foreground used as a background?). |
| D6 | **A ratchet, not a clean assertion** | Tier 2 leaves 6,318 known-failing sites. An absolute "no sub-AA text token" test would need a 6,318-entry allowlist on day one. |

### 2.1 Why `#b1c1d3` specifically

It is `--text-muted`'s own hue scaled 22% toward white, giving **4.62:1** on
`--surface-raised` — deliberately matching the headroom `--accent-gold-300` was tuned
to on the same surface (4.63), so the gold and silver label roles stay balanced rather
than one out-shouting the other.

---

## 3. Design

### 3.1 Tailwind scale

In `client/tailwind.config.js`, under `theme.extend.colors`:

```js
fg: {
  DEFAULT:   'rgb(var(--text-primary-rgb) / <alpha-value>)',
  primary:   'rgb(var(--text-primary-rgb) / <alpha-value>)',
  secondary: 'rgb(var(--text-secondary-rgb) / <alpha-value>)',
  muted:     'rgb(var(--text-muted-rgb) / <alpha-value>)',
},
```

Yields `text-fg-muted`, `text-fg-secondary`, `text-fg`, `placeholder-fg-muted`.

- **No `fontSize` collision.** Verified: the `fontSize` keys are `micro`, `label`,
  `caption`, `body-sm`, `body`, `title`, `heading`, `display`. `fg` is free, so
  `text-fg-*` cannot be resolved as a font-size utility. (Note `label` *is* taken —
  which is why a `label` color key must never be introduced.)
- **The rgb-triple form is required, not stylistic.** Plain `var(--text-muted)` would
  break `<alpha-value>`; one existing call site uses an opacity modifier.
- **Verify the token reaches `dist/assets/*.css`** before trusting it. Precedent:
  `bg-surface-hover` was used 14× while `hover` was never a key in the `surface`
  scale, so Tailwind emitted nothing and those hover states silently did nothing.

### 3.2 Palette — five locations, not four

`--text-*-rgb` triples must be added in the four theme blocks of
`client/src/styles/theme-palettes.css` **and** in the `@media print` block at
`client/src/index.css:3308`.

The print block already overrides five `--surface-*-rgb` channels, with a comment
explaining that Tailwind token classes would otherwise "print dark on white." It
overrides **zero** `--text-*-rgb` channels because none exist yet. Omitting it means
every migrated label prints light grey on white paper.

> CLAUDE.md's rule "every role variable must be defined in ALL FOUR theme blocks"
> undercounts by one for any `-rgb` triple. The print block is a fifth context.

In each theme block, re-point the bare var at its own triple — the per-block alias
pattern #3029 established for `--rmpg-*`, so the 233 inline `var(--text-muted)`
consumers and the new Tailwind class share one source and cannot drift:

```css
--text-muted-rgb: 177 193 211; --text-muted: rgb(var(--text-muted-rgb));
```

**Per-block, never hoisted.** `.tactical-dark` is a *descendant* class that
re-declares the triples to force night on map/MDT/dashcam surfaces. A single hoisted
`:root` alias substitutes at computed-value time on the root element, and the
already-substituted result is what inherits — so a descendant could never override it.

Exact values:

| block | `--text-primary-rgb` | `--text-secondary-rgb` | `--text-muted-rgb` |
|---|---|---|---|
| `:root, html.theme-dark, .tactical-dark` | `230 237 245` | `195 208 222` | `143 163 184` |
| `html.theme-light` | `26 26 26` | `51 49 43` | `85 85 85` |
| `html.theme-legacy-black` | `242 242 242` | `207 207 207` | `138 138 138` |
| `html.theme-blue-silver` | `240 244 249` | `205 216 230` | **`177 193 211`** ← changed |
| `@media print` (`!important`) | `17 17 17` | `51 51 51` | `102 102 102` |

Only the blue-silver `--text-muted` value changes (`#9bb0c7` → `#b1c1d3`); every other
triple restates the hex already present.

**Lockstep change:** `client/src/utils/chartPalette.ts:20` hardcodes
`'--text-muted': '#9bb0c7'` as a resolve fallback, pinned by
`chartPalette.test.ts:12`. Both move in the same commit or charts keep the old value
whenever the var fails to resolve.

### 3.3 Role classification

This is a role decision per element, not a codemod. Open the JSX and decide what the
element *is*.

| What the element is | Target |
|---|---|
| Field key, caption, helper text, timestamp, de-emphasized label | `text-fg-muted` |
| Sub-heading, active/selected row text, a *value* rather than its label | `text-fg-secondary` |
| Decorative divider or chrome glyph conveying no state | leave on the ramp — it is not text |
| Placeholder | `placeholder-fg-muted` |
| Disabled control text | leave; WCAG 1.4.3 exempts disabled controls |
| Anything under `.tactical-dark` | measure against *that* surface, not blue-silver |
| Numeric metric values | `text-rmpg-100` — data, not a label (existing rule) |

**Smell test:** if a file's converted count equals its occurrence count, nothing was
split by role and something was missed.

**Known traps from the inline sweep, which apply unchanged here:**

- A `fill` carrying `fontSize`/`fontFamily` **is text** — recharts renders
  `tick={{ fill, fontSize: 9 }}` as an SVG `<text>`.
- Colour maps key by semantic role, not CSS property. A classifier reading the nearest
  `<prop>:` sees a `border: string` *type annotation* and miscalls it a border.
- `` `${color}22` `` alpha concatenation can never take a `var()` —
  `var(--rmpg-500)22` is invalid and the declaration drops silently. Sites feeding a
  hex into string concatenation must stay raw hex.

### 3.4 Guard tests

1. **Rewrite `themeContrast.test.ts` to parse `theme-palettes.css`.** Hardcoding is the
   defect; a hardcoded guard cannot notice a palette change. Removes the stale
   `#0c1a2b`.
2. **New AA assertion.** For each of the four theme blocks × each `--text-*-rgb` ×
   each `--surface-{base,raised,sunken}-rgb`, assert ≥ 4.5:1. Verified green against
   the values in §3.2 — worst case is blue-silver muted-on-raised at 4.62.
3. **Ratchet**, modeled on the existing `no new dead CSS variables` block in
   `accentTokens.test.ts`. Scan `client/src` (excluding `__tests__`) for the single
   pattern `\b(text|placeholder)-rmpg-(300|400|500|600)\b` and pin the count. Fail if
   it rises; also fail if it falls without the pin being lowered, so neither tier can
   quietly stall.

   **One ratchet across all four steps, not one per tier.** A tier-2-only pin (6,318)
   would not move when a tier-1 batch lands, so "each PR lowers the pin" would be
   false and six of the seven migration PRs would touch no guard at all.

   | milestone | pin |
   |---|---:|
   | PR 0 (nothing migrated) | **11,114** |
   | after PR 7 (tier-2 residue, this program's floor) | **6,318** |

   11,114 = `text-rmpg-` 300 (1,913) + 400 (4,405) + 500 (3,934) + 600 (666), plus
   `placeholder-rmpg-` 500/600 (196). `placeholder-rmpg-300|400` is **0 today** and is
   included in the pattern so a future one trips the guard rather than slipping in.

A guard that is red on landing is worse than no guard — §3.2's values were chosen so
assertion 2 passes immediately.

### 3.5 Sequencing

**PR 0 — mechanism only, zero call-site changes.** Triples in five locations, the
blue-silver lift, the `fg` scale, the `chartPalette` sync, all three tests. Small,
independently reviewable, and it carries the 233 inline `var(--text-muted)` sites over
the AA line on its own.

**PRs 1–7 — migration by directory.** Full client suite per batch. File counts are
exact, measured on `4b6996244c`, and partition the **515**-file tier-1 universe with
no overlap and no gap.

| PR | Scope | files |
|---|---|---:|
| 1 | `client/src/components/**` (minus the megafile) | 166 |
| 2 | `client/src/pages/{admin,fleet,hr}/**` | 95 |
| 3 | `client/src/pages/{dispatch,map,warrants,mobile}/**` | 22 |
| 4 | `client/src/pages/{personnel,pdf-editor,document-writer,intel}/**` | 102 |
| 5 | remaining `client/src/pages/*/**` subdirs, plus `App.tsx`, `context/ContextMenuContext.tsx`, `utils/taskDueCountdown.ts` | 35 |
| 6 | flat `client/src/pages/*.tsx` | 92 |
| 7 | megafiles isolated — `components/crm/FirecrawlTab.tsx` (230 occurrences), `pages/EmailPage.tsx` (117), `pages/DashboardPage.tsx` (89) | 3 |
| | **total** | **515** |

> **515, not 513.** The 513 figure counts files matching `text-rmpg-(500|600)`.
> `pages/GeoDataViewerPage.tsx` and `pages/ImpoundPage.tsx` carry only
> `placeholder-rmpg-(500|600)` and match no `text-` pattern, so a partition built from
> the `text-` grep alone silently drops them. Both are flat pages → PR 6. Derive the
> batch universe from the union of both patterns:
> ```bash
> cat <(grep -rlE "\btext-rmpg-(500|600)\b" client/src --include='*.tsx' --include='*.ts') \
>     <(grep -rlE "\bplaceholder-rmpg-(500|600)\b" client/src --include='*.tsx' --include='*.ts') \
>   | grep -v __tests__ | sort -u | wc -l   # 515
> ```

> The original four-batch split put 227 files in one PR, which is not reviewable.
> PR 4/5/6 are that batch broken along real subsystem boundaries.
> Match the megafiles by **exact path** — a loose `DashboardPage\.tsx` pattern also
> catches `pages/SecurityDashboardPage.tsx` and double-counts it into PR 6.

Megafiles last, once the classification pattern has settled across five hundred
smaller decisions.

Each migration PR lowers the §3.4 ratchet pin by exactly the tier-1 occurrences it
removes. Occurrence counts (`text-` + `placeholder-`, steps 500/600) and the resulting
pin, measured on `4b6996244c`:

| PR | files | occurrences removed | new pin |
|---|---:|---:|---:|
| 0 | 0 | 0 | 11,114 |
| 1 | 166 | 570 | 10,544 |
| 2 | 95 | 1,035 | 9,509 |
| 3 | 22 | 205 | 9,304 |
| 4 | 102 | 465 | 8,839 |
| 5 | 35 | 353 | 8,486 |
| 6 | 92 | 1,607 | 6,879 |
| 7 | 3 | 561 | 6,318 |
| | **515** | **4,796** | |

If a batch's actual removal differs from the figure above, the pin is the *measured*
post-change count — the table is a forecast, not an assertion. Re-measure with the
§3.4 pattern rather than subtracting.

---

## 4. Out of scope

- **1,198 genuinely non-text `*-rmpg-500/600` uses** — 1,008 borders
  (920 `border-rmpg-600` + 88 `border-rmpg-500`), 157 backgrounds (93 + 64), 27 rings,
  and 6 `accent`/`fill`/`shadow`. The ramp is *correct* for surface and border roles;
  this is the central argument against repointing it.

  > The brief's non-text grep returns **1,394**. The difference is the 196
  > `placeholder-rmpg-500/600` sites, which that pattern buckets as non-text but which
  > **are** text — and at 1.18–1.82:1, unreadable. They are in tier-1 scope as
  > `placeholder-fg-muted` (§3.3). 1,394 − 196 = 1,198 out of scope.
- **Tier 2** — `text-rmpg-300` (1,913) and `text-rmpg-400` (4,405). Held under the
  ratchet, addressed as a separate program.
- **Disabled-control text** — exempt under WCAG 1.4.3.
- **Severity / priority / unit-status hues** — red, green, amber, orange, purple
  encode fixed CAD semantics and are never repurposed to fix contrast.
- **Map palette** (`MAP_PALETTE` in `mapboxBasemap.ts`) — fixed literal hex by design;
  Mapbox GL cannot resolve `var()` in a paint property.

---

## 5. Verification

Per batch, the full suite — not targeted runs. A red test hid behind green targeted
runs for four tasks during the 2026-07-24 sweep.

```bash
cd client && npx tsc --noEmit && npx vitest run && npx vite build
```

Baseline on `4b6996244c` is clean, so any failure is caused by the change.

Fresh worktrees need `cd client && npm install --legacy-peer-deps` first; without
`client/node_modules`, `tsc` reports ~97,000 phantom `Cannot find module` errors.

Live re-verification after PR 0 and after each batch, against the `client-dev`
preview (port 5183) — re-run the DOM sweep from §1.2 and confirm the below-3:1 count
falls to the documented residue (the disabled control plus tier-2 `rmpg-400` glyphs).

---

## 6. Open items

None blocking. Two judgement calls were offered to the user and settled as designed:
the `text-fg-muted` naming (D5) and megafiles-last sequencing (§3.5).
