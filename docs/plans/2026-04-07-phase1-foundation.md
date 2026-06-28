# Phase 1: Foundation — Database + API Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add all new database tables, columns, and API endpoints needed for the Dispatch and Records Spillman-Grade Overhaul.

**Architecture:** Additive-only changes — new tables via CREATE TABLE IF NOT EXISTS, new columns via addCol(), new route files mounted in index.ts. Zero changes to existing endpoints or schemas. All data preserved.

**Tech Stack:** SQLite (better-sqlite3), Express 4 + TypeScript (tsx runtime), addCol() migration pattern

---

### Task 1: New Database Tables

**Files:**
- Modify: `server/src/models/database.ts` (append before final `}` of migrateSchema)

Add 7 new tables: field_interviews, dispatch_messages, photo_lineups, nibrs_submissions, saved_searches, record_merge_log, officer_activity_summary

Add new columns via addCol to: warrants (8 cols), vehicles_records (4 cols), calls_for_service (3 cols), persons (3 cols), warrant_service_attempts (7 cols)

Deploy to VPS, restart, verify tables created and data untouched (90 persons expected).

---

### Task 2: Field Interview CRUD API

**Files:**
- Create: `server/src/routes/fieldInterviews.ts`
- Modify: `server/src/index.ts` (mount at /api/field-interviews)

8 endpoints: list, detail, create (auto-generate FI-YY-NNNNN), update, delete, by-person, by-location (radius), stats

---

### Task 3: Compound Search Engine API

**Files:**
- Modify: `server/src/routes/records.ts` (add GET /records/compound-search)

Accept: name (wildcard), DOB range, race/gender/height/weight/hair/eye/build, address+radius, plate (wildcard), alias, ssn_last4, flags. Results ranked by confidence.

---

### Task 4: Universal Search API

**Files:**
- Modify: `server/src/routes/records.ts` (add GET /records/universal-search)

One query searches: persons, vehicles, properties, calls, incidents, warrants, citations, cases, arrests. Returns grouped results with type + label + score.

---

### Task 5: Master Name Index Dossier API

**Files:**
- Modify: `server/src/routes/records.ts` (add GET /records/persons/:id/dossier)

Returns complete person intelligence in one call: person record, criminal history, warrants, field interviews, calls, incidents, vehicles, cases, citations, arrests, associates, addresses, photos, unified timeline, flags summary.

---

### Task 6: Dispatch Messaging API

**Files:**
- Create: `server/src/routes/dispatchMessages.ts`
- Modify: `server/src/index.ts` (mount at /api/dispatch-messages)

7 endpoints: list, unread-count, send (with WebSocket broadcast), mark-read, mark-all-read, by-call, delete

---

### Task 7: Saved Searches API

**Files:**
- Modify: `server/src/routes/records.ts` (add 5 endpoints)

CRUD for saved search presets + re-run with use_count tracking.

---

### Task 8: Build + Deploy

Bump SW to v174, build client, deploy all (client + server), restart, verify health + data integrity.
