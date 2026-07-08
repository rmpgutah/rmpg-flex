# Navy-gray-blue palette repair — design

## Problem

`html.theme-blue-silver` (the app-wide default theme, [`client/src/styles/theme-palettes.css`](../../../client/src/styles/theme-palettes.css)) was lightened in PR #2640 but the result still reads too dark, and its blue tones are inconsistent: `--surface-*`, `--spm-*` (Records/CAD chrome), `--desktop-shell-*`, `--record-tile-*`, and the `--rmpg/--brand/--blue` RGB scales don't share one hue family — some lean steel-blue, some lean near-black navy. Confirmed against live screenshots of Dashboard, Dispatch, and Map.

## Scope

Tokens only — redefine the color values inside the single `html.theme-blue-silver` block in `theme-palettes.css`. No component files change. Every page/component that already reads from the CSS-variable-backed Tailwind tokens (`bg-surface-base`, `bg-rmpg-700`, `text-brand-400`, `--spm-*`, etc.) re-themes automatically.

Out of scope: hunting down and converting hardcoded hex values still living in individual page/component files (~12k per the CLAUDE.md hex-audit baseline) — that remains separate future work, unaffected by this change.

Untouched: `--sev-*` (severity), `--pri-*`/`--spm-pri-*`/`--spm-stat-*` (CAD priority/unit-status) — these carry fixed operational meaning across every theme and are not brand chrome.

## New palette

One navy-gray-blue ramp, lighter than today's `#1a3350` base, with every surface/border/chrome/tile color re-derived from it instead of mixed hues. Approved via swatch mockup against the current (too-dark, clashing) values.

| Token | Current | New |
|---|---|---|
| `--surface-base` | `#1a3350` | `#22405f` |
| `--surface-raised` | `#24476c` | `#2c4f74` |
| `--surface-sunken` | `#132840` | `#1a3350` |
| `--surface-overlay` / `--surface-deep` | `#0f2038` | `#142840` |
| `--border-default` | `#3d5a7d` | `#46688c` |
| `--border-subtle` | `#223850` | `#2a4763` |
| `--border-strong` | `#6b88ac` | `#7996b8` |
| `--border-panel` | `#345071` | `#3d5f82` |
| `--brand-blue` (accent) | `#4f8fdb` | `#5a9ae0` |
| `--brand-gold` (silver accent) | `#b7c2cf` | `#c3ccd6` |

Everything else in the block that's currently derived from the old surface/border/accent values — `--record-tile-*`, `--rmpg-*-rgb`, `--brand-*-rgb`, `--blue-*-rgb`, `--brand-gold-*-rgb`, `--spm-chrome/form/field/border/accent`, `--spm-group-head`/`--spm-toolbar*` gradients, `--toolbar-gradient-*`, `--grid-header-bg`, `--grid-row-alt`, `--field-label-color`, `--surface-panel*`, `--surface-hover`, `--info-*`, `--desktop-shell-*` — gets re-derived from this same new ramp so nothing clashes with it.

`--sev-*` and `--sev-*-rgb` stay exactly as they are today.

## Verification

- `client/index.html` boot script + `UserPreferencesContext` resolve `html.theme-blue-silver` by default (per CLAUDE.md) — no code path changes needed, only the CSS values.
- Load the app in preview, confirm Dashboard, Dispatch, and Map (the three screenshots) show the lighter, unified navy-gray-blue, and that `.tactical-dark` surfaces (live map/dashcam/MDT/nav) are unaffected since they intentionally force their own fixed dark values.
- Spot-check a Records page for `--spm-*` consistency.
