# Timesheet Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve timesheet layout with date filtering, visible edit change log, batch clock-in, inline editing, and enhanced edit modal with reason/notes fields.

**Architecture:** Add time_entry_edits audit table + new columns on time_entries. Modify existing PUT/DELETE endpoints to log changes. Enhance existing TimeAttendanceTab with date range picker, batch clock-in panel, inline editing, and expandable edit history rows. Improve TimeEntryEditModal with reason/notes/before-after preview.

**Tech Stack:** Express + better-sqlite3 (server), React + TypeScript + Tailwind (client), existing personnel route structure.

---

## Task 1: Database — Add time_entry_edits Table + New Columns

**Files:**
- Modify: server/src/models/database.ts (after integration_health_log table)
- Modify: client/src/types/index.ts (update TimeEntry, add TimeEntryEdit)

Add the time_entry_edits table with columns: id, time_entry_id (FK), edited_by (FK), edited_by_name, edit_type (CHECK constraint for clock_in_changed, clock_out_changed, deleted, notes_changed, break_adjusted), old_value, new_value, reason, created_at. Index on time_entry_id.

Add ALTER TABLE columns to time_entries: notes TEXT, edit_reason TEXT, edited_by INTEGER, edited_at TEXT. Use try/catch ALTER pattern.

Update TypeScript TimeEntry interface with: notes, edit_reason, edited_by, edited_by_name, edited_at, edit_count fields. Add TimeEntryEdit interface.

Verify: cd client and npx tsc --noEmit

Commit: "feat: add time_entry_edits audit table and tracking columns"

---

## Task 2: Server — Enhanced PUT/DELETE + New Endpoints

**Files:**
- Modify: server/src/routes/personnel.ts (time entry endpoints, lines 809-921)

### Modify GET /api/personnel/time
Add start_date and end_date query params for date range filtering. Add subquery for edit_count and edited_by_name in SELECT. Raise LIMIT to 500.

### Modify PUT /api/personnel/time/:id
Require reason field. Before updating, compare old vs new values and INSERT into time_entry_edits for each changed field. Set edited_by, edited_at, edit_reason on time_entries row.

### Modify DELETE /api/personnel/time/:id
Before deleting, INSERT into time_entry_edits with edit_type='deleted' and old_value containing JSON of the deleted entry data.

### New GET /api/personnel/time/:id/history
Returns all time_entry_edits rows for a given time entry ID. Requires admin/manager/supervisor role.

### New POST /api/personnel/time/batch-clock-in
Accepts officer_ids array. For each, checks for existing active entry, skips if found, otherwise creates new time_entry. Logs to activity_log. Returns { results, clocked_in, skipped }.

Commit: "feat: add edit audit logging, date range filter, batch clock-in, and history endpoint"

---

## Task 3: Client — Enhanced TimeEntryEditModal

**Files:**
- Modify: client/src/pages/personnel/modals/TimeEntryEditModal.tsx
- Modify: client/src/pages/personnel/PersonnelPage.tsx (update handler)

Update TimeEntryEditData to include reason and notes fields.

Add to modal form:
- Required reason dropdown with presets: Forgot to clock out, Incorrect time, Schedule change, System error, Supervisor correction, Other
- Free text input when Other selected
- Notes textarea
- Before/After preview panel showing original vs new values side by side (only when values differ)
- Break minutes display (read-only)

Disable submit when no reason selected.

Update PersonnelPage handleTimeEntryEdit to pass reason and notes in PUT body.

Commit: "feat: enhance time entry edit modal with reason, notes, and before/after preview"

---

## Task 4: Client — TimeAttendanceTab Redesign

**Files:**
- Modify: client/src/pages/personnel/tabs/TimeAttendanceTab.tsx
- Modify: client/src/pages/personnel/PersonnelPage.tsx (new props, handlers, state)

### Date range picker
Add bar below header with preset buttons: Today, This Week, Last Week, Pay Period. Custom date inputs on the right. Pass dateRange and onDateRangeChange via props.

### Batch clock-in panel
Collapsible section showing checkboxes for off-duty officers. One-click batch clock-in button. Only visible to admin/manager/supervisor/dispatcher.

### Inline editing
Make clock_in and clock_out cells clickable for admin/manager/supervisor. Clicking shows datetime-local input inline. On blur or Enter, commits the edit (calls onInlineEdit prop which triggers the PUT with a default reason of "Inline correction").

### Expandable edit history
Rows with edit_count > 0 show an amber "N edits" badge. Clicking expands a sub-row showing the edit log (fetched from GET /time/:id/history). Shows editor name, change type, old/new values, reason, timestamp.

### PersonnelPage changes
Add timeSheetDateRange state. Add handleBatchClockIn handler. Modify time entry fetch to use date range params. Pass new props to TimeAttendanceTab.

Commit: "feat: redesign TimeAttendanceTab with date range, batch clock-in, inline editing, and edit history"

---

## Task 5: Client — TimeLogDetailTab Enhancement

**Files:**
- Modify: client/src/pages/personnel/detail-tabs/TimeLogDetailTab.tsx

Add date range filter at top. Show edit history inline on entries with status=edited or edit_count > 0 (amber left border, editor name, reason). Expandable history detail.

Commit: "feat: enhance TimeLogDetailTab with date filter and visible edit history"

---

## Task 6: Service Worker Cache Bump + Final Build

Bump sw.js cache version. Run tsc --noEmit (0 errors). Run npm run build. Copy dist to main repo.

Commit: "chore: bump service worker cache for timesheet improvements"

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | Database + types | database.ts, types/index.ts |
| 2 | Server endpoints | personnel.ts |
| 3 | Edit modal | TimeEntryEditModal.tsx, PersonnelPage.tsx |
| 4 | TimeAttendanceTab | TimeAttendanceTab.tsx, PersonnelPage.tsx |
| 5 | TimeLogDetailTab | TimeLogDetailTab.tsx |
| 6 | Build | sw.js |
