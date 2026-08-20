# Hex Sweep — Full Codebase Migration Design

**Date:** 2026-08-14  
**Scope:** Replace all in-scope hardcoded hex literals in `client/src/` with CSS-variable-backed Tailwind tokens  
**Baseline:** 4,078 literals across 472 files, 272 audit batches  
**Target:** 0 in-scope literals

---

## Background

The Blue & Silver theme system routes all colors through CSS variables defined in
`client/src/styles/theme-palettes.css`. Hardcoded hex literals bypass this system
and do not re-theme when the active palette changes. The audit tooling
(`scripts/audit-hex.mjs` + `src/utils/hexClassifier.ts`) identifies in-scope
files and excludes load-bearing categories (PDF generators, Mapbox paint modules,
categorical palettes, test fixtures).

The sweep was baselined at ~12k literals pre-classifier. After the classifier was
written and exclusions applied, the live count is **4,078 literals / 472 files**.
The old "~12k" figure in `docs/theme-hex-audit-baseline.txt` is not comparable.

---

## Guiding Rules (from CLAUDE.md — non-negotiable)

1. **Role map, not find-and-replace.** The same hex often serves two roles in one
   file (e.g. `#0a0a0a` as page background AND recessed input). Open the JSX,
   decide what each element IS, assign the correct token per role.

2. **Never migrate excluded files.** PDF generators, Mapbox paint modules,
   `.tactical-dark` fixed values, categorical palettes, test fixtures, and audit
   tooling are excluded by `hexClassifier.ts` for load-bearing reasons. Migrating
   them breaks documents or maps.

3. **Run the full client suite before every PR.** Targeted runs hid a red test
   four tasks in a row (2026-07-24 sweep). Gate is `cd client && npx vitest run`.

4. **Verify a new token actually emits CSS.** `bg-surface-hover` was used 14×
   while `hover` was never a key in the Tailwind `surface` scale — Tailwind emitted
   nothing and every hover state silently did nothing. Check `dist/assets/*.css`
   after adding a new token.

5. **`--field-label-color` and `--panel-header-color` are the only two gold roles.**
   Any gold surface not resolving through those two vars (or the map palette) is a
   defect. Never write a raw `text-accent-gold-*` class in a component.

6. **Numeric metric values are data — use `text-rmpg-100`, not gold.**

7. **Nothing color-valued belongs in `client/src/index.css`.** Colors there are
   theme-invariant by construction.

---

## Token Reference

### Surfaces
| Hex | Token | Role |
|-----|-------|------|
| `#0d1722` | `bg-surface-base` | Page / panel base |
| `#15212e` | `bg-surface-raised` | Cards, modals |
| `#0a1018` | `bg-surface-sunken` | Inset inputs, recessed wells |
| `#060b10` | `bg-surface-overlay` / `bg-surface-deep` | Overlays, deep backgrounds |
| `#17304a` | `bg-[color:var(--record-tile-bg)]` | Record tiles |
| `#1e2b3a` | `bg-rmpg-700` | Mid-dark surfaces |

### Text
| Hex | Token | Role |
|-----|-------|------|
| `#f0f4f9` / `#e6edf5` | `text-rmpg-50` | Primary text |
| `#c3ccd6` / `#d6dde6` | `text-rmpg-100` | Secondary text, metric values |
| `#8fa3b8` | `text-rmpg-300` / `text-text-muted` | Muted / placeholder |
| `#6a8ba8` | `text-rmpg-400` | Dimmed labels |

### Borders
| Hex | Token | Role |
|-----|-------|------|
| `#2a3a4d` | `border-[color:var(--border-default)]` | Default borders |
| `#1e2b3a` | `border-[color:var(--border-subtle)]` | Subtle dividers |
| `#3a4f66` | `border-[color:var(--border-strong)]` | Strong borders |
| `#243a52` | `border-[color:var(--border-panel)]` | Panel borders |

### Severity / CAD (do not change role — these encode operational meaning)
| Hex | Token |
|-----|-------|
| `#ef4444` / `#dc2626` | `text-red-500` / `text-red-600` |
| `#f59e0b` / `#fbbf24` | `text-amber-400` / `text-amber-500` |
| `#22c55e` | `text-green-500` |
| `#a855f7` | `text-purple-500` |
| `#f97316` / `#fb923c` | `text-orange-500` / `text-orange-400` |

### Gold (two roles only — route through vars)
| Role | Var | Token |
|------|-----|-------|
| Field labels | `--field-label-color` | `text-[color:var(--field-label-color)]` |
| Panel/section headers | `--panel-header-color` | `text-[color:var(--panel-header-color)]` |

### Brand / accent ramps
- `text-rmpg-{50–950}`, `bg-rmpg-{50–950}`
- `text-brand-{50–900}`, `bg-brand-{50–900}`
- `text-accent-silver-{300–700}`, `bg-accent-silver-{300–700}`

---

## PR Sequence

Each PR covers one directory group. Branch naming: `claude/hex-sweep-<slug>`.

| PR | Branch slug | Scope | Est. literals |
|----|-------------|-------|---------------|
| 1 | `hex-sweep-map` | `src/pages/map/` | 287 |
| 2 | `hex-sweep-desktop-a` | `src/components/desktop/` first 20 files | ~145 |
| 3 | `hex-sweep-desktop-b` | `src/components/desktop/` remaining | ~140 |
| 4 | `hex-sweep-fleet` | `src/pages/fleet/` | 165 |
| 5 | `hex-sweep-document-writer` | `src/pages/document-writer/` | 106 |
| 6 | `hex-sweep-intel` | `src/pages/intel/` | 96 |
| 7 | `hex-sweep-serve-recon` | `src/components/serve/` + `src/pages/recon-connect/` | 174 |
| 8 | `hex-sweep-admin` | `src/pages/admin/` | 85 |
| 9 | `hex-sweep-big-singles` | `ForensicDashcamPlayer`, `RouteBuilderPage`, `NavPage` | 238 |
| 10 | `hex-sweep-mobile` | `src/pages/mobile/` | 72 |
| 11 | `hex-sweep-radio` | `src/pages/radio/` + `src/components/radio/` | 109 |
| 12 | `hex-sweep-navigation` | `src/pages/navigation/` + `NavigationPage`, `NavMapView` | 127 |
| 13 | `hex-sweep-hr` | `src/pages/hr/` | 49 |
| 14 | `hex-sweep-security` | `src/components/security/` | 46 |
| 15 | `hex-sweep-bulletins-email` | `IntelBulletinsPage`, `EmailPage` | 110 |
| 16 | `hex-sweep-mdt-accreditations` | `MdtPage`, `AccreditationsPage` | 77 |
| 17 | `hex-sweep-components-a` | Remaining components (first half) | ~100 |
| 18 | `hex-sweep-components-b` | Remaining components (second half) | ~100 |
| 19 | `hex-sweep-hooks` | All `src/hooks/` in-scope files | ~80 |
| 20 | `hex-sweep-utils` | All `src/utils/` in-scope files | ~60 |
| 21 | `hex-sweep-auth-login` | `LoginPage`, `ForgotPasswordPage`, `ResetPasswordPage` | ~80 |
| 22+ | `hex-sweep-tail` | All remaining files | remainder |

---

## Per-PR Workflow

1. Create a worktree off current `main`: `git worktree add .claude/worktrees/hex-sweep-<slug> -b claude/hex-sweep-<slug>`
2. Run `node scripts/audit-hex.mjs --list src/<target-dir>` to list the files
3. For each file:
   - Read the file in full
   - For each hex literal, identify its **role** from surrounding JSX/CSS context
   - Substitute with the correct Tailwind token (see Token Reference above)
   - Never substitute a hex that's in an excluded category, even if audit-hex lists it
4. Run `cd client && npx vitest run` — must be 0 failures before committing
5. Run `node scripts/audit-hex.mjs --list src/<target-dir>` again — count must be 0 (or only excluded files remain)
6. Commit: `fix(theme): hex sweep — <scope>`
7. Push, open PR, merge

---

## Success Criteria

- `node scripts/audit-hex.mjs` reports **0 in-scope literals**
- `npx vitest run` passes after every PR (no regressions)
- No Tailwind token used that isn't configured in `client/tailwind.config.js`
- No hex literals added to `client/src/index.css`
- Gold used only via `--field-label-color` / `--panel-header-color` vars
- All PRs merged to `main` with CI green

---

## Out of Scope

- Migrating excluded files (PDF generators, Mapbox paint, categorical palettes)
- Adding new theme variants
- Changing any color values (token substitution only — visual output must be identical)
