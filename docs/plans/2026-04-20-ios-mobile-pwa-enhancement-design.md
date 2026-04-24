# iOS Mobile PWA Enhancement — v1 Design

**Date:** 2026-04-20
**Status:** Approved (brainstorming complete)
**Scope:** iOS Safari PWA (Add to Home Screen) — no native Capacitor wrap in v1
**Owner:** chzamo@rmpgutah.us

## Goal

Make RMPG Flex a first-class iPhone PWA experience for all roles (officer, dispatcher, supervisor, admin, contract manager, client viewer, HR) without rebuilding the desktop CAD console. Two parallel tracks:

- **Track A — Shell polish.** Universal iOS PWA hygiene (splash, safe areas, install coaching, no-zoom inputs, touch targets). Touches every page.
- **Track B — `/mobile` route.** New mobile-first card-grid dashboard that becomes the standalone-PWA home on phone-sized viewports. Desktop URLs unchanged.

## Non-Goals (YAGNI)

- Web Push notifications (separate project — requires VAPID + iOS 16.4+ gating)
- Offline write queue (read-only offline only)
- Haptics
- Capacitor iOS native wrap
- Per-card user reordering
- Per-page mobile rewrites of DispatchPage / MapPage / forms

## Architecture

### Track A — Shell polish

Files touched:
- `client/index.html` — add `apple-touch-startup-image` link tags (9 device sizes)
- `client/public/manifest.json` — add 180×180 `apple-touch-icon`, additional icon sizes
- `client/src/index.css` — safe-area utilities (`.safe-px`, `.safe-pb`), 16px input rule, 44px touch-target floor (mobile breakpoint only)
- `client/src/components/Layout.tsx` — wire safe-area insets into the mobile header (48px) and drawer
- `client/src/hooks/useStandalone.ts` (new) — exposes `{ isStandalone, isIOS, isMobileViewport }`
- `client/src/components/InstallCoachingModal.tsx` (new) — iOS-only Share→Add to Home Screen walkthrough, dismissible, 30-day localStorage suppression

Splash screen generation: source from existing `rmpg flex.png` (1024×1024). Sizes per Apple HIG: 2048×2732, 1668×2388, 1668×2224, 1620×2160, 1536×2048, 1290×2796, 1179×2556, 1284×2778, 1170×2532. Generated once into `client/public/splash/` (committed binaries).

### Track B — `/mobile` route

```
client/src/pages/mobile/
  MobileHomePage.tsx          orchestrator, prefetch, refresh-pull
  cards/
    UnitStatusCard.tsx        #1 — status change buttons (10-8/10-7/10-6/10-42)
    ActiveCallsCard.tsx       #2 — P1/P2 filter, distance from me
    QuickSearchCard.tsx       #3 — universal search input
    BolosCard.tsx             #4 — BOLO + premise alerts feed
    MapSnippetCard.tsx        #5 — small OpenLayers map (reuse map-v2 hooks)
    QuickActionsCard.tsx      #6 — FI / citation / incident shortcuts
    MessagesCard.tsx          #7 — unread count + recent thread
    ShiftCard.tsx             #8 — clock in/out, hours, calls handled
  hooks/
    useMobileLayout.ts        determines card order/visibility by role
    useGeolocation.ts         iOS-friendly watchPosition wrapper
```

Auto-redirect rule (in `App.tsx` router): if `display-mode: standalone` AND viewport `< 768px` AND path === `/`, redirect to `/mobile`. Direct desktop URL bookmarks unaffected.

Backend: zero new routes for v1. All cards consume existing `/api/dispatch/*`, `/api/records/universal-search`, `/api/dispatch-messages`, `/api/hr/shift/*`.

## Data Flow

**Initial load.** `Promise.all` of per-card `loader()` exports. Skeleton per card so a slow endpoint can't block the rest.

**Live updates.** Subscribe per-card to existing WS context, debounced 250ms:
- `unit_update` → `UnitStatusCard` (if my unit), `MapSnippetCard`
- `dispatch_update` → `ActiveCallsCard`, `MapSnippetCard`
- `bolo_update` / `premise_alert` → `BolosCard`
- `dispatch_message` → `MessagesCard` (badge + toast)
- `shift_update` → `ShiftCard`

**GPS.** `watchPosition({ enableHighAccuracy: true, maximumAge: 10000 })`. Permission triggered only when user toggles "Show distance" on `ActiveCallsCard` — never on page load (iOS denies unprompted requests).

**Pull-to-refresh.** Native iOS rubber-band disabled (`overscroll-behavior: none`). In-page pull gesture re-runs `Promise.all`. Reason: live WS updates already handle freshness; system PTR confused users about what reload meant.

**Offline.** Each card hydrates from IndexedDB last-known-good response on mount, greyed with "Last updated Xm ago" until live fetch resolves. Service worker stale-while-revalidate already handles `/api/*` GETs.

## Role-based Card Visibility

Driven by `useMobileLayout(role)`. Cards a role can't see are tree-shaken (dynamic import gated by role), not just hidden.

| Role | Cards | Order |
|---|---|---|
| officer | 1, 2, 3, 4, 5, 6, 7, 8 | as-listed |
| dispatcher | 2, 5, 7, 4, 3 | calls-first |
| supervisor | 2, 5, 1 (all units), 7, 4 | situational awareness |
| admin | 3, 2, 4, 7 | search-first |
| contract_manager | 8 (their staff), 2 (their sites only) | minimal |
| client_viewer | 4, 2 (their site only — read-only) | view-only |
| human_resources | 8 only | shift admin |

## Error Handling

- Per-card error boundary → compact retry chip; rest of page survives.
- 401 → existing token refresh. 403 → card hides silently (role drift). 5xx → exponential backoff (3 tries) then manual retry chip.
- WS disconnect → amber LED in page header ("Reconnecting…").
- GPS denial → distance/map cards collapse to "Enable Location in Settings" link, no nag.
- Hydration failure → existing `#pre-splash` stays visible; "Reload" button appears after 8s (added to `index.html`).

## Testing

- Vitest unit tests per card hook: empty / loading / error / populated states (mock WS + apiFetch).
- `MobileHomePage.smoke.test.ts` — module-load + minimal render (mirrors `MapPageV2` smoke pattern).
- Manual device matrix (documented, not automated — no iOS Safari in CI):
  - iPhone SE (smallest viewport)
  - iPhone 15 Pro (Dynamic Island)
  - iPhone 15 Pro Max (largest)
  - iPad mini portrait
  - Each tested in Safari tab AND installed standalone PWA
- Regression guards: install modal must NOT show on desktop; safe-area CSS must not shift desktop layout (use `@media (max-width: 767px)` guards).

## Rollout

1. Track A (shell polish) merges first — invisible on desktop, immediate iOS gain, low risk.
2. `/mobile` route ships behind direct-URL access for 1 week of staff dogfood.
3. Auto-redirect (`standalone + <768px` on `/`) enabled after stability confirmed.
4. No feature flag — gating is viewport + display-mode; reversible by removing redirect block in `App.tsx`.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Bad `/mobile` page traps installed-PWA users | Auto-redirect only on path `/`; users can always type any other URL |
| Safe-area CSS shifts desktop layout | All rules guarded by `@media (max-width: 767px)` |
| iOS standalone aggressively suspends WS | WS reconnect already handled by `useLiveSync`; cards re-fetch on focus |
| Splash screen binary bloat | Generated once, committed to `client/public/splash/` (~9 PNGs, ~500KB total) |
| Install coaching modal annoys desktop users | iOS-only detection via `useStandalone().isIOS` + viewport check |
| 30-day suppression localStorage cleared by iOS | Acceptable — modal reappears, user re-dismisses |

## Open Questions

None at design time. Implementation plan will surface specifics (e.g. exact card grid layout: 1-column vs 2-column on iPad mini portrait).

## Next Step

Hand off to `writing-plans` skill for step-by-step implementation plan.
