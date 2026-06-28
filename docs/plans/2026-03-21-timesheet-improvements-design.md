# Timesheet Improvements Design

**Date:** 2026-03-21
**Status:** Approved
**Scope:** Better layout, admin change logging, improved input for time entries

## Problem

The timesheet system is functional but has UX gaps:
1. No date range filtering — always shows all entries
2. No visible audit trail when admins edit time entries
3. No batch clock-in for multiple officers
4. Manual entry form is minimal (no notes, no reason, no before/after preview)
5. No inline editing — must open modal for every change

## Solution

### 1. Database Changes

New table for edit audit trail:
```sql
CREATE TABLE IF NOT EXISTS time_entry_edits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  time_entry_id INTEGER NOT NULL REFERENCES time_entries(id) ON DELETE CASCADE,
  edited_by INTEGER NOT NULL REFERENCES users(id),
  edited_by_name TEXT NOT NULL,
  edit_type TEXT NOT NULL CHECK(edit_type IN ('clock_in_changed','clock_out_changed','deleted','restored','notes_changed','break_adjusted')),
  old_value TEXT,
  new_value TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
```

Add columns to time_entries: notes, edit_reason, edited_by, edited_at.

### 2. API Changes

- Modify PUT /api/personnel/time/:id — require reason, log edits to time_entry_edits
- New GET /api/personnel/time/:id/history — returns edit log
- Modify DELETE /api/personnel/time/:id — log to time_entry_edits before deleting
- New POST /api/personnel/time/batch-clock-in — batch clock-in multiple officers

### 3. TimeAttendanceTab Redesign

- Date range picker with presets (Today, This Week, Last Week, Custom)
- Stats cards filtered by date range
- Batch clock-in panel with checkboxes for off-duty officers
- Sortable table with inline editing (click cell to edit)
- Expandable edit history rows showing old→new values, editor, reason
- Action menu per row (Edit, Delete, View History)

### 4. Improved Edit Modal

- Required reason dropdown + free text
- Notes textarea
- Before/After preview
- Real-time calculated hours
- Break time editor

### 5. TimeLogDetailTab Enhancement

- Date range filter
- Inline edit history on entry cards
- Color-coded edited entries (amber border)

## Files to Create/Modify

### Modified Files
- server/src/models/database.ts — new table + columns
- server/src/routes/personnel.ts — modified PUT, DELETE + new endpoints
- client/src/pages/personnel/tabs/TimeAttendanceTab.tsx — full redesign
- client/src/pages/personnel/detail-tabs/TimeLogDetailTab.tsx — enhanced
- client/src/pages/personnel/modals/TimeEntryEditModal.tsx — improved form
- client/src/pages/personnel/PersonnelPage.tsx — new handlers
- client/src/types/index.ts — updated TimeEntry type + new types
- client/public/sw.js — cache bump
