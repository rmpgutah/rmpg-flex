# RMPG Flex — Dashcam AI Evidence Handling SOP

**Status:** Phase 4 v1 (technical baseline). Subject to your DA's office and agency legal counsel review before formal adoption.
**Owner:** Custodian-of-record (designated supervisor or sworn officer with chain-of-custody training)
**Last reviewed:** _(set on adoption)_

This document describes how Flex Dashcam AI captures, stores, and produces video evidence and what each role is responsible for at each step. It is the document the agency relies on when defending evidence in court.

---

## 1. What this system produces

Flex Dashcam AI produces three classes of artifacts:

| Artifact | Where it lives | Who can read |
|---|---|---|
| Video clip (`.mp4`) | Filesystem under `${DASHCAM_AI_STORAGE_DIR}/YYYY-MM-DD/unit-N/<artifact_id>-<filename>` | Officer / dispatcher / supervisor / manager / admin via authenticated API |
| Driving event row | SQLite `driving_events` table | Officer / dispatcher / supervisor / manager / admin |
| Evidence chain entry | SQLite `evidence_hashes` table | All authenticated; signature verification is admin/manager |

A "complete piece of evidence" ties all three together via `driving_events.id ↔ evidence_hashes.artifact_id` and the file at `evidence_hashes.storage_uri`.

---

## 2. Capture chain — how a single piece of evidence is created

1. Officer drives. Edge device (Jetson Orin Nano in the cruiser) detects an event (forward-collision warning, hard brake, impact, etc.).
2. Edge device captures a 60-second clip (30 s pre + 30 s post the trigger) and signs the upload with the shared secret `DASHCAM_FORWARD_SECRET`.
3. Server's `/api/dashcam-ai/event` endpoint:
   1. Verifies the HMAC signature against the shared secret. **A failed signature is rejected with HTTP 401 — the event never lands in the database.** This is the first authentication check.
   2. Computes SHA-256 of the clip bytes.
   3. Stores the clip on the filesystem under the date/unit/artifact path.
   4. (If `EVIDENCE_SIGNING_PRIVATE_KEY` is configured) Signs a canonical payload of `(artifact_type, artifact_id, captured_at, prev_hash_id, sha256)` with the server's Ed25519 private key.
   5. Inserts the row into `evidence_hashes` with `prev_hash_id` linking to the most recent prior entry of the same `artifact_type` — forming a tamper-evident chain per type.
6. The event is now part of the chain. Modifying the clip bytes after this point breaks the SHA-256 in `evidence_hashes`. Modifying any chain field breaks the Ed25519 signature.

**The custodian-of-record cannot have edited the clip before step 4.** That is the chain-of-custody guarantee the system makes.

---

## 3. Roles & responsibilities

| Role | Responsibilities |
|---|---|
| **Custodian-of-record** | Maintains operational ownership of `EVIDENCE_SIGNING_PRIVATE_KEY`. Reviews `/api/evidence/audit` weekly. Authorizes prosecutor-package exports. Documents any storage incidents (disk failure, accidental deletion). Testifies as records custodian if subpoenaed. |
| **Sysadmin / Engineer** | Maintains `server/.env`. Rotates `DASHCAM_FORWARD_SECRET` per agency policy (note: rotation breaks fielded edge devices; coordinate with field staff). **Does NOT have access to `EVIDENCE_SIGNING_PRIVATE_KEY`** without dual control with the custodian (this is a separation-of-duties control). |
| **Supervisor / IA** | Reviews evidence via Flex UI. Triggers prosecutor exports. Authorizes redaction (see §6). |
| **Officer** | Reviews their own clips. Reports anomalies (missing clips, wrong unit attribution) to the custodian within 24h. |

---

## 4. Retention

| Data class | Default retention | Legal-hold retention |
|---|---|---|
| Position breadcrumbs (`gps_breadcrumbs`) | 90 days | Indefinite if linked to active case |
| Driving events without video | 1 year | Indefinite if linked to active case |
| Driving events WITH video | 2 years | 7+ years if linked to use-of-force, IA case, or court matter |
| Evidence hash chain (`evidence_hashes`) | **NEVER** purge | — (chain integrity depends on it) |

**Legal-hold mechanism:** When an event is linked to a case via `driving_events.call_id`, `driving_events.incident_id`, or a manual evidence-hold flag (future), the retention purger MUST skip it. Implementation note: the purge job (not in v1) will need a join to `cases` / `incidents` to determine hold status.

**Never delete an `evidence_hashes` row.** Even after the underlying clip ages out (storage purge), the hash row stays because the chain depends on `prev_hash_id` continuity. Removing an interior row breaks every subsequent row's audit.

---

## 5. Verifying integrity

### Operator-level (weekly)

```bash
# Manually via API
curl -H "Authorization: Bearer $JWT" \
  https://rmpgutah.us/api/evidence/audit
```

Response includes `all_chains_ok`, `any_signature_failure`, `any_unsigned`. Any non-green status is a chain-integrity incident — see §7.

### External-counsel-level (court / DA / defense)

The prosecutor package (§6) ships a `verify.html` file that runs entirely in the recipient's browser:

1. Recipient opens `verify.html` in any modern browser
2. Drag-drops the `clip.mp4` into the file input
3. Browser computes SHA-256 via `SubtleCrypto.digest()`
4. Page displays match (✓) or mismatch (✗) against the manifest's recorded hash

No network calls. No agency software required on the recipient's end. The Ed25519 signing public key is embedded in the manifest and printed in `verify.html`.

---

## 6. Producing a prosecutor package

When a clip is needed for a DA, defense, court, or FOIA response:

### Step 1 — Authorization

The supervisor/IA documents the request (case number, requesting party, scope) in the agency's records system. **Custodian approves.** Without custodian approval, no export.

### Step 2 — Export

Authorized user makes three downloads from Flex:

```
GET /api/evidence/<event_id>/manifest.json?case_ref=<CASE-NUMBER>
GET /api/evidence/<event_id>/verify.html?case_ref=<CASE-NUMBER>
GET /api/evidence/<event_id>/clip
```

(or via the future "Export Prosecutor Package" UI button — Phase 4 v2).

### Step 3 — Bundle

Place all three files in a single folder named per the case reference:
```
IA-2026-0042/
  manifest.json
  verify.html
  event-9871-clip.mp4
```

### Step 4 — Custodian declaration

Custodian signs a written declaration (template TBD, drafted with legal counsel) attesting:

1. The clip is a true and accurate copy of bytes recorded by the device on the date and time stated in the manifest.
2. No modifications have been made to the clip since capture, as evidenced by the SHA-256 hash match.
3. The chain-of-custody log (`/api/evidence/audit` snapshot, attached) shows the clip's hash chain is intact.

### Step 5 — Delivery

Deliver via the agency's standard evidence-transfer channel (encrypted USB / secure file transfer / hard copy of declaration with chain-of-custody form attached). DA receives:
- The folder above
- The custodian declaration
- An audit snapshot at the time of export

### Step 6 — Audit log

The export is recorded in the audit log table. Future: an audit query for "events exported between dates X and Y" should be a routine compliance check.

---

## 7. Redaction

**v1 v2: redaction is a manual process performed by qualified personnel before public release.** Faces, license plates, and witness identifiers must be obscured per agency policy and applicable state laws (Utah CCRA, federal FOIA exemptions).

For Phase 4 v1, redaction tooling is not built into Flex. If a redacted version is needed:

1. Custodian or designee uses an approved external tool (e.g., agency's video-editing software, court-approved redaction utility).
2. The redacted file gets a NEW SHA-256. **Do NOT replace the original clip file or the original `evidence_hashes` row.** The redacted version is a derivative artifact.
3. Optionally record the redacted version as a new `evidence_hashes` row with `artifact_type='redacted_clip'` referencing the original event id. (This requires a custodian to add the row manually until UI ships.)
4. The original (unredacted) clip stays under chain-of-custody for any case where the unredacted version may later be required (e.g., deposition).

Phase 4 v2 will add automated face/plate redaction via a server-side ML pipeline and a `redactions` table linking redacted derivatives to originals.

---

## 8. Incident response

### "I think a clip was deleted"

1. Run `/api/evidence/audit` — does the chain show `all_chains_ok=true`?
   - If yes: the clip's metadata may still be intact. Check `driving_events` for the event_id; if `clip_object_key` is not null, the file may have been moved without affecting the row. Search the filesystem.
   - If no: the chain is broken. **Stop. Do not write any new evidence rows.** Document the date/time you detected, and start an investigation.
2. Run `/api/evidence/keypair-info`. Confirm signing is configured. If it shows `configured: false`, signing was inactive when the affected event was recorded — the chain link is unsigned and the breach can't be cryptographically proven.
3. Notify the custodian and the agency's legal counsel.
4. Preserve the current state of the database and storage. Do not run any cleanup or migration scripts.
5. Recover from the most recent backup that shows the chain intact (chain audit OK).

### "Someone may have edited a clip"

The browser-based verify (§5) will detect this on the recipient's end via SHA-256 mismatch. From the agency side: chain audit will show `signature_failure: true` for the affected entry — see §8 above.

### "We rotated `JWT_SECRET` and now I'm worried about evidence"

Rotating `JWT_SECRET` does NOT affect evidence signing. The two are intentionally separate (CLAUDE.md gotcha #1 + Phase 4 design). `EVIDENCE_SIGNING_*` keys live under their own env vars.

If you rotated `EVIDENCE_SIGNING_PRIVATE_KEY` without preserving the old key: every row signed with the old key still verifies against its `signer` column (which contains the public key in use AT TIME OF SIGNING). Rotation breaks no past evidence — but the OLD private key must remain archived in case a court ever wants to confirm the signature was server-generated.

---

## 9. Configuration checklist

Before this SOP applies in production:

- [ ] `EVIDENCE_SIGNING_PRIVATE_KEY` and `EVIDENCE_SIGNING_PUBLIC_KEY` set in `server/.env` (run `node server/scripts/generate-evidence-keypair.mjs` to mint a fresh pair)
- [ ] `DASHCAM_AI_WRITE_ONCE=1` set in `server/.env` (chmod-0444 hardening)
- [ ] `DASHCAM_AI_STORAGE_DIR` set to a path on a filesystem with adequate space and inode capacity (50 MB/event × 20 events/shift × 15 vehicles × 90 days ≈ 1.4 TB at default retention)
- [ ] Backup procedure documented and tested (full snapshot of `${DASHCAM_AI_STORAGE_DIR}` + SQLite db)
- [ ] DA's office briefed on the verification page and given the public key
- [ ] Custodian designated in writing
- [ ] First chain audit run, output archived

---

## 10. References

- [HMAC webhook auth](../server/src/utils/dashcamAiHmac.ts) — origin authentication for ingest
- [Evidence signer](../server/src/utils/evidenceSigner.ts) — Ed25519 chain signing
- [Evidence hasher](../server/src/utils/evidenceHasher.ts) — chain-of-custody writer + audit
- [Storage adapter](../server/src/utils/storageAdapter.ts) — filesystem v0 with write-once option
- [Prosecutor export](../server/src/utils/prosecutorExport.ts) — manifest + verify.html builders
- [Evidence routes](../server/src/routes/evidence.ts) — operator HTTP surface
- [CLAUDE.md gotcha #45](../CLAUDE.md) — env-var separation rationale

---

_This SOP is a living document. Material changes (algorithm changes, retention period changes, new artifact types, new roles) require custodian + legal counsel sign-off and an updated `Last reviewed` date._
