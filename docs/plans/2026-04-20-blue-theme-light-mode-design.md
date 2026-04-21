# Blue Theme "Light Mode" — Design Document

**Date:** 2026-04-20
**Author:** chzamo@rmpgutah.us (via Claude)
**Status:** Approved, ready for implementation plan

## Problem Statement

The current RMPG Flex UI uses a muted navy-blue palette (`#141e2b` surfaces, `#1a5a9e` brand accents). Users want a second theme option — a brighter, more blue-saturated variant — selectable per device. This will be called **"Light Mode"** (the existing look becomes **"Dark Mode"**), with Dark Mode remaining the default.

Note on naming: "Light Mode" here does **not** mean a white/light-background theme. It means "the lighter, more vibrant blue" relative to the subdued current theme. Scope intentionally excludes a true light-background mode — that would require inverting text colors across every component and falls outside this effort.

## Goals

- Provide a second selectable theme that is visually distinct at a glance
- Persist the user's choice on their device (no backend changes)
- Zero component code churn — only CSS variable values change
- Preserve status semantic colors (green/red/amber) and brand gold across both modes
- Keyboard shortcut + menu toggle for easy switching

## Non-Goals

- Per-user cloud sync of theme preference (can be added later if needed)
- True light-background (white surface / dark text) theme
- System-level `prefers-color-scheme` auto-detection (explicit user choice only, for now)
- Admin-level org-wide theme enforcement
- Modifying status colors, brand gold, fonts, or component layouts

## Architecture

### CSS Variables Scoped by `data-theme` Attribute

The existing `:root` block in `client/src/index.css` keeps the current (Dark Mode) values. A new `:root[data-theme="light"]` block overrides only the color custom properties. All component CSS already uses `var(--surface-base)`, `var(--border-default)`, etc., so a single attribute flip re-themes the entire app.

```css
:root {
  --surface-base: #141e2b;   /* Dark Mode (default) */
  --surface-raised: #1a2636;
  /* ...existing vars... */
}

:root[data-theme="light"] {
  --surface-base: #0d2a4d;   /* Light Mode override */
  --surface-raised: #153a6a;
  /* ...override vars only... */
}
```

Tailwind utilities (`bg-surface-base`, `border-rmpg-700`) resolve these vars at style computation, so no rebuild or Tailwind config changes are required.

### React Theme Context + Hook

A lightweight `ThemeProvider` wraps `<App />` at the root. It:

1. Reads `localStorage.getItem('rmpg-theme')` on mount (default `'dark'`)
2. Calls `document.documentElement.setAttribute('data-theme', theme)` on every change
3. Writes back to `localStorage` on toggle
4. Exposes `{ theme, setTheme, toggle }` via `useTheme()` hook

### Flash-Of-Unstyled-Content Prevention

React renders after bundle parse. If theme applies only after mount, users may see a ~100ms flash of the wrong theme on first paint. Mitigation: inline 4-line synchronous `<script>` in `client/index.html` that reads `localStorage` and sets `data-theme` on `<html>` before the bundle loads.

```html
<script>
  try {
    var t = localStorage.getItem('rmpg-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
</script>
```

## Palette

Only the colors in this table change between modes. Text colors, status semantic colors (green/red/amber for active/alert/warning), brand gold (`#d4a017`), fonts, spacing, and typography scales are identical across both modes.

| CSS Variable       | Dark Mode (default) | Light Mode       | Notes                                |
|--------------------|---------------------|------------------|--------------------------------------|
| `--surface-base`   | `#141e2b`           | `#0d2a4d`        | Saturated navy, unmistakably blue    |
| `--surface-raised` | `#1a2636`           | `#153a6a`        | Brighter raised-panel background     |
| `--surface-sunken` | `#0d1520`           | `#081e3d`        | Deep blue rather than near-black     |
| `--surface-overlay`| `#0a1018`           | `#061630`        | Modal backdrop                       |
| `--surface-deep`   | `#060c14`           | `#041022`        | Deepest layer (body background)      |
| `--border-default` | `#1e3048`           | `#2a5a9e`        | Brand-blue tinted borders            |
| `--border-subtle`  | `#182840`           | `#234d87`        | Gentle blue divider                  |
| `--border-strong`  | `#2a3e58`           | `#3a75c2`        | Prominent brand-blue edge            |
| `--brand-blue`     | `#1a5a9e`           | `#2a75c2`        | Brighter CTAs, buttons, active state |
| `--brand-gold`     | `#d4a017`           | `#d4a017`        | Unchanged — reads on both backgrounds|
| `--text-primary`   | `#e5e7eb`           | `#e5e7eb`        | Unchanged                            |
| `--text-secondary` | `#9ca3af`           | `#9ca3af`        | Unchanged                            |
| `--text-muted`     | `#6b7280`           | `#6b7280`        | Unchanged                            |

### Hardcoded Hex Refactor

Two existing CSS classes in `index.css` bake hex values directly rather than using variables:

1. **`.panel-beveled`** — uses `#2a3e58` / `#3a5070` / `#0d1520` for the 3D bevel border effect
2. **`.panel-title-bar`** — uses `linear-gradient(180deg, #1e3048 0%, #162236 50%, #1a2636 100%)` for the title bar background

Refactor: extract three new CSS variables — `--bevel-light`, `--bevel-dark`, `--titlebar-gradient` — and reference them in both classes. Define alternate values in the `[data-theme="light"]` block so panels theme correctly. Estimated ~10 lines of CSS refactor.

## Toggle UI & Interaction

### Location

Top-right user menu dropdown (the existing menu that shows `chzamo@rmpgutah.us` and "Log out"). Single menu item between Settings and Log out:

```
┌───────────────────────────────┐
│  👤 chzamo@rmpgutah.us        │
├───────────────────────────────┤
│  ⚙️  Settings                  │
│  🌙 Dark Mode                  │  ← shows current mode + icon
│  🚪 Log out                    │
└───────────────────────────────┘
```

Icon swaps based on current theme: 🌙 in Dark Mode, ☀️ in Light Mode. Clicking toggles.

### Keyboard Shortcut

`Cmd/Ctrl + Shift + L` toggles theme. Registered globally in `ThemeProvider`. Matches convention used by Slack, Discord, VS Code. Non-destructive — users can undo instantly.

### Default Behavior

First-ever load (no `localStorage` value) → Dark Mode. This preserves current UX for every existing user. Opting into Light Mode is explicit.

## Files Changed

### New Files (2)

- `client/src/hooks/useTheme.ts` — Context provider + hook (~40 lines)
- `client/src/components/ThemeToggle.tsx` — Menu item component (~25 lines)

### Modified Files (4)

- `client/src/index.css` — Add `[data-theme="light"]` block + extract 3 new hardcoded-hex vars (~30 lines net)
- `client/index.html` — Add FOUC-prevention inline script (~4 lines)
- `client/src/main.tsx` — Wrap `<App />` in `<ThemeProvider>` (~2 lines)
- `client/src/components/Layout.tsx` — Insert `<ThemeToggle />` in user menu dropdown (~3 lines)

### Not Changed

- No component code (all already uses CSS vars via Tailwind utilities)
- No backend code
- No database schema
- No Tailwind config
- No service worker version bump (CSS-only changes don't invalidate SW cache)

## Testing Strategy

**Manual verification checklist:**

1. First load with empty `localStorage` → renders in Dark Mode (current appearance)
2. Toggle via menu → theme flips live, no page reload, persists across refresh
3. Toggle via `Cmd+Shift+L` → same behavior
4. Dev Tools → Application → Local Storage → `rmpg-theme` key present with correct value
5. Open second tab → loads in saved theme with no flash
6. Visit every major page (Dashboard, Dispatch, Map, Personnel, HR, Admin, Reports) in Light Mode → verify:
   - Panel borders visible (not blending into background)
   - Text remains readable (contrast ratio ≥ 4.5:1 on `#0d2a4d`)
   - Status badges (green/red/amber) still readable
   - Brand gold accents still visible
7. Keyboard-only user can reach toggle via menu → Tab navigation works

**Automated:** None for this phase — theme is pure visual/CSS with no logic branches. If the `useTheme` hook grows to handle cloud sync later, add a unit test then.

## Rollback Plan

If Light Mode causes issues in production:

1. Ship a hotfix that forces `data-theme="dark"` unconditionally in the inline boot script (1-line change)
2. Remove the `ThemeToggle` menu item (delete one JSX line)
3. Users' `localStorage` values remain but are ignored — no data loss

Full revert: drop the PR. No backend state to clean up.

## Risks & Mitigations

| Risk                                              | Mitigation                                          |
|---------------------------------------------------|-----------------------------------------------------|
| Flash of wrong theme on first paint                | Inline boot script sets attribute before React loads|
| Hardcoded hex in one-off components looks wrong   | Audit run during implementation; fix as found       |
| Contrast ratio on `#0d2a4d` fails WCAG AA          | Pre-test with Chrome DevTools contrast checker      |
| Brand gold (`#d4a017`) clashes on brighter blue   | Verified visually during palette selection          |
| Tiny risk: `data-theme` attribute name collision  | Unique prefix if needed (`rmpg-theme`) — low risk    |

## Open Questions (none blocking)

None remaining. All design decisions resolved during brainstorming.

## Appendix: Why Not Other Approaches

- **Cloud-synced user preference (DB column)**: Adds migration + endpoint + WebSocket sync for a visual preference. Deferred until we see demand.
- **System `prefers-color-scheme`**: Could be added later as a "follow system" option on top of the explicit dark/light.
- **Tailwind dark: variants**: Tailwind already emits the same CSS, this adds no value over the CSS variable approach and doubles utility class usage.
- **Separate CSS files loaded conditionally**: Adds a network roundtrip and cache-bust complexity for ~30 CSS values.
