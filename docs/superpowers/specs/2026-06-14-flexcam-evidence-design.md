# FlexCam Phase 2 — Evidence & Auto-Preserve Design

- **Date:** 2026-06-14
- **Status:** Approved design → spec for review
- **Scope:** Phase 2 of the FlexCam program. Builds on Phase 1 (`docs/superpowers/specs/2026-06-14-flexcam-footage-foundation-design.md`, PR #1256). Stacked branch `claude/flexcam-evidence` off `claude/dazzling-blackwell-36b39a`.

---

## 1. Background

Phase 1 captures full-trip dashcam footage into our R2 as `footage_requests` + ordered `footage_chunks` (migration `0118`, applied live). `enqueueFootage(env, args)` accepts `reason: 'trip_auto' | 'on_demand' | 'critical_event'` — the `'critical_event'` value already exists with **zero callers**, reserved for this phase.

Phase 2 adds the **evidence governance layer**: auto-preserve footage when a critical event fires, lock it as immutable-by-default evidence, maintain a court-grade chain-of-custody, link it to incidents/cases, and produce a signed tamper-evident court package.

### Operator decisions (locked during brainstorming)
- **Capture window:** `[event_ts − 2min, event_ts + 5min]` (~7 min, ~11 chunks at 40s).
- **Lock policy:** auto-lock on capture; unlock requires **admin + a mandatory logged reason**.
- **Custody log:** custody events (preserve / lock / unlock / export / download / delete-attempt / linked) **plus deduped views** (one entry per user per viewing session, not per chunk).
- **Court export:** signed **metadata** package now (Worker-native); **in-video redaction/trim/watermark deferred** (client `ffmpeg.wasm`, separate phase).

### What exists to reuse (from the context map)
- `enqueueFootage(env, {assetId, unitId?, cpgDeviceId?, tripId?, callId?, fromTs, toTs, reason, channels?, title?, createdBy?}) → Promise<number|null>` (idempotent on `(asset,from,to,reason)`).
- Device resolution: `SELECT cpg_camera_id, cpg_device_id FROM cpg_device_mappings WHERE unit_id=? AND is_active=1`.
- **Ed25519 signing:** `POST /api/pdf-tools/sign-payload` (WebCrypto, returns `{signature, signedAt, algorithm:'Ed25519', keyId}`) — reuse for the court package.
- `audit_log` table (broad audit trail).
- Hook seams: `panic.ts` (after `panicId` assigned, ~L188; has `userId, unit.id, lat, lng, callId`), `useOfForce.ts` (after insert, ~L132; has `userId, b.incident_id`), `incidents.ts` (after `created`, ~L110; has `userId, lat, lng, call_id`). All resolve unit via `units WHERE officer_id=userId` when unit isn't directly in scope.

### What does NOT exist (net-new here)
No lock/immutability, custody-transfer log, retention flag, or footage↔evidence link. No video redaction (deferred). The image-native `evidence_manifests` table is NOT reused (wrong shape for multi-chunk video).

---

## 2. Goals / Non-goals

**Goals:**
- Auto-preserve + auto-lock footage on panic / use-of-force / incident (best-effort, never disrupting the primary action).
- Evidence lock with admin-only audited unlock; locked footage is protected from deletion + retention purge.
- Court-grade chain-of-custody (custody events + deduped views).
- Link evidence footage to incident/call/case/UoF/person/warrant.
- A signed, tamper-evident **metadata** court package (manifest + per-chunk hashes + custody report, Ed25519-signed); printable cover sheet rendered client-side.

**Non-goals (deferred):**
- In-video redaction / face-or-plate blur / trim / watermark (client `ffmpeg.wasm`, separate phase).
- Unifying with the image `evidence_manifests` registry (larger refactor).
- A rich evidence-review UI (Phase 3); Phase 2 ships minimal endpoints + reuses/extends the Phase 1 client page lightly.

---

## 3. Data model

`footage_requests` is a small Phase-1 table (not near the 100-col cap), so `ALTER ADD COLUMN` is safe. All DDL idempotent + runtime-reconciled (`ensureEvidenceSchema`) AND a migration; **apply to live `785de7ae` after merge**.

### 3.1 Extend `footage_requests` (migration `0119`)
```sql
ALTER TABLE footage_requests ADD COLUMN evidence_locked INTEGER DEFAULT 0;
ALTER TABLE footage_requests ADD COLUMN evidence_number TEXT;        -- 'YY-FEV-NNNNN'
ALTER TABLE footage_requests ADD COLUMN classification TEXT DEFAULT 'routine'; -- routine|evidence|restricted
ALTER TABLE footage_requests ADD COLUMN preserved_reason TEXT;       -- panic|use_of_force|incident|manual
ALTER TABLE footage_requests ADD COLUMN preserved_event_type TEXT;   -- panic_alert|use_of_force|incident
ALTER TABLE footage_requests ADD COLUMN preserved_event_id INTEGER;
ALTER TABLE footage_chunks   ADD COLUMN sha256 TEXT;                  -- per-chunk hash, computed + cached at court-package time
```
(D1 doesn't support `IF NOT EXISTS` on `ADD COLUMN`; the runtime reconciler uses `columnExists()` before each ALTER, and re-apply failures are tolerated — established pattern.)

### 3.2 New `footage_custody_log`
```sql
CREATE TABLE IF NOT EXISTS footage_custody_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  footage_request_id INTEGER NOT NULL,
  action TEXT NOT NULL,            -- preserved|locked|unlocked|viewed|exported|downloaded|delete_attempt|linked
  actor_user_id INTEGER,
  actor_name TEXT,
  reason TEXT,                     -- required for 'unlocked'
  detail TEXT,                     -- JSON (e.g. event ref, link target, export id)
  session_key TEXT,                -- view-dedupe key; one 'viewed' row per (request, actor, session_key)
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_footage_custody_req ON footage_custody_log(footage_request_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_footage_custody_view ON footage_custody_log(footage_request_id, actor_user_id, session_key) WHERE action='viewed';
```
The partial UNIQUE index enforces view-dedupe at the DB layer: a repeat view in the same session is an `INSERT OR IGNORE` no-op.

### 3.3 New `footage_evidence_links`
```sql
CREATE TABLE IF NOT EXISTS footage_evidence_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  footage_request_id INTEGER NOT NULL,
  entity_type TEXT NOT NULL,       -- incident|call|case|use_of_force|person|warrant
  entity_id INTEGER NOT NULL,
  linked_by INTEGER,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_footage_evlink ON footage_evidence_links(footage_request_id, entity_type, entity_id);
```

---

## 4. Components

### 4.1 `src/utils/footage/evidence.ts` (pure + a custody seam)
PURE (unit-tested): 
- `evidenceNumber(year, seq) → 'YY-FEV-NNNNN'`.
- `viewSessionKey(userId, isoTime) → string` (e.g. `${userId}|${YYYY-MM-DD-HH}` — one view row per user per hour; cheap, no client session id needed).
- `isUnlockable(reason) → boolean` (reason non-empty/trimmed).
- `buildCourtManifest(request, chunks, links, custody) → CourtManifest` (the JSON to be hashed + signed: evidence #, refs, officer, device, window, ordered chunks with `{seq, from_ts, to_ts, bytes, sha256}`, gaps, custody log).
- `manifestPayloadHash(manifest) → Promise<string>` (SHA-256 hex of canonical JSON).

Seam: `logCustody(db, {requestId, action, actorUserId, actorName, reason?, detail?, sessionKey?}) → Promise<void>` — `INSERT OR IGNORE` so the deduped-view unique index makes repeats no-ops; never throws.

### 4.2 `src/utils/footage/autoPreserve.ts`
```ts
export async function preserveForEvent(env: Bindings, p: {
  eventType: 'panic_alert' | 'use_of_force' | 'incident';
  eventId: number; reason: 'panic' | 'use_of_force' | 'incident';
  unitId: number | null; officerUserId: number | null; callId?: number | null;
  eventTs: number; // epoch ms
}): Promise<number | null>
```
Resolves unit→asset (skip cleanly if none), computes `[eventTs−120_000, eventTs+300_000]`, calls `enqueueFootage(reason:'critical_event')`, then on a non-null request id: sets `evidence_locked=1, classification='evidence', preserved_reason, preserved_event_type, preserved_event_id, evidence_number=<generated>`, writes `preserved` + `locked` custody rows, and a `footage_evidence_links` row to the event's incident/call when present. Entirely best-effort (caller wraps in try/catch).

### 4.3 The 3 hooks (best-effort, never disrupt primary action)
- `panic.ts` after `panicId` (~L188): `preserveForEvent({eventType:'panic_alert', eventId:panicId, reason:'panic', unitId:unit.id, officerUserId:userId, callId, eventTs:Date.now()})`.
- `useOfForce.ts` after insert (~L132): resolve unit via `units WHERE officer_id=userId`; `preserveForEvent({eventType:'use_of_force', eventId, reason:'use_of_force', unitId, officerUserId:userId, callId: incident's call if resolvable, eventTs:Date.now()})`.
- `incidents.ts` after `created` (~L110): resolve unit similarly; `preserveForEvent({eventType:'incident', eventId, reason:'incident', unitId, officerUserId:userId, callId:body.call_id, eventTs:Date.now()})`.
Each wrapped in `try/catch` logging `[flexcam-preserve] …`.

### 4.4 Evidence endpoints (extend `src/routes/flexcam.ts`)
- `POST /footage/:id/lock` — set `evidence_locked=1`, `classification='evidence'`, assign `evidence_number` if absent; custody `locked`. (auth: any officer+.)
- `POST /footage/:id/unlock` — **admin only** (`requireRole('admin')`) + body `{reason}` required (400 if blank); `evidence_locked=0`; custody `unlocked` with reason.
- `GET /footage/:id/custody` — the full custody log (ordered) + current lock/evidence state.
- `POST /footage/:id/links` / `GET /footage/:id/links` — manage `footage_evidence_links`; custody `linked` on add.
- `POST /footage/:id/court-package` — build `CourtManifest`, compute per-chunk SHA-256 (stream each R2 object through `crypto.subtle.digest`; cache onto a `footage_chunks.sha256` column — add via reconciler), hash the manifest, call `POST /api/pdf-tools/sign-payload` internally (or invoke its signer util directly), persist + return `{manifest, signature, signedAt, keyId}`; custody `exported`.
- **Instrument existing paths:** the chunk-stream endpoint logs a deduped `viewed` custody row (via `viewSessionKey`); a new guard on any footage delete blocks deletion when `evidence_locked=1` (returns 409 + custody `delete_attempt`).

### 4.5 Court cover sheet (client)
Rendered client-side with jsPDF (Arial-only, per `[[project-pdf-arial-only-sweep]]`) from the signed manifest the Worker returns — evidence #, case/incident, officer, device, window, chunk hashes, custody narrative, the Ed25519 signature block. (Client work is minimal; the rich evidence UI is Phase 3.)

---

## 5. Flows

**Auto-preserve:** critical event fires → hook calls `preserveForEvent` → window computed → `enqueueFootage(critical_event)` (Phase-1 cron then pulls the chunks into R2) → request immediately marked locked evidence + custody `preserved`/`locked` + linked to the incident/call. The footage downloads asynchronously (camera-online dependent) but is *locked from creation*, so it can't be purged while pending.

**Lock/unlock:** officer locks → immutable to non-admins. Admin unlock requires a reason → custody `unlocked`. Locked requests are excluded from any retention/cleanup and return 409 on delete.

**Court package:** operator requests it for a locked request → Worker hashes each chunk + the manifest, Ed25519-signs → returns signed manifest → client renders the cover-sheet PDF. Tamper-evident: re-hashing the R2 chunks must reproduce the manifest hash the signature covers.

---

## 6. Testing
- **Pure (vitest):** `evidenceNumber`, `viewSessionKey` (dedupe stability), `isUnlockable`, `buildCourtManifest` (ordering, gaps, hash field shape), `manifestPayloadHash` (canonical + deterministic).
- **Route smoke:** unlock without admin → 403; unlock without reason → 400; delete of a locked request → 409.
- Worker typecheck; client typecheck/build; bump `client/public/sw.js` `CACHE_NAME`.

---

## 7. Guardrails / risks
- All 3 hooks are best-effort; a preserve failure never breaks panic/UoF/incident filing.
- Auto-preserve depends on a `cpg_device_mappings` row for the unit + the camera being online (footage may arrive late or `partial` — surfaced via Phase-1 gap detection; the lock + custody record exist regardless).
- Per-chunk hashing is bounded (~11 chunks/7-min window); for an unusually long manual evidence clip, cap or stream-hash to avoid Worker CPU limits.
- `evidence_number` sequence: per-year counter from `MAX(evidence_number)`; non-atomic (TOCTOU) like sibling numbering (acceptable at single-agency volume).

---

## 8. Deferred (later phases)
In-video redaction/trim/watermark (client ffmpeg.wasm); evidence_manifests unification; rich evidence-review + map-synced UI (Phase 3); critical-event push notifications.
