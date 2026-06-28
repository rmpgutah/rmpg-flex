# Full UI Overhaul — Login Design Language Propagation

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Propagate the login page's premium visual language (drifting grid background, scan-line overlays, animated logo rings, gradient title bars, glass-panel depth, LED glow effects, ambient radial glow, particle-style animations) across the entire app — shell, shared components, and all major pages — creating a unified, cohesive "Spillman Flex CAD" aesthetic.

**Architecture:** CSS-first approach. Define all new visual patterns as reusable CSS classes in `index.css`, then apply them via className changes in components. This minimizes per-file code changes and keeps the design system centralized. Personnel module already uses this pattern (`stat-pod`, `section-header`, `cascade-item`, etc.) — we extend it app-wide.

**Tech Stack:** React 18 + TypeScript + Tailwind CSS + CSS custom properties. No new dependencies.

---

## Design DNA (Extracted from LoginPage.tsx)

These are the **exact patterns** from the login page that will be generalized:

| Login Pattern | Generalized Class | Description |
|---|---|---|
| `login-grid-bg` | `app-grid-bg` | Drifting blue grid lines behind content |
| `login-vignette` | `app-vignette` | Radial gradient darkening at edges |
| `login-scan-line` | `scan-line` | Already exists as `login-scan-line` + `dash-scan-line` — unify |
| `login-card-accent` | `card-accent` | Centered gradient line at top of cards |
| `login-card` hover glow | `card-glass` | Panel with hover glow + transition |
| `login-title-bar` | `panel-title-bar` upgrade | Already exists — enhance with gradient |
| `login-step-enter` | `animate-step-enter` | Slide-up + fade entrance |
| `login-btn-primary` | `btn-primary` upgrade | Gradient + hover lift + glow shadow |
| `login-input-glow` | `input-dark` upgrade | Brand-blue focus ring with glow |
| `login-badge-ok` | `status-badge` | Status indicator with LED dot |
| `login-method-card` | `action-card` | Clickable card with hover glow + lift |
| `login-error-shake` | `alert-shake` | Error message shake animation |

---

## Phase 1: CSS Foundation (index.css)

### Task 1: Add Global Background & Ambient Classes

**Files:**
- Modify: `client/src/index.css` (add after login CSS section, ~line 450)

**Step 1: Add the new generalized CSS classes**

These classes generalize the login page patterns for app-wide use:

```css
/* ============================================================
   GLOBAL AMBIENT — Login-derived design language
   Drifting grid, vignette, scan-line, glass panels
   ============================================================ */

/* App-wide drifting grid background (opt-in per container) */
.app-grid-bg {
  position: relative;
}
.app-grid-bg::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background-image:
    linear-gradient(rgba(26, 90, 158, 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(26, 90, 158, 0.03) 1px, transparent 1px);
  background-size: 40px 40px;
  animation: login-grid-drift 25s linear infinite;
  mask-image: radial-gradient(ellipse at center, black 50%, transparent 90%);
  -webkit-mask-image: radial-gradient(ellipse at center, black 50%, transparent 90%);
}

/* Vignette overlay for depth */
.app-vignette::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background: radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.25) 100%);
}

/* Scan-line — unifies login-scan-line and dash-scan-line */
.scan-line {
  position: relative;
  overflow: hidden;
}
.scan-line::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(26, 90, 158, 0.12), transparent);
  animation: login-scan 10s linear infinite;
  pointer-events: none;
  z-index: 1;
}

/* Glass card — hover glow + transition (login-card pattern) */
.card-glass {
  background: var(--surface-base);
  border: 1px solid var(--border-default);
  transition: box-shadow 0.3s ease, border-color 0.3s ease;
  position: relative;
}
.card-glass:hover {
  box-shadow: 0 4px 24px rgba(26, 90, 158, 0.08), 0 0 0 1px rgba(26, 90, 158, 0.12);
  border-color: rgba(26, 90, 158, 0.25);
}

/* Card top accent line (login-card-accent pattern) */
.card-accent::before {
  content: '';
  position: absolute;
  top: 0;
  left: 10%;
  right: 10%;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--brand-blue), transparent);
  z-index: 2;
}

/* Action card — clickable card with hover lift (login-method-card pattern) */
.action-card {
  background: rgba(13, 21, 32, 0.6);
  border: 1.5px solid var(--border-default);
  cursor: pointer;
  transition: all 0.25s ease;
}
.action-card:hover {
  border-color: var(--brand-blue);
  background: rgba(26, 90, 158, 0.06);
  box-shadow: 0 0 12px rgba(26, 90, 158, 0.12);
  transform: translateY(-1px);
}

/* Step entrance animation (login-step-enter generalized) */
.animate-step-enter {
  animation: login-fade-in 0.3s ease-out;
}

/* Error shake (login-error-shake generalized) */
.alert-shake {
  animation: login-shake 0.5s ease-in-out;
}

/* Status badge with LED dot (login-badge-ok generalized) */
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 6px;
  font-size: 7px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  border-radius: 2px;
}
.status-badge-ok {
  background: rgba(34, 197, 94, 0.08);
  border: 1px solid rgba(34, 197, 94, 0.2);
  color: #4ade80;
}
.status-badge-warn {
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.2);
  color: #fbbf24;
}
.status-badge-error {
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.2);
  color: #f87171;
}
.status-badge-info {
  background: rgba(26, 90, 158, 0.08);
  border: 1px solid rgba(26, 90, 158, 0.2);
  color: #4a9aee;
}
```

**Step 2: Enhance existing btn-primary with login-btn-primary gradient + lift**

Upgrade the existing `.btn-primary` to match login page quality:

```css
/* Replace existing .btn-primary definition */
.btn-primary {
  @apply inline-flex items-center gap-1.5 px-3 py-1.5 text-white text-xs font-bold uppercase tracking-wide shadow-sm focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed;
  background: linear-gradient(135deg, #1a5a9e 0%, #0e3d6e 100%);
  border: 1px solid #1a5a9e;
  box-shadow: 0 2px 8px rgba(26, 90, 158, 0.2), inset 0 1px 0 rgba(255,255,255,0.06);
  transition: all 0.2s ease;
}
.btn-primary:hover:not(:disabled) {
  background: linear-gradient(135deg, #2570b5 0%, #1a5a9e 100%);
  box-shadow: 0 4px 16px rgba(26, 90, 158, 0.35), inset 0 1px 0 rgba(255,255,255,0.08);
  transform: translateY(-1px);
}
.btn-primary:active:not(:disabled) {
  transform: translateY(0);
  box-shadow: 0 1px 4px rgba(26, 90, 158, 0.15);
}
```

**Step 3: Enhance existing input-dark with glow focus**

Add the login-input-glow quality to the default input-dark:

```css
/* Upgrade .input-dark:focus to match login page quality */
.input-dark:focus {
  border-color: var(--brand-blue);
  box-shadow: 0 0 0 1px rgba(26, 90, 158, 0.3), 0 0 12px rgba(26, 90, 158, 0.12);
}
```

**Step 4: Verify build**

Run: `cd client && npx vite build`
Expected: 0 errors

**Step 5: Commit**

```bash
git add client/src/index.css
git commit -m "enhance: add global ambient CSS classes (login design language)"
```

---

## Phase 2: App Shell Upgrade

### Task 2: Brand Bar Enhancement

**Files:**
- Modify: `client/src/components/Layout.tsx` (brand bar section, ~line 657-870)

**Changes:**
1. Add scan-line overlay to brand bar (subtle, like login card)
2. Enhance brand bar gradient to match login title-bar gradient
3. Add card-accent line at top (replace the static blue line)
4. Add `app-grid-bg` class to brand bar for subtle grid texture
5. Status indicators: add hover glow states, use `status-badge` class pattern
6. Profile avatar: add ring-pulse animation on hover (like login logo rings)

**Key code changes:**

Brand bar outer div:
```tsx
// Before:
style={{ background: 'linear-gradient(180deg, #1a2636 0%, #141e2b 100%)' }}

// After — match login title-bar gradient:
className="scan-line"
style={{ background: 'linear-gradient(180deg, #162640 0%, #0f1a28 100%)' }}
```

Top accent line:
```tsx
// Before: static div
<div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: 'linear-gradient(90deg, #0e3359, #1a5a9e, #0e3359)' }} />

// After: card-accent class (centered, fading)
<div className="absolute top-0 left-0 right-0 h-px card-accent" />
```

Status indicator pills — wrap each in `status-badge` class for consistency.

**Step: Verify build, then commit:**
```bash
git commit -m "enhance: upgrade brand bar with login design language"
```

### Task 3: Menu Bar Enhancement

**Files:**
- Modify: `client/src/components/MenuBar.tsx` (rendering section)

**Changes:**
1. Menu bar gradient → match login title-bar gradient
2. Add subtle scan-line effect
3. OPR info text → `font-mono` with brand-blue glow on badge number

This is a light touch — menu bar already looks decent.

### Task 4: Icon Toolbar Enhancement

**Files:**
- Modify: `client/src/components/Layout.tsx` (toolbar section, ~line 922-end)

**Changes:**
1. Active icon gets brand-blue glow ring (like login logo ring-inner)
2. Toolbar gradient → deeper, matching login title-bar
3. Dropdown menus → add `card-accent` top line + `scan-line` effect
4. Add hover tooltip showing keyboard shortcut in a `login-kbd` style badge

**Key code — active icon glow:**
```tsx
// Active toolbar icon style:
style={{
  ...existingStyle,
  boxShadow: isActive ? '0 0 8px rgba(26, 90, 158, 0.3), inset 0 0 12px rgba(26, 90, 158, 0.1)' : undefined,
  borderColor: isActive ? 'rgba(26, 90, 158, 0.4)' : undefined,
}}
```

### Task 5: Status Bar Enhancement

**Files:**
- Modify: `client/src/components/StatusBar.tsx`
- Modify: `client/src/index.css` (status-bar section)

**Changes:**
1. Each status-bar-section gets a left-border accent (like login card sections)
2. Connection LED pulsing ring (like login-secure-dot)
3. Clock: brand-blue text glow on time
4. Version number: `login-kbd` style micro-badge
5. Overall gradient: match login title-bar gradient (deeper blue)

**CSS additions:**
```css
.status-bar-section {
  border-left: 1px solid rgba(26, 90, 158, 0.1);  /* subtle accent */
}
.status-bar .clock-display {
  color: #4a9aee;
  text-shadow: 0 0 8px rgba(26, 90, 158, 0.3);
}
```

**Step: Commit all shell changes:**
```bash
git commit -m "enhance: upgrade app shell (brand bar, toolbar, menu bar, status bar)"
```

---

## Phase 3: Shared Components

### Task 6: Panel Title Bar + Beveled Panel Upgrades

**Files:**
- Modify: `client/src/index.css` (panel-title-bar and panel-beveled sections)

**Changes:**
1. `panel-title-bar` gradient → match `login-title-bar` gradient exactly
2. `panel-beveled` → add subtle scan-line on hover
3. Add `panel-beveled.panel-glow` variant for important panels

### Task 7: Modal System Upgrade

**Files:**
- Modify: `client/src/index.css` (add modal classes)
- Modify: `client/src/components/PanelTitleBar.tsx` (if used as modal header)

**New CSS:**
```css
/* Modal overlay — like login page background */
.modal-overlay {
  background: rgba(6, 12, 20, 0.85);
  backdrop-filter: blur(4px);
}

/* Modal panel — login card pattern */
.modal-panel {
  background: var(--surface-base);
  border: 1px solid var(--border-strong);
  box-shadow: 0 4px 40px rgba(26, 90, 158, 0.08), 0 0 0 1px rgba(26, 90, 158, 0.1);
  animation: login-fade-in 0.2s ease-out;
  position: relative;
  overflow: hidden;
}
.modal-panel .card-accent::before { /* accent line at top */ }
.modal-panel .scan-line::after { /* scan-line overlay */ }
```

### Task 8: Tab System Upgrade

**Files:**
- Modify: `client/src/index.css` (tab-bar section)

**Changes:**
1. Active tab: animated underline (like Personnel `sub-tab` pattern)
2. Tab hover: brand-blue text glow
3. Tab bar: deeper background with grid-bg texture

**Step: Commit shared component changes:**
```bash
git commit -m "enhance: upgrade panels, modals, and tabs with login design language"
```

---

## Phase 4: Major Pages (Parallel Agents)

Each page gets the same treatment:
- Page container: `app-grid-bg` class
- Section headers: `section-header` pattern (from Personnel)
- Stats cards: `stat-pod summary-card-shimmer` with `--pod-glow`
- Tables: `personnel-table` or `table-dark` with enhanced hover
- Cards/panels: `card-glass` class
- Empty states: `empty-state-icon` floating animation
- Alert banners: `alert-banner` / `alert-banner-critical`

### Task 9: DashboardPage.tsx

**Files:**
- Modify: `client/src/pages/DashboardPage.tsx`

**Changes:**
1. Stat cards → `stat-pod summary-card-shimmer` with colored `--pod-glow`
2. Activity feed panel → `card-glass scan-line`
3. Chart panels → `card-glass` with `card-accent`
4. Quick action buttons → `action-card` class
5. Page wrapper → `app-grid-bg`
6. BOLO alert → `alert-banner alert-banner-critical`

### Task 10: DispatchPage.tsx (Careful — 2,788 lines)

**Files:**
- Modify: `client/src/pages/dispatch/DispatchPage.tsx`

**Changes (MINIMAL — this file is huge):**
1. Main container → add `app-grid-bg` class
2. Call cards → add `card-glass` class
3. Unit status sidebar → add `scan-line` to header
4. Status badges → ensure using `badge-*` CSS classes
5. DO NOT rewrite the file — only add className props to existing elements

### Task 11: RecordsPage.tsx + Tabs

**Files:**
- Modify: `client/src/pages/RecordsPage.tsx`
- Modify: `client/src/pages/records/PersonsTab.tsx`
- Modify: `client/src/pages/records/VehiclesTab.tsx`

**Changes:**
1. Tab bar → use enhanced tab-bar classes
2. Detail panel → `card-glass` sections
3. Tables → `personnel-table` class pattern
4. Search input → `search-glow` class

### Task 12: IncidentsPage.tsx

**Files:**
- Modify: `client/src/pages/IncidentsPage.tsx`

**Changes:**
1. Incident table → `personnel-table` or enhanced `table-dark`
2. Detail panel → `card-glass` sections with `card-accent`
3. Status badges → `badge-pill` class
4. Priority borders → already have `priority-border-*` classes

### Task 13: Fleet / Warrants / Citations / Admin Pages

**Files:**
- Modify: `client/src/pages/WarrantsPage.tsx`
- Modify: `client/src/pages/CitationsPage.tsx`
- Modify: `client/src/pages/AdminPage.tsx`
- Modify: `client/src/pages/PatrolPage.tsx`

**Changes per page:**
1. Page wrapper → `app-grid-bg` if appropriate
2. Tables → enhanced `table-dark` or `personnel-table`
3. Cards → `card-glass`
4. Section headers → `section-header` with icon pattern
5. Empty states → `empty-state-icon`

### Task 14: Remaining Pages (Light Touch)

**Files:**
- `CommunicationsPage.tsx` — message list → `cascade-item`
- `EmailPage.tsx` — email list → enhanced table
- `FieldInterviewsPage.tsx` — table → `personnel-table`
- `CaseManagementPage.tsx` — case cards → `card-glass`
- `EvidencePropertyPage.tsx` — evidence table → `personnel-table`
- `ReportsPage.tsx` — report cards → `card-glass`
- `TrainingPage.tsx` — existing Personnel patterns
- `CrmPage.tsx` — lead cards → `action-card`
- `MdtPage.tsx` — terminal glow enhancement
- `ServePage.tsx` — serve cards → `card-glass`

Each page gets the same minimal treatment: add CSS class names to existing elements. No structural changes.

**Step: Commit all page changes:**
```bash
git commit -m "enhance: propagate login design language to all major pages"
```

---

## Phase 5: Final Verification

### Task 15: Build + Visual Spot Check

**Step 1:** Run full build
```bash
cd client && npx vite build
```
Expected: 0 errors

**Step 2:** Start dev server and spot-check key pages:
- Login page (baseline — should be unchanged)
- Dashboard (stat cards glow, activity feed has scan-line)
- Dispatch (call cards have glass effect)
- Records (table hover states, detail panel glass)
- Personnel (already done — verify no regression)
- Admin (panels have glass effect)

**Step 3:** Final commit
```bash
git commit -m "enhance: full UI overhaul — login design language across entire app"
```

---

## Execution Strategy

**Parallelizable tasks:**
- Tasks 9-14 (all page upgrades) can run in parallel as separate agents
- Tasks 2-5 (shell components) can run in parallel
- Tasks 6-8 (shared components) can run in parallel

**Sequential dependencies:**
- Task 1 (CSS foundation) MUST complete before all others
- Task 15 (verification) runs last

**Estimated total: 15 tasks, ~45 minutes with parallel agents**
