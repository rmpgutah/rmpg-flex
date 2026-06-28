# PSO Dispatch ↔ Process Server Integration Design

**Date:** 2026-03-16
**Status:** Approved

## Overview

Link PSO dispatch calls (`process_service` type) with the Process Server serve queue so officers get a seamless field workflow: dispatch → serve queue → attempt → auto-close dispatch.

## Approach

Foreign key link — add `call_id` column to `serve_queue` referencing `calls_for_service(id)`. Direct 1:1 relationship. No junction tables, no event-driven sync.

## Database Changes

```sql
ALTER TABLE serve_queue ADD COLUMN call_id INTEGER REFERENCES calls_for_service(id);
CREATE INDEX idx_serve_queue_call ON serve_queue(call_id);
```

No changes to `calls_for_service` — existing `process_attempts`, `process_service_result`, `process_served_to`, `process_served_at` columns are updated by sync-back logic.

## API Endpoints

### New: Send to Serve Queue
```
POST /api/dispatch/calls/:id/send-to-serve
```
- Validates call is `pso_client_request` with process_service fields populated
- Creates `serve_queue` entry with `call_id`, pre-filled:
  - `recipient_name` ← `process_served_to`
  - `recipient_address` ← `process_served_address` (parsed)
  - `document_type` ← `process_service_type`
  - `case_number` ← call's `case_number`
  - `serve_date` ← today
  - `officer_id` ← assigned unit's user ID (or null)
- Blocks duplicate sends (1:1 enforced)
- Broadcasts `serve:created`, audit logged

### Modified: Record Serve Attempt (sync back)
```
POST /api/serve/:id/attempt  (existing endpoint)
```
After recording attempt, if `serve_queue.call_id` is set:
- Update dispatch call: `process_attempts`, `process_service_result`
- If served/posted: update `process_served_to`, `process_served_at`, set call status `closed`, set disposition, broadcast `dispatch:call_updated`
- Activity log: `process_served_via_serve_queue`

### New: Check Link Status
```
GET /api/dispatch/calls/:id/serve-link
```
Returns linked serve_queue entry with attempts (used by DispatchPage).

## Disposition Mapping

| Serve Attempt Type | Dispatch Disposition |
|---|---|
| personal + served | "Served - Personal" |
| substitute + served | "Served - Substitute" |
| posting + served | "Served - Posting" |
| failed results | No auto-close, update attempt count only |

## UI Changes

### DispatchPage — PSO Panel
- "Send to Serve Queue" button (briefcase icon) below process service fields
- Visible when: `incident_type === 'pso_client_request'` AND `process_served_to` populated
- Disabled with "Already in Serve Queue" when linked entry exists
- When linked: mini status indicator (serve status, attempt count, link to /serve)

### DispatchPage — Call Actions Menu
- "Send to Serve Queue" option with same enable/disable logic

### ServePage — ServeJobCard (linked calls)
- Inline summary panel when `call_id` present:
  - Call number (clickable → DispatchPage)
  - Dispatch status & priority
  - Assigned units
  - PSO compliance progress ("2 of 4 windows covered")
  - Requestor name & contract ID
- Listens for `dispatch:call_updated` to refresh

## Field Workflow

1. Dispatcher creates PSO call (`P` key → process_service type)
2. Dispatcher clicks "Send to Serve Queue" → serve_queue entry created
3. Officer sees job in ServePage with dispatch context
4. Officer plans route, attempts service
5. Each attempt auto-updates dispatch call's process fields
6. Successful serve → dispatch call auto-closed with mapped disposition
7. PSO compliance/72hr logic continues independently on parent call

## Edge Cases

- Serve queue job deleted → dispatch call keeps last-synced fields (no cascade)
- Dispatch call archived/cancelled before serve completes → serve job stays active
- Multiple send-to-serve on same call → blocked (1:1 enforced)
