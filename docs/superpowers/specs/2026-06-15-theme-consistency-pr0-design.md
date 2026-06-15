# Theme Consistency — PR 0: Foundation + Light-Mode Function Fix — Design

**Date:** 2026-06-15
**Status:** Approved (brainstorming) → ready for implementation plan
**Scope:** Client only (shared CSS + shared components + a doc + a CI workflow). No Worker/API/DB changes. Presentation only.

## Context

RMPG Flex has a working day/night theme engine (PR #1277): night = dark steel-blue Spillman (default), day = light grey, with a schedule/override system. Palette source of truth = `client/src/styles/theme-palettes.css` (var-backed Tailwind tokens). **Known deferred Phase-2 debt:** ~8,658 hardcoded hex values across 200+ component files bypass the theme, so individual pages don't re-theme and **light mode breaks** (light-on-light illegibility). This is documented in `CLAUDE.md` and `docs/theme-hex-audit-baseline.txt`.

This is the first PR of a multi-PR **Theme Consistency program**:
- **PR 0 (this spec):** fix the *global chrome* (renders on every page) + light-mode function bugs + build the token-reference doc and a CI ratchet so subsequent page sweeps are mechanical and can't regress.
- **PR 1…N (future specs):** page-by-page hex→token sweeps in priority order: Dashboard → Dispatch → Records → MDT + Map → long tail.

The dark target stays **steel-blue night** — we make it *consistent*, not recolored.

## Goal

Make the app's shared chrome legible and flush in **both** day and night, fixing the visible light-mode breakage, and establish the tooling (token doc + CI ratchet) the rest of the program depends on.

## Root-cause example (the reported bug)

The module-ribbon dropdown (e.g. ENFORCE → "Court Tracker") renders blank/washed-out in **day** mode because `client/src/index.css` hardcodes dark-mode colors:
- `.menu-item { color: #d0d0d0 }` → light-grey text on the light day surface = washed out.
- `.menu-item:hover { color: #ffffff }` on `var(--surface-raised)` → **white-on-light = invisible** (the "blank" hovered item).
- `.menu-item.active { color:#ffffff !important }` → same in day.
- `.menu-dropdown` borders hardcoded `#2e2e2e / #383838 / #050505` (dark bevel) → wrong in day.

Fix = swap these hardcoded colors for the theme tokens that already invert between day/night.

## Architecture

Three deliverables, isolated from each other:

### 1. Global-chrome theme fix (CSS + shared components)

Replace hardcoded hex in the **shared chrome** with existing theme tokens (defined in `theme-palettes.css`). Targets, each with a clear interface (a class or component) that every page consumes:

| Target | File | Fix |
|---|---|---|
| Menu dropdowns / items | `client/src/index.css` (`.menu-dropdown`, `.menu-item`, `.menu-item:hover`, `.menu-item.active`, `.menu-item-disabled`, shortcut/arrow) | text → `var(--spm-text)`; muted → `var(--spm-text-muted)`; hover/active text → `var(--spm-text)` (NOT hardcoded `#fff`); hover bg → `var(--spm-select)` with its paired text; borders → `var(--spm-border)` |
| Toolbar nav buttons | `client/src/components/Layout.tsx` hardcoded `#888888` focus rings + any `bg-[#…]`/`text-[#…]` | → tokens (`--spm-border`/`--spm-text`) or existing Tailwind token classes |
| Table header/rows | `.grid-*` classes if any hardcode hex; the shared table styles in `index.css` | → `var(--grid-*)` tokens (already exist) |
| Info banners | `.info-*` if hardcoded | → `var(--info-*)` (already exist) |
| Shared components | `PanelTitleBar.tsx`, `IconButton.tsx`, `StatsCard.tsx`, badge styles | hex → tokens |

Rule: **prefer existing tokens**; only add a new `--var` to `theme-palettes.css` (with day + night + legacy-black values) if no suitable token exists. Any new var must be defined in all three palette blocks.

The fix is presentation-only — no markup/logic changes beyond swapping color classes/values. Components keep their current structure.

### 2. Token reference doc (`docs/theme-tokens.md`)

The canonical playbook for the page-sweep PRs. Contents:
- The token families and what each is for (surfaces: `--surface-*`; text: `--spm-text`/`--spm-text-muted`; chrome: `--toolbar-nav-*`, `--grid-*`, `--info-*`, `--spm-*`; brand gold stays `#d4a017`).
- A "hex → token" cheat-sheet for the most common hardcoded values (e.g. `#0d1722`→`bg-surface-base`, `#888888`→`text-rmpg-400`/`--spm-text-muted`, dark borders→`--spm-border`).
- The rule for tactical-always-dark surfaces (`.tactical-dark`: Map/HUD/MDT/Nav) — those legitimately stay dark; don't "fix" them to day.
- How to run the audit + interpret it.

### 3. CI hex ratchet (`scripts/theme-hex-audit.mjs` + workflow + allowlist)

A ratchet so the program proceeds page-by-page without a wall and cleaned work can't regress:
- **`docs/theme-cleaned-files.txt`** — allowlist of files declared "theme-clean" (seeded with the global-chrome files cleaned in this PR + `DashboardPage.tsx` + `dashboard/*`).
- **`scripts/theme-hex-audit.mjs`** — extend/fix the existing script so it supports a `--check` mode: exit non-zero if any file listed in `theme-cleaned-files.txt` contains a disallowed raw hex (excluding allowed exceptions: brand gold `#d4a017`, transparent/`#fff`/`#000` inside `rgba()` shadows if we choose to allow, and the `theme-palettes.css`/legacy files). Always print the global hex total + top offenders as an informational line.
- **`.github/workflows/theme-hex-guard.yml`** — runs `node scripts/theme-hex-audit.mjs --check` on PRs touching `client/src/**`. **Fails only** on a cleaned-file regression; the global tail is reported, never blocks.

Exact "disallowed hex" definition and allowed-exception list are finalized in the plan; default: 6-digit/3-digit hex in `.tsx`/`.css` except (a) brand gold `#d4a017`, (b) files in `theme-palettes.css` / `*legacy*`, (c) `.tactical-dark`-scoped rules.

## Components / boundaries

- **CSS chrome** (`index.css` chrome blocks) — one responsibility: shared chrome styling; consumed via class names by MenuBar/Layout/tables.
- **Shared components** (`PanelTitleBar`/`IconButton`/`StatsCard`) — each already a single-purpose unit; we only swap their color values.
- **Audit tool** (`theme-hex-audit.mjs`) — pure Node script, no app deps; testable by running against fixture strings.
- **CI workflow** — wraps the tool.

## Error handling / edge cases

- **Legacy-black kill-switch** (`html.theme-legacy-black`) must still produce pure-black chrome — verify the token swaps resolve correctly in all three palette blocks.
- **Tactical-dark surfaces** stay dark in day — the chrome fix must not lighten Map/MDT/HUD/Nav. Scope fixes to non-tactical chrome.
- **Brand gold `#d4a017`** is intentionally constant — the audit allowlists it; do not tokenize it away.
- **Disabled menu items** must stay visibly dimmed in both themes (not invisible) — `.menu-item-disabled` → a muted token with adequate contrast in day.

## Testing

- Existing CI gates: `client-typecheck`, `client-tests` (vitest), `client-build` must pass.
- **Audit tool unit behavior:** add a small vitest (or node test) for `theme-hex-audit.mjs`'s detection logic (given a string with a disallowed hex → flagged; brand gold → allowed; cleaned-file regression → non-zero exit). Pure-function level.
- **Manual (human, WAF blocks headless):** in a real browser, toggle day↔night and confirm: the ENFORCE (and other) module dropdowns are fully legible in both themes (no blank/washed items); menus/toolbars/tables/badges look flush in night and legible in day; legacy-black kill-switch still pure black; Map/MDT stay dark in day.

## Non-goals / YAGNI

- No per-page hex sweeps (that's PR 1…N) — except seeding the allowlist with already-clean Dashboard.
- No recolor of the steel-blue night identity.
- No new theme toggle/engine changes.
- No Worker/API/DB/migration changes.
- Do NOT hard-fail CI on the existing 8.6k-hex tail (ratchet only).

## Ship checklist

- Bump `CACHE_NAME` in `client/public/sw.js`.
- Ship via feature branch → PR (per project flow).
