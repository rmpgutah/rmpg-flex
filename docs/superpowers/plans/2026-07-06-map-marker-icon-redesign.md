# Map Marker Icon Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace unit markers on every map surface with a fixed-orientation photo icon (the RAM 1500 reference image) + colored status ring + always-visible call-sign label, while leaving call markers unchanged (still a flat, priority-colored rounded shape).

**Architecture:** There is no single shared unit-marker builder today — three independent functions across three files each build their own marker DOM, one per map surface. Rather than force a risky consolidation into one new shared module, this plan updates each of the three existing functions in place, in an identical visual style, with zero changes to any call site (every function keeps its existing signature).

**Tech Stack:** React 18 + TypeScript, vanilla DOM APIs (`document.createElement`), Mapbox GL JS markers (`new mapboxgl.Marker({ element })`), Vite static asset serving from `client/public/`.

---

## Important scope correction from the design spec

The design spec assumed one shared builder file (`client/src/pages/map/utils/mapMarkers.ts`) used by both mini-map components. Investigating the actual code turned up **three separate builder functions**, each with its own call sites:

1. **`client/src/pages/map/utils/mapMarkers.ts`**'s `buildUnitMarkerEl(unit: MapUnit): HTMLDivElement` — called by `client/src/pages/map/MapboxMapPage.tsx:650` (the main `/map` page) **and** `client/src/components/DashboardMiniMap.tsx` (the Dashboard's own mini-map — a fourth map surface not named in the original spec, but it uses this exact function, so updating it here covers that surface for free).
2. **`client/src/utils/mapMarkers.ts`**'s `buildUnitMarker(opts: UnitMarkerOpts): HTMLElement` — called twice by `client/src/components/DispatchMiniMap.tsx` (currently unreachable dead code per this session's earlier `MapEngine` investigation, but updated anyway per the spec's "for consistency" scope).
3. **`client/src/components/MapboxMiniMap.tsx`**'s own inline `buildUnitMarkerEl(callSign: string, status?: UnitStatus): HTMLElement` (function-local, not exported) — the live Dispatch mini-map, the surface that actually renders on `/dispatch` today.

Each of the three tasks below rewrites one of these functions' internals. No caller needs to change.

## Precondition — the vehicle photo asset

This plan cannot proceed past Task 1 until the reference photo exists as a real file in the repo. It currently only exists as an image pasted into the design conversation.

- [ ] **Step 0: Confirm the asset file is in place**

Check for the file:

```bash
ls -la "client/public/icons/unit-vehicle.jpg" "client/public/icons/unit-vehicle.png" 2>/dev/null
```

If neither exists, **stop and ask the user to place the file** at `client/public/icons/unit-vehicle.jpg` (or `.png` — match whatever format they provide) before continuing. Do not fabricate a placeholder image or substitute a different photo — the user confirmed rights to this specific file and expects to see it on the map. Note the exact filename/extension found; it's referenced literally in every task below as `/icons/unit-vehicle.jpg` (update the extension in every snippet below if the real file is `.png`).

---

### Task 1: Rewrite `buildUnitMarkerEl` in `client/src/pages/map/utils/mapMarkers.ts` (main `/map` page + Dashboard mini-map)

**Files:**
- Modify: `client/src/pages/map/utils/mapMarkers.ts:23-38` (replace the body of `buildUnitMarkerEl`)

- [ ] **Step 1: Replace the function body**

Find the existing function:

```typescript
/** Build HTML for a unit marker element. */
export function buildUnitMarkerEl(unit: Unit): HTMLDivElement {
  const color = UNIT_STATUS_COLORS[unit.status] || '#888888';
  const el = document.createElement('div');
  el.className = 'rmpg-mbx-unit';
  el.style.cssText = `
    width:32px;height:32px;border-radius:2px;
    background:${color};border:2px solid ${TACTICAL_BRAND_GOLD};
    display:flex;align-items:center;justify-content:center;
    font-size:9px;font-weight:700;color:#fff;
    font-family:ui-monospace,monospace;cursor:pointer;
    box-shadow:0 0 6px ${color}80;
    transition:box-shadow .2s;
  `;
  el.textContent = unit.call_sign.slice(0, 4);
  el.title = `${unit.call_sign} — ${UNIT_STATUS_LABELS[unit.status] || unit.status}`;
  return el;
}
```

Replace it with:

```typescript
/** Build a fixed-orientation photo-icon unit marker: vehicle photo + status ring + call-sign label. */
export function buildUnitMarkerEl(unit: Unit): HTMLDivElement {
  const color = UNIT_STATUS_COLORS[unit.status] || '#888888';
  const el = document.createElement('div');
  el.className = 'rmpg-mbx-unit';
  el.style.cssText = `
    display:flex;flex-direction:column;align-items:center;gap:2px;
    cursor:pointer;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.6));
  `;
  el.title = `${unit.call_sign} — ${UNIT_STATUS_LABELS[unit.status] || unit.status}`;

  const photoFrame = document.createElement('div');
  photoFrame.style.cssText = `
    width:40px;height:40px;border-radius:4px;overflow:hidden;
    border:3px solid ${color};box-shadow:0 0 6px ${color}80;
    background:#0d1520;
  `;
  const img = document.createElement('img');
  img.src = '/icons/unit-vehicle.jpg';
  img.alt = '';
  img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
  // Fallback: if the photo fails to load (bad connectivity, missing asset),
  // never leave a broken-image icon on the map — swap to a plain
  // status-colored square instead.
  img.onerror = () => {
    photoFrame.style.background = color;
    img.remove();
  };
  photoFrame.appendChild(img);
  el.appendChild(photoFrame);

  const label = document.createElement('div');
  label.style.cssText = `
    background:#101820;border:1.2px solid ${color};border-radius:2px;
    padding:1px 6px;font-size:9px;font-weight:700;color:${color};
    font-family:ui-monospace,monospace;white-space:nowrap;
  `;
  label.textContent = unit.call_sign.slice(0, 6);
  el.appendChild(label);

  return el;
}
```

Note: `UNIT_STATUS_LABELS` is already imported and used unchanged; the old `textContent`/`background` logic is gone. `TACTICAL_BRAND_GOLD` may become unused in this file after this change — check with the next step before removing the import.

- [ ] **Step 2: Check for now-unused imports**

Run:
```bash
grep -n "TACTICAL_BRAND_GOLD" client/src/pages/map/utils/mapMarkers.ts
```
If `TACTICAL_BRAND_GOLD` only appears in the `import` line now (no other usages), remove it from the `import { ... } from './tacticalPalette'` line at the top of the file. Leave it if `buildUnitPopupHtml` or another function in the file still references it.

- [ ] **Step 3: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/map/utils/mapMarkers.ts
git commit -m "feat(map): photo-icon unit markers on the main map + Dashboard mini-map"
```

---

### Task 2: Rewrite `buildUnitMarker` in `client/src/utils/mapMarkers.ts` (DispatchMiniMap.tsx, currently dead code)

**Files:**
- Modify: `client/src/utils/mapMarkers.ts:82-128` (replace the body of `buildUnitMarker`, drop the unused heading-arrow branch)

- [ ] **Step 1: Replace the function body**

Find the existing function (including its heading-arrow branch):

```typescript
/** Clean circular unit marker with status-colored ring + centered label. */
export function buildUnitMarker(opts: UnitMarkerOpts): HTMLElement {
  const color = unitStatusColor(opts.status);
  const el = document.createElement('div');
  // Record the resolved status color verbatim (the DOM normalizes hex in
  // `style` to rgb(), so callers/tests can read the canonical hex from here).
  el.dataset.statusColor = color;
  applyStyles(el, {
    width: '22px',
    height: '22px',
    'border-radius': '50%',
    background: '#000000',
    border: `2px solid ${color}`,
    'box-shadow': `0 0 6px ${color}, 0 1px 3px rgba(0,0,0,0.6)`,
    display: 'flex',
    'align-items': 'center',
    'justify-content': 'center',
    'font-family': '"JetBrains Mono",monospace',
    'font-size': '10px',
    'font-weight': '700',
    color: '#fff',
    cursor: 'pointer',
  });
  if (opts.label) {
    const span = document.createElement('span');
    span.textContent = opts.label;       // text node — no HTML injection
    el.appendChild(span);
  }
  if (typeof opts.heading === 'number') {
    const arrow = document.createElement('div');
    applyStyles(arrow, {
      position: 'absolute',
      top: '-6px',
      left: '50%',
      transform: 'translateX(-50%)',
      width: '0',
      height: '0',
      'border-left': '4px solid transparent',
      'border-right': '4px solid transparent',
      'border-bottom': `6px solid ${color}`,
    });
    el.style.position = 'relative';
    el.appendChild(arrow);
    el.style.transform = `rotate(${opts.heading}deg)`;
  }
  return el;
}
```

Replace it with:

```typescript
/** Fixed-orientation photo-icon unit marker: vehicle photo + status ring + label. Never rotates — opts.heading is ignored by design (a 3/4-angle photo spinning in place looks broken). */
export function buildUnitMarker(opts: UnitMarkerOpts): HTMLElement {
  const color = unitStatusColor(opts.status);
  const el = document.createElement('div');
  el.dataset.statusColor = color;
  applyStyles(el, {
    display: 'flex',
    'flex-direction': 'column',
    'align-items': 'center',
    gap: '2px',
    cursor: 'pointer',
  });

  const photoFrame = document.createElement('div');
  applyStyles(photoFrame, {
    width: '40px',
    height: '40px',
    'border-radius': '4px',
    overflow: 'hidden',
    border: `3px solid ${color}`,
    'box-shadow': `0 0 6px ${color}80`,
    background: '#0d1520',
  });
  const img = document.createElement('img');
  img.src = '/icons/unit-vehicle.jpg';
  img.alt = '';
  applyStyles(img, {
    width: '100%',
    height: '100%',
    'object-fit': 'cover',
    display: 'block',
  });
  img.onerror = () => {
    photoFrame.style.background = color;
    img.remove();
  };
  photoFrame.appendChild(img);
  el.appendChild(photoFrame);

  if (opts.label) {
    const labelEl = document.createElement('div');
    applyStyles(labelEl, {
      background: '#101820',
      border: `1.2px solid ${color}`,
      'border-radius': '2px',
      padding: '1px 6px',
      'font-size': '9px',
      'font-weight': '700',
      color,
      'font-family': '"JetBrains Mono",monospace',
      'white-space': 'nowrap',
    });
    labelEl.textContent = opts.label;
    el.appendChild(labelEl);
  }

  return el;
}
```

`UnitMarkerOpts.heading` stays in the type (harmless, no caller passes it today per the grep already run this session), it's just no longer read.

- [ ] **Step 2: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/utils/mapMarkers.ts
git commit -m "feat(map): photo-icon unit markers in the shared mapMarkers utility (DispatchMiniMap)"
```

---

### Task 3: Rewrite the inline `buildUnitMarkerEl` in `client/src/components/MapboxMiniMap.tsx` (the live Dispatch mini-map)

**Files:**
- Modify: `client/src/components/MapboxMiniMap.tsx:84-110` (replace the body of the function-local `buildUnitMarkerEl`)

- [ ] **Step 1: Replace the function body**

Find the existing function:

```typescript
/** Build a unit marker DOM element */
function buildUnitMarkerEl(callSign: string, status?: UnitStatus): HTMLElement {
  const color = UNIT_STATUS_HEX[status || 'available'] || '#888888';
  const el = document.createElement('div');
  el.style.cssText = `
    display:flex;flex-direction:column;align-items:center;
    filter:drop-shadow(0 1px 4px rgba(0,0,0,0.5));cursor:pointer;
  `;

  const tag = document.createElement('div');
  tag.style.cssText = `
    background:${color};color:#fff;font-size:8px;font-weight:900;
    padding:2px 5px;border:1.5px solid rgba(255,255,255,0.8);
    white-space:nowrap;font-family:'JetBrains Mono',monospace;
    border-radius:1px;box-shadow:0 0 6px ${color}40;
  `;
  tag.textContent = callSign;

  const caret = document.createElement('div');
  caret.style.cssText = `
    width:0;height:0;border-left:4px solid transparent;
    border-right:4px solid transparent;border-top:5px solid ${color};
  `;

  el.appendChild(tag);
  el.appendChild(caret);
  return el;
}
```

Replace it with:

```typescript
/** Build a fixed-orientation photo-icon unit marker: vehicle photo + status ring + call-sign label. Never rotates. */
function buildUnitMarkerEl(callSign: string, status?: UnitStatus): HTMLElement {
  const color = UNIT_STATUS_HEX[status || 'available'] || '#888888';
  const el = document.createElement('div');
  el.style.cssText = `
    display:flex;flex-direction:column;align-items:center;gap:2px;
    filter:drop-shadow(0 1px 4px rgba(0,0,0,0.5));cursor:pointer;
  `;

  const photoFrame = document.createElement('div');
  photoFrame.style.cssText = `
    width:40px;height:40px;border-radius:4px;overflow:hidden;
    border:3px solid ${color};box-shadow:0 0 6px ${color}80;
    background:#0a0a0a;
  `;
  const img = document.createElement('img');
  img.src = '/icons/unit-vehicle.jpg';
  img.alt = '';
  img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
  img.onerror = () => {
    photoFrame.style.background = color;
    img.remove();
  };
  photoFrame.appendChild(img);
  el.appendChild(photoFrame);

  const tag = document.createElement('div');
  tag.style.cssText = `
    background:#0a0a0a;color:${color};font-size:8px;font-weight:900;
    padding:1px 5px;border:1.2px solid ${color};
    white-space:nowrap;font-family:'JetBrains Mono',monospace;
    border-radius:1px;
  `;
  tag.textContent = callSign;
  el.appendChild(tag);

  return el;
}
```

The trailing "caret" pointer element is gone — it was part of the old teardrop-pin look, which doesn't apply to a photo-frame + label stack.

- [ ] **Step 2: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/MapboxMiniMap.tsx
git commit -m "feat(map): photo-icon unit markers on the live Dispatch mini-map"
```

---

### Task 4: Final smoke test + PR

**Files:** none (verification + PR only)

- [ ] **Step 1: Full client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 2: Full client test suite**

Run: `cd client && npx vitest run`
Expected: no new failures (no test files reference any of the three modified functions — confirmed during the design phase — so this run should be identical to the pre-change baseline).

- [ ] **Step 3: Manual verification in the dev-server preview**

Start the client + worker dev servers, log in, and check:
- `/dispatch` — the mini-map's unit markers show the vehicle photo with a colored ring and a readable call-sign label below it, for at least one unit in each of a few different statuses if test data allows.
- `/map` — same check on the main operational map.
- The Dashboard page's mini-map widget — same check.
- Trigger the broken-image fallback manually (e.g. temporarily rename `client/public/icons/unit-vehicle.jpg` and reload) to confirm the marker falls back to a plain status-colored square instead of a broken-image icon, then restore the file.

If manual browser verification isn't possible in the environment executing this plan, say so explicitly in the final report rather than claiming it was done.

- [ ] **Step 4: Push branch and open PR**

```bash
git push -u origin HEAD
gh pr create --title "feat(map): photo-icon unit markers across all map surfaces" --body "$(cat <<'EOF'
## Summary
- Replaces unit markers on every map surface with a fixed-orientation vehicle photo icon + colored status ring + always-visible call-sign label, per the approved design spec.
- Call markers are unchanged (still the flat, priority-colored rounded shape).
- Updates three independent existing builder functions in place (no shared module was introduced — see the plan's "scope correction" note for why):
  - `client/src/pages/map/utils/mapMarkers.ts`'s `buildUnitMarkerEl` — covers the main `/map` page and the Dashboard mini-map
  - `client/src/utils/mapMarkers.ts`'s `buildUnitMarker` — covers `DispatchMiniMap.tsx` (currently unreachable dead code, updated for consistency)
  - `client/src/components/MapboxMiniMap.tsx`'s inline `buildUnitMarkerEl` — covers the live Dispatch mini-map
- Icon never rotates with GPS heading (explicit design decision — a 3/4-angle photo spinning in place looks broken).
- Falls back to a plain status-colored square if the photo asset fails to load.

Spec: docs/superpowers/specs/2026-07-06-map-marker-icon-redesign-design.md

## Test plan
- [ ] `cd client && npx tsc --noEmit` passes
- [ ] `cd client && npx vitest run` passes
- [ ] Manual: `/dispatch` mini-map shows photo icon + status ring + label
- [ ] Manual: `/map` main page shows the same
- [ ] Manual: Dashboard mini-map shows the same
- [ ] Manual: broken-image fallback confirmed (temporarily rename the asset, reload, confirm graceful fallback)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Follow the standing PR workflow**

Once CI runs, run `gh pr checks <N> --repo rmpgutah/rmpg-flex` and address any real failures or Gitar review comments per this session's established pattern (reply via `gh api` ending with `_🤖 Addressed by [Claude Code](https://claude.com/claude-code)_`, then resolve via GraphQL).
