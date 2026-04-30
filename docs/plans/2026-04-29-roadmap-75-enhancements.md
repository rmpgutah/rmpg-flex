# RMPG Flex — 75-Item Enhancement Roadmap

**Status:** Brainstorm — not yet committed to a delivery sequence.
**Date:** 2026-04-29
**Method:** [superpowers:brainstorming](https://github.com/anthropics/skills/blob/main/brainstorming/SKILL.md) skill, ideation pass with full project context.
**Scope:** Strategic options across the entire RMPG Flex CAD/RMS surface, organized by theme. Each item is a starting point; adopting any one triggers the standard brainstorm → design → implementation flow.

---

## How to use this document

- **Pick by theme** to find a focus area for a sprint or quarter.
- **Read effort tags as guidance, not estimates** — anything tagged "≤1 day" assumes the surrounding code is well-understood and the design phase is short. Anything tagged "≥1 quarter" assumes regulatory/policy work in addition to engineering.
- **Cross-reference Phase 0–4 dashcam-AI work** that just shipped: continuations are flagged as "Phase 1+" or "Phase 4 v2" where applicable.
- **Some items have non-engineering gates** — labor relations, DA buy-in, NCIC certification, legal counsel review. Those are flagged inline.

Notation:
- 🟢 small (≤1 day) · 🟡 medium (≤1 week) · 🟠 large (≤1 month) · 🔴 program (≥1 quarter)
- ⚠️ has a non-engineering gate (policy/legal/regulatory)

---

## 1. Officer Safety (10)

1. **Always-on welfare watchdog** 🟡 — extend the `gpsStaleWatchdog` design with a dispatcher-pingable manual-check feature; if officer doesn't ack within 60s during a high-risk call, auto-tone supervisor.
2. **Silent panic on duty-phone PWA** 🟡 — long-press anywhere on the app sends a sub-second alert with last GPS + audio snapshot to dispatch + nearest unit.
3. **Officer-down acoustic detection** 🟠 — Jetson-side gunshot recognition via in-cabin mic; auto-creates a P1 call with confidence score.
4. **BLE buddy-pairing** 🟡 — partner units' phones share BLE heartbeat; lone-officer-at-scene status flagged when proximity drops at an active call.
5. **Mental-health crisis protocol cards** 🟢 — auto-load de-escalation checklists when call_type matches `mental_health_crisis` flag.
6. **Auto-prompt for backup at threshold** 🟢 — arrest + 1 officer on scene + duration > 8 min → "Need backup?" prompt to officer + nearest unit.
7. **Weapon-draw event from body cam IMU** 🟠⚠️ — flag holster-motion as `driving_events.event_type='weapon_draw'`; needs union review for body-cam-derived event.
8. **K-9 cabin temperature monitor** 🟢 — BLE thermometer pings dispatch when K-9 vehicle compartment exceeds threshold.
9. **Vehicle pursuit auto-tone** 🟢 — Code 3 status + speed > 75 → automatic radio tone-out to every unit on channel.
10. **Environmental hazard overlay on MapPage** 🟡 — NWS weather alerts + UDOT road-condition feeds layered during pursuits / severe weather.

---

## 2. Dashcam AI / Edge (12) — *Phase 1+ continuations*

11. **ALPR module** 🔴 — Phase 5 of the dashcam-AI roadmap; PaddleOCR or YOLO-NAS based, cross-references `bolos`/`warrants`/`stolen_vehicles`. Highest single-feature ROI on this list.
12. **Stolen-vehicle live hotlist** 🟡 — depends on #11; ALPR hit auto-broadcasts 10-9 with priority dispatch + map pin.
13. **Weapon-in-frame detection** 🟠 — vision model flags when a person in field-of-view appears to draw a firearm; tags the clip.
14. **Distracted-officer self-coaching** 🟠⚠️ — opt-in MediaPipe head-pose + phone-use detection; private to officer for self-review (union-friendly framing required).
15. **OBD-II via Freematics ONE+** 🟡 — real odometer, fuel level, DTC codes pushed to `fleet_vehicles` for accurate `next_service_mileage`.
16. **BLE officer-pairing** 🟡 — Jetson auto-binds to officer's duty-phone BLE; correctly attributes events when units swap drivers mid-shift.
17. **Audio scene classification (YAMNet)** 🟡 — Jetson-side; tags clips with siren-on, gunshot, glass-break, vehicle-impact.
18. **Signed OTA update channel** 🟠 — signed firmware + model bundles, staged rollout (10% → 50% → 100% per device pool).
19. **Per-vehicle-class IMU thresholds** 🟢 — sedan vs SUV g-profile differ; calibration script per chassis.
20. **Multi-camera support** 🟡 — front + driver + rear; selectable view in AAR replay; rear cam evidence for traffic-stop disputes.
21. **In-cabin FCW/LDW audio cue** 🟢 — local Jetson speaker, sub-100ms latency, no network dependency.
22. **Pursuit-mode 60fps + 10Hz GPS** 🟢 — already in roadmap; lock in by reusing existing `pursuit_tracker.ts`.

---

## 3. Evidence & Compliance (8) — *Phase 4 v2*

23. **Hash-chain mirror to a separate VPS** 🟠 — append-only feed of `evidence_hashes` rows to a second host with different creds; cross-host audit.
24. **Single-zip prosecutor package** 🟢 — one button bundles manifest + verify.html + clip; uses `archiver` (~14 MB add).
25. **ML face/plate redaction pipeline** 🔴⚠️ — server worker that produces `redacted_clip` derivative; original stays under custody; new `redaction_log` table. Legal-counsel review required.
26. **Retention purge automation** 🟡 — cron walks `driving_events` older than retention threshold, skips legal-hold links to `cases`/`incidents`.
27. **Prosecutor-export audit log** 🟢 — every manifest/verify/clip download logged with `case_ref`, exporter user, timestamp.
28. **Evidence chain-mirror integrity dashboard** 🟡 — visualize chain length per artifact_type, signature ratio, mirror lag.
29. **MinIO/S3 Object Lock migration** 🟠 — replaces filesystem `chmod 0444` with vendor-enforced WORM; harder guarantee for court.
30. **HSM-backed signing** 🟠⚠️ — move `EVIDENCE_SIGNING_PRIVATE_KEY` from env into a hardware security module (YubiHSM / cloud KMS); requires DA's-office buy-in for the algorithm choice.

---

## 4. Dispatch & Operations (10)

31. **AI call summarization** 🟡 — when narrative grows long, auto-produce 1-line summary for radio readback.
32. **Duplicate-call detection** 🟢 — same address + incident_type + within 10 min → suggest merge to dispatcher.
33. **Voice-driven CAD command line** 🟠 — Web Speech API for hands-free "10-4 unit 7" / "create call at 1450 South State."
34. **Real-time call density heatmap** 🟡 — last-N-hours density on MapPage to spot pattern shifts mid-shift.
35. **Predictive unit routing** 🟡 — Google Directions API given current units + dispatch + traffic, suggest fastest enroute.
36. **Beat-coverage alerts** 🟢 — banner when no unit in beat-X for > N min during peak hours.
37. **Auto-priority escalation** 🟢 — call unassigned for > X min auto-bumps priority by 1; configurable per call_type.
38. **Returning-caller panel** 🟢 — `caller_phone` matches a recent call → side panel shows that call's summary.
39. **Unified call timeline** 🟠 — radio transcript + CAD log + GPS breadcrumbs + dashcam events scrubbable on one timeline per call.
40. **Disposition templates** 🟢 — call_type-aware closeout narrative templates; one-click apply.

---

## 5. RMS / Records (9)

41. **Incident narrative AI assist** 🟠 — drafts narrative from form fields + radio transcript + linked photos. Saves substantial officer time per shift.
42. **MNI fuzzy match while typing** 🟡 — autosuggest existing persons matching first-name + DOB / nickname.
43. **Auto-cross-reference suggestions** 🟡 — adding an incident → "this person also appears in 3 other incidents this month."
44. **Natural-language statute search** 🟡 — "armed robbery in a dwelling" → Utah § 76-6-302 with elements highlighted.
45. **ALPR-fed citation auto-fill** 🟡 — depends on #11; plate → vehicle make/model/owner pre-populated.
46. **Mugshot dedup via face-similarity** 🟠 — flag potential duplicate `persons` rows on photo upload.
47. **Real NCIC/Utah-NLETS gateway** 🔴⚠️ — actual hit/no-hit, not the current placeholder; needs agency NCIC certification.
48. **BOLO geofence triggers** 🟡 — BOLO subject's last-known address geofenced; auto-tone when a unit enters that beat.
49. **Cold-case dashboard** 🟡 — open `cases` aging without activity, sortable by a lead-quality score (related calls, FIs, ALPR reads).

---

## 6. Intelligence & Investigations (8)

50. **Link analysis graph** 🟠 — D3-based graph of person/vehicle/address co-occurrence across incidents/FIs/citations.
51. **Frequent-flier dashboard** 🟢 — top-N persons by interaction count over rolling windows.
52. **Crime-pattern clustering** 🟡 — DBSCAN on `incidents.lat/lng/type` to surface emerging hotspots without an analyst.
53. **Anonymous-tip ingest portal** 🟡 — public form, rate-limited, auto-routed to investigators with phone/IP redacted.
54. **Vehicle-of-interest history** 🟡 — depends on #11; every ALPR read of a flagged plate plotted on map with timeline.
55. **Body-cam audio transcription + search** 🟠 — searchable index across all body-cam audio ("anyone mention 'red sedan'").
56. **Interview-room sync** 🟡 — link recordings to case files with synchronized timestamps.
57. **One-click OSINT pivot** 🟡 — person → court records + sex offender registry + skip tracer + social media in one panel.

---

## 7. Field & Mobile (7)

58. **Offline-first MDT** 🟠 — finish the PWA: queue calls/incidents when offline, replay on reconnect; existing scaffolding in `MobileHomePage.tsx`.
59. **Voice-to-narrative on duty phone** 🟡 — record roadside, auto-transcribe + upload when network returns.
60. **Slim mobile dispatch view** 🟡 — phone-form-factor layout; not the full 6,386-line `DispatchPage`.
61. **Push notifications for P1 calls** 🟡 — true OS-level push (FCM/APNs) even when app backgrounded.
62. **Android Auto integration** 🟠 — call list + turn-by-turn nav directly on the cruiser's head unit.
63. **Apple CarPlay companion** 🟠 — same for iOS officers.
64. **BLE ID-badge session lock** 🟡 — officer's badge proximity locks/unlocks the MDT session automatically.

---

## 8. Integrations & Ecosystem (5)

65. **Axon / WatchGuard body-cam pulls** 🟠 — automated clip pull from cloud evidence platforms; cross-reference to `incidents`.
66. **Court e-filing** 🟠⚠️ — direct submission of citations/affidavits to Utah court e-filing API; requires court agreement.
67. **Full Utah jail-roster live API** 🟡 — real-time inmate status across all Utah jails, not just current partial coverage.
68. **Webhook subscriptions for partners** 🟡 — external systems subscribe to call/incident/arrest events with HMAC signing.
69. **PostHog instrumentation** 🟢 — plugin already configured; instrument dashcam-AI flows + AAR replay engagement.

---

## 9. Automation & AI Assistance (4)

70. **Automated DAR generation** 🟡 — pulls calls/citations/incidents/miles for officer's shift; officer reviews + edits.
71. **Inactivity detection per unit** 🟢 — unit hasn't moved in N min during shift → ping officer; common cause is fell-asleep or radio down.
72. **Email auto-routing** 🟡 — natural-language classifier routes incoming emails to correct officer/inbox.
73. **Schedule conflict detection** 🟢 — overlapping `leave_requests` + `court_events` auto-flag with severity.

---

## 10. Tech Debt & Resilience (2)

74. **Encrypted offsite DB backups** 🟡 — automated daily snapshot of `rmpg-flex.db` + `dashcam-ai-evidence/` to a separate-region S3-compatible bucket; quarterly restore drill.
75. **Observability dashboard** 🟡 — internal admin page surfacing pino logs + key metrics (event ingest rate, hash-chain audit status, integration health, GPS staleness).

---

## My read on highest-leverage items

If forced to pick the top 5 with the highest impact-to-effort ratio:

1. **#11 ALPR** — single-feature transformation of patrol effectiveness; unlocks #12, #45, #54.
2. **#41 Incident narrative AI assist** — measurable hours-saved per officer per shift.
3. **#58 Offline-first MDT** — unlocks true field deployment; existing PWA scaffolding in place.
4. **#23 Hash-chain mirror to a separate VPS** — cheap relative to court-defense value.
5. **#74 Encrypted offsite DB backups** — should-already-have-this; one rsync-to-B2 cron job + restore drill SOP.

## Highest-risk items

Items where engineering is the easy part:

- **#14 Distracted-officer self-coaching** — labor relations gate.
- **#25 ML face/plate redaction** — legal-counsel gate; ML accuracy under cross-examination.
- **#47 Real NCIC gateway** — agency certification gate (months).
- **#66 Court e-filing** — court-agreement gate.

## What's deliberately not on this list

- "Rewrite in language X" / "framework Y migration" — productive distractions, not enhancements.
- Open-ended AGI / "magic" features without concrete current-tech paths.
- Anything that duplicates a capability already shipped (e.g. another dashcam vendor integration when ClearPath + Phase-1 in-house already cover the surface).

---

## Process for adopting any item

The standard brainstorming-skill flow applies:
1. Pick the item.
2. Re-enter brainstorming with that item as the focus → produces a per-feature design doc at `docs/plans/YYYY-MM-DD-<feature>-design.md`.
3. Hand off to `writing-plans` skill for the implementation plan.
4. Implement under TDD discipline.

This document is the menu, not the meal.
