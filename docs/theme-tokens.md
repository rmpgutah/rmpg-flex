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
