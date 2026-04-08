# Personnel Management — Full Visual Revamp Design

## Goals
Tighten the Spillman Flex console aesthetic across the entire Personnel section. Improve information hierarchy, reduce visual clutter, and consolidate navigation — without losing any functionality.

## 1. Tab Consolidation (11 → 8 main tabs)

| # | Tab | Change |
|---|-----|--------|
| 1 | Roster | No change |
| 2 | Duty Board | No change |
| 3 | Schedule | Absorbs Calendar as a view toggle (list/calendar) |
| 4 | Time & Attendance | No change |
| 5 | Credentials | No change |
| 6 | Training | No change |
| 7 | Equipment | Absorbs Dash Cameras as sub-section |
| 8 | Deployment | No change |

- **Calendar tab removed** — becomes a toggle inside Schedule
- **Dash Cameras tab removed** — becomes a section inside Equipment
- **Analytics** — stays as the default right-panel view when no officer is selected (not a separate tab)

Detail tabs remain at 11 (contextual to selected officer).

## 2. Stats Bar — Command Status Strip

Two-row layout replacing the current single row of cramped cards:

**Row 1 — Operational stats:**
- LED dot + large monospace number + small uppercase label
- Active (green), Off Duty (grey), Clocked In (brand-blue), Period Hours
- Separated by vertical dividers (`border-r border-rmpg-600`)

**Row 2 — Alerts (conditional):**
- Amber left-border accent when credential alerts > 0
- Shows: "N CREDENTIAL ALERTS" + total headcount right-aligned
- Hidden when no alerts

Responsive: 2x2 grid on mobile.

## 3. Roster Card Redesign

```
[AVATAR]  LAST, First M.         [●LED] STATUS
          Rank · Badge #XXXX       label
          Division / Department
          N yrs · N creds ✓/⚠
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░  N% compliant
```

- Name: 13px bold white (strongest hierarchy)
- Rank + Badge: 11px text-secondary (subtitle line)
- Division: 10px text-muted
- Compliance: 10px with credential icon
- Progress bar: bottom of card, thin credential compliance %
- Status: large LED + label, right-aligned vertically centered
- Selected: left border brand-blue 3px, bg-surface-raised, subtle glow
- Remove birthday emoji

## 4. Detail Panel Header — Consolidated

Merge current 3 sections (header + status/controls + quick stats) into 2:

**Section A — Identity + Status + Controls:**
- Large avatar, name (18px), rank + badge (12px), division (11px)
- Gold divider line
- Status: LED + "ON DUTY" + "Clocked In 4h 23m" (live duration)
- Clock controls inline: Clock In/Out, Break start/end
- Actions: Edit button + kebab menu (⋮) containing Print, Archive, Delete
- Close button (X) top-right

**Section B — Quick Stats (inline):**
- 5 compact stat cards at bottom of header panel
- Years, Hours, Credentials (count + status color), Schedules, Deployments
- Same `.panel-beveled` with `border-t-2` accent

Net vertical savings: ~50px more room for tab content.

## 5. Profile Tab — Section Cards

3-column grid with proper section cards:

| Left | Center | Right |
|------|--------|-------|
| Identity (name, DOB, SSN) | Employment (hire, status, dept, shift) | Contact (phone, email, address) |
| Medical (blood, allergies) | Driver's License (number, class, exp) | Emergency Contact |
| | Credential Summary | Personnel Files |

- Each section: `.panel-beveled` card with gold header label
- Field rows: `py-1` (was `py-0.5`) for breathing room
- Remove redundant "OPR IDENTIFICATION" banner
- Equal-height rows for visual alignment

## 6. Design System Compliance

All changes must use existing tokens:
- `bg-surface-base`, `bg-surface-raised`, `bg-surface-sunken`
- `.panel-beveled`, `.panel-inset`
- `.led-dot led-green/amber/red/off`
- `.tab-bar`, `.tab-bar-item`
- `.toolbar-btn`, `.toolbar-btn-primary`
- `.field-label` (gold 10px)
- Font-mono for numbers, system sans for labels
- 2px border-radius throughout

## Files to Modify

1. `client/src/pages/personnel/PersonnelPage.tsx` — Tab consolidation, stats bar, roster cards
2. `client/src/pages/personnel/PersonnelDetailPanel.tsx` — Header consolidation, controls
3. `client/src/pages/personnel/detail-tabs/ProfileDetailTab.tsx` — Section card layout
4. `client/src/pages/personnel/PersonnelAnalyticsDashboard.tsx` — Remove tab wrapper (stays as right-panel default)
5. `client/src/pages/personnel/utils/personnelConstants.ts` — Update MAIN_TABS (remove Calendar, Dash Cameras, Analytics)
6. `client/src/pages/personnel/tabs/ScheduleTab.tsx` — Add calendar view toggle
7. `client/src/pages/personnel/tabs/EquipmentTab.tsx` — Add dash camera sub-section
