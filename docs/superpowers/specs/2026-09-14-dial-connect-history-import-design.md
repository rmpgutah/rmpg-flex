# Dial Connect History Import — Design

**Date:** 2026-09-14 · **Status:** approved in session · **Mode:** copy; dispatch-app keeps its data.

## Goal

Bring every historical Dial Connect record into RMPG Flex's `/dialer-connect`
archive with full preservation: calls (all statuses, durations, dispositions,
notes, transcripts), recordings and voicemails **copied into encrypted R2**
(never just linked), scheduled callbacks, contacts, and SMS conversations.
Idempotent and re-runnable; every imported row keeps the dispatch-app id and
Twilio SID so re-runs update instead of duplicate.

Live counts (dialer-db, 2026-09-14): 199 CallLog (80 with recording, 33 with
voicemail, 0 transcripts), 5 ScheduledCallback, 4 Contact, 28 SmsConversation /
56 SmsMessage, 0 Incident / 0 IncidentEvent, 1 Unit. Incidents/units have no
rows to import; the importer still accepts them so a later run is complete.

## Why recordings never mirrored before

`CallLog.recordingUrl` / `voicemailUrl` are bare Twilio REST resources that
need HTTP Basic auth. Flex's `mirrorRecording` fetches with no credentials, so
every Twilio-hosted recording stayed `Copy pending`. dispatch-app already
proxies these with its Twilio credentials for its own UI
(`/api/calls/[id]/{recording,voicemail}`); the import reuses that idea through
a service-key-authenticated export endpoint.

## dispatch-app (Worker `dialer`)

- `src/lib/service-key.ts` — `isServiceRequest(request)`: constant-time check of
  `X-RMPG-Service-Key` against `RMPG_FLEX_SERVICE_KEY`. No dispatcher id: export
  is a system-to-system read, not an action on behalf of a dispatcher.
- `GET /api/export/history?since=<iso>&limit=<n>&cursor=<id>` (service key) →
  `{ calls, callbacks, contacts, smsConversations, users, nextCursor }`.
  Calls carry `id, twilioCallSid, direction, status, callerNumber, callerName,
  receivedAt, answeredAt, endedAt, durationSeconds, dispositionCode, notes,
  transcript, aiTranscript, aiSummary, incidentId, handledBy{id,name},
  callerIdBlocked, ivrDigits, deletedAt, deleteReason, recordingUrl?,
  voicemailUrl?` where the two URLs point at the export audio route below.
  Soft-deleted rows are included (preservation) and flagged.
- `GET /api/export/audio/:id?kind=recording|voicemail` (service key) → streams
  the Twilio MP3 with Basic auth, `Content-Type: audio/mpeg`.

## RMPG Flex (Worker `rmpg-flex-api` + D1 `rmpg-flex`)

- Migration `0290_dialer_history_import.sql` (+ runtime reconcile):
  `dialer_calls.dispatch_app_id TEXT` (unique partial index),
  `dialer_voicemails.dispatch_app_id TEXT` (unique partial index),
  new `dialer_callbacks`, `dialer_sms_conversations`, `dialer_sms_messages`,
  `dialer_contacts`. `dialer_calls` has 32 columns — far below the 100 cap.
- `POST /api/dialer-connect/import/dial-connect` (admin/manager): pulls every
  page of the export with the service key, then per record:
  - **calls** → upsert into `dialer_calls` keyed by `dispatch_app_id` (fallback
    `call_sid`). Status map: `no_answer→missed`, `in_progress→completed` if
    ended else `ringing`, others 1:1. Direction: outbound → `to_number` = caller
    number, inbound → `from_number`. `disposition`, `notes`, `transcript`
    (`aiTranscript` fallback; `aiSummary` appended to notes), `agent_name`,
    `tags` gains `dial-connect-import` (+ `dc-deleted` when soft-deleted).
    `recording_source_url` = export audio URL (recording).
  - **voicemails** → rows with `voicemailUrl` also upsert `dialer_voicemails`
    keyed by `dispatch_app_id`, `recording_source_url` = export audio URL (voicemail).
  - **callbacks / contacts / sms** → upsert by `dispatch_app_id` into the new tables.
  - Returns counts per entity + `skipped` with reasons.
- `mirrorRecording`: when the source URL is under `DIAL_CONNECT_API_BASE +
  '/api/export/audio/'`, attach `X-RMPG-Service-Key`. The existing `*/30` cron
  then copies every imported recording/voicemail into encrypted R2; the UI's
  `Archived` chip flips as they land. Requires `global_fetch_strictly_public`
  (already deployed).
- UI: Call History tab gets an admin-only **Import Dial Connect history**
  button that calls the route and toasts the counts; Voicemail tab lists the
  imported voicemails automatically.

## Error handling

Import never throws mid-way: each record is try/caught and counted in
`skipped[]` with the dispatch-app id and reason; the response is 200 with the
tally. Export unreachable → `503 dialer_unreachable`; bad service key → `403`.

## Testing

- dispatch-app vitest: export history (service key OK / 401 without / shape /
  soft-deleted flagged), export audio (401, 404, streams with Basic auth via
  mocked fetch).
- Flex Miniflare: import route with stubbed export (calls with/without SID,
  voicemail row, callback, contact, sms; idempotent second run; status map),
  mirror attaches service header for export URLs and not for Twilio URLs.
- Client: Import button renders for admin and posts to the route.
