# Desktop Personalization Overhaul — Design Spec

> Sixth feature build in the `/desktop` "Windows-style" system's 120-item planning
> program. Category: **Personalization** (per the Foundation-first order:
> Window Management → Taskbar → Desktop & Icons → Settings App →
> **Personalization** → Widgets → Search → Notifications → Records Explorer →
> Utility Apps → Start & Launcher → Accessibility). Follows the merged Settings
> App Shell (PR #2931).

## Current state

`DesktopSettingsApp.tsx`'s Personalization category has: 6 wallpaper presets,
5 accent-color presets, and (from the Settings App Shell build) its own
"Reset this category to default" button. There is no clock format control, no
desktop sound effects anywhere in the system, and no global window-transparency
baseline (only the existing per-window ±10% opacity control on each floating
window's title-bar context menu).

## Scope for this build

One chunk, all four:

1. Clock format (12h/24h) for the taskbar clock
2. Desktop sound effects — real sounds (window open/close/minimize, snap-to-edge)
   plus a toggle, since no desktop sound exists today for a toggle to gate
3. Window/panel transparency baseline — sets the default opacity for
   newly-opened windows; the existing per-window ±10% control still adjusts
   individually from whatever a window starts at
4. A few more wallpaper/accent preset options

## 1. Clock format (12h/24h)

New file `client/src/utils/clockPreference.ts` — localStorage, device-scoped,
mirroring `snapPreference.ts`'s pattern:

```ts
export type ClockFormat = '12h' | '24h';
export function getClockFormat(): ClockFormat
export function setClockFormat(format: ClockFormat): void
```

Storage key `rmpg_desktop_clock_format`, default `'24h'` (matches the
existing `useClock.ts`'s current `Intl.DateTimeFormat` output, which has no
explicit `hour12` option today — its default behavior for `'en-US'` is
actually 12-hour; **this build makes the format explicit and configurable
rather than leaving it as an accidental locale default**).

`client/src/hooks/useClock.ts`'s `format()` function reads
`getClockFormat()` and passes `hour12: format === '12h'` to the existing
`Intl.DateTimeFormat` call for `time`. No change to the `date` formatting.

Settings UI: a new "Clock Format" section in the Personalization category,
two buttons (12-hour / 24-hour), same visual pattern as the existing
Icon Size / View / Sort button-groups elsewhere in this file.

## 2. Desktop sound effects

New file `client/src/utils/desktopSoundPreference.ts` — localStorage,
device-scoped:

```ts
export function isDesktopSoundEnabled(): boolean
export function setDesktopSoundEnabled(enabled: boolean): void
```

Storage key `rmpg_desktop_sound_enabled`, default `true` (sounds on by
default — consistent with the existing app-wide `rmpg_action_chimes`
default-on convention).

New file `client/src/utils/desktopSounds.ts` — thin wrapper reusing the
already-built `playSoundAsset` (`client/src/utils/soundAssets.ts`) and its
existing `'click'` `UiSoundKey` (no new WAV assets are added in this build —
reusing what's already generated keeps this in scope):

```ts
export function playDesktopSound(): void {
  if (!isDesktopSoundEnabled()) return;
  playSoundAsset('click');
}
```

Wired into four call sites, each firing `playDesktopSound()` once per event:

- `DesktopWindowManager.tsx`'s `openWindow` (only on the "genuinely new
  window created" branch, not the "existing window refocused" branch — a
  refocus isn't a new-window event)
- `DesktopWindowManager.tsx`'s `closeWindow`
- `DesktopWindowManager.tsx`'s `minimizeWindow` (fires on both minimize and
  restore, matching how that toggle already works — a distinct sound isn't
  needed for the two directions, per the "felt more than heard" ethos this
  codebase already uses for UI clicks)
- `FloatingWindow.tsx`'s snap-to-edge `onUp` handler, only when a snap is
  actually applied (not on every drag release)

Settings UI: a "Desktop Sounds" checkbox in the Personalization category,
same visual pattern as the Taskbar category's existing "Auto-hide" checkbox.

## 3. Window/panel transparency baseline

Extends the already-built `taskbarPreferences.ts`... no — extends a NEW,
appropriately-scoped file `client/src/utils/windowOpacityPreference.ts`
(distinct from `taskbarPreferences.ts`, since this is about floating windows,
not the taskbar):

```ts
export function getDefaultWindowOpacity(): number
export function setDefaultWindowOpacity(opacity: number): void
```

Storage key `rmpg_desktop_default_window_opacity`, storing a string-encoded
number, default `1` (fully opaque — unchanged from today's behavior unless
a user explicitly lowers it). Uses the same `clampOpacity`-style rounding
already established in `DesktopWindowManager.tsx` (round to one decimal,
floor 0.3 — reuse that exact clamp range for consistency, but this is a
separate stored value, not a shared function, since `DesktopWindowManager.tsx`'s
`clampOpacity` is a private, unexported helper today; this build adds its own
equivalent clamp in the new file rather than reaching into that module's
internals).

`DesktopWindowManager.tsx`'s `openWindow` reads `getDefaultWindowOpacity()`
instead of hardcoding `opacity: 1` when constructing a new window's initial
state. The existing per-window ±10% context-menu control (`setWindowOpacity`)
is completely unchanged — it still adjusts from whatever opacity the window
started at, individually, exactly as it does today.

Settings UI: a "Window Transparency" section in the Personalization category
with two buttons ("Decrease"/"Increase", ±10% each, clamped 0.3–1.0), showing
the current baseline as a percentage label between them — mirroring the
interaction style of the existing per-window opacity context-menu (also
±10% steps), for consistency across the app.

## 4. More wallpaper/accent options

`client/src/data/desktopWallpapers.ts` gains 2 more entries (6 → 8) and
`client/src/data/desktopAccents.ts` gains 2 more (5 → 7), following the
exact existing `WallpaperPreset`/`AccentPreset` shape and CSS-variable-based
styling convention (no hardcoded hex) already used by every existing entry.
Concrete additions:

- Wallpapers: `{ id: 'steel-mesh', label: 'Steel Mesh', background: <a
  subtle diagonal-line CSS gradient using existing border/surface variables,
  following the same `linear-gradient(...)` construction style as the
  existing 'panel-grid' entry> }`, `{ id: 'twilight-fade', label: 'Twilight
  Fade', background: <a two-stop linear-gradient between two existing
  surface variables, following the same construction style as the existing
  'shift-gradient' entry> }`.
- Accents: verified against `client/src/styles/theme-palettes.css`'s actual
  `--stat-accent-*` tokens (`default`, `red`, `red-bright`, `green`, `amber`,
  `amber-bright`, `purple`, `silver`) — the existing 5 presets already use
  `red-bright`, `green`, `amber-bright`, `purple`, plus the default/silver
  pairing for "Blue & Silver". Two tokens remain unused: `red` (a deeper,
  less saturated red than the existing "Crimson" preset's `red-bright`) and
  `default` (a neutral muted gray, `var(--spm-text-muted)`). Add:
  `{ id: 'garnet', label: 'Garnet', accent: 'var(--stat-accent-red)',
  shadow: 'rgba(220, 38, 38, 0.35)' }`, `{ id: 'graphite', label: 'Graphite',
  accent: 'var(--stat-accent-default)', shadow: 'rgba(148, 163, 184, 0.35)' }`.
  If a future token audit shows either of these has since changed, the
  implementer should re-verify against the live file before using them
  verbatim, but as of this spec both are confirmed present.

## 5. Testing approach

- `clockPreference.ts` — unit tests mirroring `snapPreference.test.ts`
  (default, persistence).
- `useClock.ts` — extend/add tests verifying `format()`'s `time` output
  respects `getClockFormat()` (e.g. asserting the presence/absence of
  AM/PM markers for a known mocked `Date`, or checking `hour12` is passed
  correctly — whichever is more reliably assertable given `Intl` formatting
  specifics; read the existing test file if one exists for this hook first).
- `desktopSoundPreference.ts` — unit tests mirroring `snapPreference.test.ts`.
- `desktopSounds.ts` — unit test: `playDesktopSound()` calls `playSoundAsset('click')`
  when enabled, does not call it when disabled (mock `playSoundAsset`).
- `DesktopWindowManager.tsx` — extend existing tests: `openWindow` calls
  `playDesktopSound` once for a genuinely new window, not for a refocus;
  new windows get `opacity` from `getDefaultWindowOpacity()` instead of a
  hardcoded `1`; `closeWindow`/`minimizeWindow` each call `playDesktopSound`.
- `FloatingWindow.tsx` — extend existing snap-to-edge tests: `playDesktopSound`
  fires only when a snap is actually applied, not on every drag release.
- `windowOpacityPreference.ts` — unit tests: default value, persistence,
  clamp behavior (0.3 floor, 1.0 ceiling, one-decimal rounding).
- `DesktopSettingsApp.tsx` — extend existing tests: Clock Format buttons call
  the right setter and persist; Desktop Sounds checkbox toggles and persists;
  Window Transparency buttons adjust and clamp correctly, showing the right
  percentage label.
- `desktopWallpapers.ts`/`desktopAccents.ts` — no dedicated test files
  expected to exist for pure data arrays (consistent with how the original
  6/5 entries were added without their own test files) — verified instead
  through `DesktopSettingsApp.test.tsx`'s existing wallpaper/accent-swatch
  rendering tests picking up the new entries incidentally, or a small new
  assertion there confirming the array length grew as expected.

## Global constraints (carried from the project and prior desktop specs)

- All new preferences are `localStorage` (device-scoped), never D1/API — no
  new migration, no new column.
- All new chrome uses the project's CSS-variable-backed Tailwind tokens —
  never hardcoded hex. New wallpaper/accent entries must use only
  already-existing CSS variables, never introduce new ones.
- No new D1 migrations in this build.
- No new sound assets/WAV files are generated in this build — desktop sounds
  reuse the existing `'click'` `UiSoundKey` via `playSoundAsset`.
- The window-transparency baseline only affects newly-opened windows going
  forward; it must never retroactively change an already-open window's
  current opacity.
