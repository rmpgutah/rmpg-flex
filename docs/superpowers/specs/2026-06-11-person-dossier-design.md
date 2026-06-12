# Person Dossier Workspace — Design Spec (Palantir Phase 2)

**Date:** 2026-06-11 · **Status:** Approved (incl. PDF export) · **Builds on:** Intel Search Phase 1 (PR #1164)

## Goal

A 360° investigative workspace per person: identity + flags, unified contact
timeline, known associates (co-occurrence), vehicles, addresses, canonical-
cluster folding — plus an Arial-only PDF export of the dossier.

## API — `GET /api/intel/dossier/person/:id` (in `src/routes/intel.ts`, operational roles)

Single response, every section try/catch-isolated (a bad table degrades that
section to `[]`, never blanks the dossier — lesson from the warrant
Promise.all incident):

- `person`: full persons row (sentinel-guarded display fields)
- `cluster`: confirmed canonical group members (person_canonical both
  directions) with their ids/names — events from cluster members are merged
  into the timeline, tagged with the source person id
- `flags`: ACTIVE WARRANT / OFFICER SAFETY / GANG / TRESPASS / PROBATION,
  computed same as Phase 1 search enrichment + persons.caution_flags /
  gang_affiliation / probation_parole
- `timeline`: merged, date-desc array of `{kind, id, date, title, subtitle, status}`
  from: calls (call_persons), incidents (incident_persons), citations,
  field_interviews, trespass_orders, warrants (subject_person_id|person_id),
  arrests (arrest_records matched best-effort by name+DOB — no FK exists)
- `associates`: persons co-appearing on the same calls/incidents, ranked by
  shared-event count (top 15), `{person_id, name, shared_events, kinds}`
- `vehicles`: vehicles_records WHERE owner_person_id IN (cluster ids)
- `addresses`: distinct of persons.address(+city) across cluster + locations
  from linked events (top 10 by recency)

Pure timeline-merge + associate-ranking helpers live in
`src/utils/intelDossier.ts` with unit tests in `tests/intelDossier.test.ts`.

## UI — `client/src/pages/PersonDossierPage.tsx` at `/intel/person/:id`

- Header band: name, DOB, identifiers (DL, SSN-last4), photo (photo_url if
  real), red flag badges, cluster chip ("2 linked identities")
- Left column: identity details, vehicles, addresses, associates (each
  associate links to THEIR dossier — the Palantir pivot)
- Right column: unified timeline, dense Spillman rows, kind-colored labels
- Actions: open in Connections graph, open raw person record, **Export PDF**
- Intel Search person rows now navigate here (primary action)

## PDF export — `client/src/utils/dossierPdfGenerator.ts`

jsPDF, `registerArialFont(doc)` at creation (project rule), portrait letter:
header band (name/DOB/flags), identity table, vehicles, addresses, associates,
timeline table. Footer: generated-by + timestamp + RMPG. Per-section
try/catch so a malformed row can't kill the export.

## Testing

- Worker: unit tests for timeline merge + associate ranking (pure helpers)
- Client: render test for PersonDossierPage with mocked apiFetch
- SW bump (v903)

## Out of scope

Watchlist alerting (Phase 4), graph auto-edges (Phase 3), dossier sharing.
