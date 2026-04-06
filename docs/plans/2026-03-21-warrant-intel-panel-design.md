# Warrant Intelligence Panel — Design Doc

**Date:** 2026-03-21
**Status:** Approved
**Approach:** Person Intelligence Panel (Approach 2)

---

## Problem

Nine active pain points across three areas:

- **Utah Search (A):** No way to ingest a Utah hit as a local warrant record (A1); no indication whether a result matches an existing person in the DB (A2); results show no charges detail, bail, or court info (A3).
- **Watch Hits (B):** MDT/Dispatch officers don't see hits in real-time — no toast or overlay (B1); no way to link a hit to an open dispatch call (B2); all hits look the same regardless of severity (B3).
- **Court Records (C):** Only accessible via manual search — never auto-surfaced when a person appears in context (C1); raw output is hard to read (C2); no indication whether a court record is for the searched person or just a name match (C3).

---

## Solution: Person Intelligence Panel

Replace the Utah Search tab content with a unified Person Intelligence Panel. A single name search triggers all sources in parallel and returns a consolidated view. Watch Hits and Court Records get targeted enhancements alongside.

---

## Section 1: Architecture

### New Backend Endpoint

`POST /api/warrants/person-intel`

Accepts `{ firstName, lastName, dob? }`. Runs three queries in parallel via `Promise.all`:

1. `searchUtahWarrantsLive(firstName, lastName)` — live warrants.utah.gov query
2. `searchCourtRecords(firstName, lastName)` — court records cache + live fetch
3. Local DB query — `warrants` + `persons` tables for name/DOB match

Returns:
```typescript
{
  results: PersonIntelResult[];  // one entry per distinct person found
}

interface PersonIntelResult {
  searchName: string;
  utahPersonId: string | null;
  age: number | null;
  city: string | null;
  localPersonMatch: { id: number; name: string; dob: string | null } | null;
  identityConfidence: 'high' | 'medium' | 'low';
  confidenceFactors: string[];   // e.g. ["name match", "DOB match", "city match"]
  utahWarrants: UtahWarrantResult[];
  courtRecords: CourtRecord[];
  localWarrants: Warrant[];
  watchHistory: WatchHit[];
}
```

### Identity Confidence Scoring

Computed server-side per result:
- Name match only → `low`
- Name + city match → `medium`
- Name + DOB match → `high`
- Name + DOB + city → `high`

### Ingest Action (A1)

`POST /api/warrants/ingest-utah` — accepts a Utah warrant result and creates a local `warrants` record:
- Pre-fills: `charge_description`, `bail_amount`, `issuing_court`, `expires_at`, `issue_date`
- Sets `source = 'utah_api'`, `external_warrant_id = utah_warrant_id`
- Links `subject_person_id` if `identityConfidence === 'high'`
- Deduplicates by `external_warrant_id` — re-ingest is a no-op

---

## Section 2: Panel Layout (Frontend)

The Utah Search tab (`utah_search`) is replaced in-place. Same tab ID, new content.

### Search Bar
- First name + last name fields (required)
- DOB field (optional — improves confidence scoring)
- Single `SEARCH` button triggers `POST /api/warrants/person-intel`

### Results
Results render as stacked collapsible cards, sorted by `identityConfidence` descending. Highest-confidence match expands automatically.

Each card shows:
```
● JOHN EMMETT SMITH · Age 64 · Washington, UT
  Identity: ████████ HIGH — Name match + DOB match
  [VIEW PERSON →]  (if localPersonMatch exists)

  UTAH WARRANTS (2)                          [+ INGEST ALL]
  ┌──────────────────────────────────────────────────────┐
  │ ● FELONY  Aggravated Assault · 3rd Dist Court        │
  │   Bail: $15,000 · Issued: 2025-11-14 · Case: 251300 │
  │                              [+ CREATE LOCAL RECORD] │
  └──────────────────────────────────────────────────────┘

  COURT RECORDS (3)
  ┌──────────────────────────────────────────────────────┐
  │ Case 251300456 · 3rd District · ● ACTIVE             │
  │ Charges: Aggravated Assault (F2)                     │
  │ Filed: Nov 1, 2025 · Next hearing: Apr 15, 2026      │
  └──────────────────────────────────────────────────────┘

  WATCH HISTORY (1 hit)
  └ Mar 10, 2026 · Felony hit via Utah API
```

Low-confidence results collapse by default under a `Show unconfirmed (N)` expander.

---

## Section 3: Watch Hits Enhancements

### B3 — Severity Badges
Each Watch Hits row gets a colored badge: `FELONY` (red), `MISDEMEANOR` (amber), `BENCH` (orange), `CIVIL` (blue).

Source: `offense_level` field already on `warrants` table. For rows where it's null, infer from `charges` text — keywords `F1/F2/F3/felony` → felony; `class A/B/C/misdemeanor` → misdemeanor; `bench` → bench.

Inference runs server-side in `GET /warrants/watch/log` response — add `resolvedSeverity` field.

### B2 — Link to Call
Each hit row in Watch Hits tab gets a `[LINK TO CALL]` button. Opens a mini-picker listing open dispatch calls (status: active/dispatched/enroute/onscene). Selecting a call:
1. POSTs a note to `/api/dispatch/calls/:id/notes` — *"⚠ Warrant hit: JOHN SMITH — FELONY (Aggravated Assault) via Utah API"*
2. Broadcasts `call:warrant_alert` with `{ callId, personName, severity, charge, source }`

### B1 — Real-time Toast on MDT + Dispatch
`DispatchPage` and `MdtPage` subscribe to `call:warrant_alert` WebSocket events. On receipt, show a persistent red banner:

```
⚠  WARRANT HIT — JOHN SMITH — FELONY — Aggravated Assault
   [VIEW CALL]  [DISMISS]
```

Banner persists until manually dismissed. Multiple hits stack. Implemented as a `warrantAlerts` state array, rendered above the main content area in both pages.

---

## Section 4: Court Records Enhancements

### C1 — Auto-Surface in Context
Court records are now returned automatically as part of `POST /api/warrants/person-intel` — no separate search needed. Additionally, the person detail panel in Dispatch (when a person is linked to a call) gains a `COURT (N)` chip showing the count of known court records. Clicking it opens an inline drawer loaded from `/api/warrants/court-records/person/:personId`.

### C2 — Formatted Display
Court record cards use structured rendering:
- Case number + court name + status badge (`ACTIVE` red / `CLOSED` gray / `PENDING` amber)
- Charges listed as formatted pills with offense level
- Filed date + next hearing date formatted via `formatDate()`
- Attorney name if available

### C3 — Identity Confidence on Court Records
Each court record card shows the same `HIGH / MEDIUM / LOW` confidence badge as Utah warrant results, using the same scoring logic. Low-confidence records collapse by default under a `Show unconfirmed (N)` expander so high-confidence hits are never buried.

---

## Files to Create / Modify

### Backend
| File | Change |
|------|--------|
| `server/src/routes/warrants.ts` | Add `POST /person-intel`, `POST /ingest-utah`; add `resolvedSeverity` to watch/log response |
| `server/src/utils/utahWarrantScraper.ts` | Export `searchUtahWarrantsLive` if not already |

### Frontend
| File | Change |
|------|--------|
| `client/src/pages/WarrantsPage.tsx` | Replace utah_search tab content with PersonIntelPanel; add severity badges + link-to-call + toast state to Watch Hits tab |
| `client/src/pages/dispatch/DispatchPage.tsx` | Add `call:warrant_alert` handler + persistent banner |
| `client/src/pages/MdtPage.tsx` | Add `call:warrant_alert` handler + persistent banner |

### New Components
| Component | Purpose |
|-----------|---------|
| `PersonIntelPanel.tsx` | Full search + results panel (extracted from WarrantsPage for size management) |
| `CourtRecordCard.tsx` | Formatted court record display with confidence badge |
| `WarrantAlertBanner.tsx` | Persistent red warrant-hit overlay for MDT/Dispatch |

---

## Out of Scope

- Photo matching / facial recognition
- Automatic scheduled person-intel scans (hourly watch scan already handles this)
- NCIC integration (separate system)
