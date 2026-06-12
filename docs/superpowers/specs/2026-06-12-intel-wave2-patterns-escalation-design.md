# Intel Wave 2 — Location Patterns, Subject Escalation, Quick Capture

**Date:** 2026-06-12 · **Status:** Approved (selected in Wave-1 scoping) · **Builds on:** #1164, #1168

## Goal

Detection analytics over the growing dataset: (1) repeat/near-repeat location
patterns, (2) per-subject escalation scoring, (3) a 30-second field
quick-capture that feeds persons/vehicles/FIs in one shot.

No new tables — patterns alert through `anomaly_alerts` (dedup_key),
escalation renders on the dossier, quick-capture writes existing tables.

## 1. Location patterns — `src/utils/intelPatterns.ts` (4-hourly cron)

- `detectRepeatLocations(db)`: normalized addresses (intelMatch.normalizeAddress)
  with ≥3 calls in the trailing 7 days AND ≥2× their prior-28-day weekly
  average → `anomaly_alerts` row (`intel_pattern:addr:<norm>:<isoweek>` dedup,
  severity warning, details list call numbers/types).
- `detectNearRepeat(db)`: same incident_type with ≥3 calls inside a ~330 m
  box (0.003° lat/lng) within 14 days → alert with centroid + type
  (`intel_pattern:nr:<type>:<roundedLat>:<roundedLng>` dedup). Calls without
  coordinates are skipped.
- Pure helpers (`groupByAddress`, `clusterByProximity`, week math) unit-tested.

## 2. Subject escalation — same util + dossier

- `computeEscalation(events)`: pure. Weighted contacts (FI=1, call=2,
  citation=2, trespass=3, arrest=4, warrant=5) in last 30 days vs monthly
  baseline from the prior 90 days. Returns `{recent, baseline, ratio, trend}`
  where trend = 'escalating' (ratio ≥2 and recent ≥3), 'active', or 'quiet'.
- Dossier response gains `escalation`; dossier header shows a red
  ESCALATING chip when trend='escalating'.
- `sweepEscalation(db)` in the 4-hourly cron: computes for persons with any
  event in the last 30 days (bounded LIMIT 500); 'escalating' subjects raise
  an anomaly alert (`intel_pattern:esc:<personId>:<isoweek>` dedup).

## 3. Field quick-capture

- `POST /api/intel/quick-capture` (operational):
  `{first_name, last_name, dob?, subject_description?, plate?, location?,
  lat?, lng?, narrative?, contact_reason?}`
  1. Person: reuse exact (first+last+dob) match else INSERT minimal person.
  2. Vehicle: reuse exact plate match else INSERT minimal vehicle (plate only).
  3. INSERT field_interviews row (person_id, vehicle_id, subject_* mirror,
     vehicle_plate, location, lat/lng, narrative, contact_reason,
     officer_id = caller, status 'submitted', fi_number `FI-<yyyymmdd>-<id>`)
  4. Screen person + vehicle (intelScreen) — hits returned inline + HIGH
     notification on critical.
  Response: `{person_id, person_reused, vehicle_id, fi_id, hits}`.
- UI `/intel/quick-capture` (mobile-first): name/DOB/plate/location (GPS
  autofill)/narrative, one CAPTURE button, hit banners like Plate Log, link
  to the created dossier. Nav entry beside Plate Log.

## Error handling / testing

Per-rule try/catch isolation throughout; cron never throws; pure helpers
(escalation scoring, proximity clustering) unit-tested in
`tests/intelPatterns.test.ts`; client page test; SW bump.

## Out of scope (Wave 3)

Scraper expansion, in-app interaction recording, native background recording.
