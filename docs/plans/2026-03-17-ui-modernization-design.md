# UI Modernization Design — Phase 1: Layout Shell & Design System

**Date:** 2026-03-17
**Branch:** claude/loving-meninsky
**Status:** Approved

## Goal

Modernize the Spillman Flex / Motorola CAD aesthetic without losing the professional law enforcement identity. Evolutionary visual update — shadows replace bevels, transitions add smoothness, slightly larger text improves readability, and 4px border-radius softens the interface.

## Design Direction

**Style reference:** Axon Evidence / Motorola CommandCentral — modern dark CAD with authority.

## Phase 1 Scope: Layout Shell + Design System Foundation

### 1. CSS Variables & Tokens

Update `:root` in `index.css`:

| Token | Old | New | Reason |
|-------|-----|-----|--------|
| `--surface-base` | `#141e2b` | `#0f1722` | Deeper, more contrast |
| `--surface-raised` | `#1a2636` | `#1a2332` | Warmer steel-blue |
| `--surface-sunken` | `#0d1520` | `#0a1019` | Deeper inset |
| All border-radius | `2px` | `4px` | Modern but still authoritative |
| Base font size | `13px` | `14px` | Better readability |
| `micro` font | `9px` | `10px` | Accessibility floor |

New tokens:
```css
--shadow-card: 0 1px 3px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.2);
--shadow-card-hover: 0 4px 12px rgba(0,0,0,0.4), 0 0 0 1px rgba(26,90,158,0.2);
--shadow-dropdown: 0 8px 24px rgba(0,0,0,0.5);
--shadow-inset: inset 0 1px 2px rgba(0,0,0,0.2);
--transition-default: all 0.15s ease;
```

### 2. Tailwind Config

Update `tailwind.config.js`:
- `borderRadius`: all values → `4px` (keep `none: '0'`, `full: '9999px'`)
- `fontSize.micro`: 9px → 10px
- `fontSize.label`: 10px → 11px (letter-spacing stays)

### 3. Layout Shell Components

#### Brand Bar (~48px, down from 52px)
- Solid `--surface-base` background (drop gradient)
- Subtle `box-shadow` bottom edge instead of hard border
- Keep logo + text

#### Menu Bar (22px)
- Keep uppercase text
- Menu items: 4px border-radius on hover highlight
- Dropdowns: `--shadow-dropdown`, 4px border-radius, slight translucency
- Drop beveled dropdown borders → uniform single-color border

#### Icon Toolbar (46px)
- Keep blue gradient (soften start/end delta)
- Toolbar buttons: drop beveled borders → solid border + hover glow
- Active state: solid bg + 2px blue bottom indicator
- 150ms transitions

#### Status Bar (22px)
- Keep structure and density
- LED dots → `border-radius: 50%` (circular)
- Soften top border

### 4. Component Class Updates

#### Cards
- `.card-dark`: flat single-color border + `--shadow-card`
- `.card-dark-hover`: `--shadow-card-hover` + `translateY(-1px)` lift
- Drop `.panel-beveled` → new `.panel-modern` with flat border + shadow

#### Buttons
- 4px border-radius, single-color borders
- Keep uppercase
- Hover: brighter bg + subtle `translateY(-0.5px)` lift
- 150ms transitions on bg, shadow, transform

#### Inputs
- Drop multi-color bevel borders → single solid `--border-strong`
- Focus: keep blue ring + glow
- Add `--shadow-inset` for depth without bevel

#### Tables
- Header text: 10px → 11px
- Body text: 11px → 12px
- Drop inter-column border-right separators
- Stronger hover row highlight + smooth transition

#### Badges
- 4px border-radius (was 2px)
- Same colors
- Slightly more padding

#### Tabs
- Text: 10px → 11px
- Active: blue bottom indicator (2px solid brand-blue)
- Smooth transitions

#### LED Indicators
- `border-radius: 50%` (circular)
- Keep glow shadows
- Keep pulse/blink animations

### 5. What Does NOT Change

- Color palette (surfaces, brand blue, gold, status colors)
- Layout structure (brand bar + menu bar + toolbar + content + status bar)
- LED glow effects
- Priority border left-accents
- CAD command line styling
- NCIC terminal styling
- Panic button styling
- Uppercase text everywhere
- F1-F12 keyboard shortcuts
- Mobile drawer/bottom nav structure

## Files to Modify

### Phase 1 Core (design system):
1. `client/tailwind.config.js` — border-radius, font sizes
2. `client/src/index.css` — CSS variables, component classes

### Phase 1 Shell (layout components):
3. `client/src/components/Layout.tsx` — brand bar, toolbar structure
4. `client/src/components/MenuBar.tsx` — dropdown styling
5. `client/src/components/StatusBar.tsx` — LED dots, border

### Phase 1 Verification:
6. Visual check of Dashboard, Dispatch, and Admin pages after changes
7. Mobile layout check

## Future Phases (not in scope)

- Phase 2: Dashboard page redesign
- Phase 3: Dispatch page modernization
- Phase 4: Records & forms overhaul
- Phase 5: Admin panel cleanup
