# Serve Intake Phase 2 — Feature Bundle Design

Date: 2026-04-22
Author: chzamo@rmpgutah.us
Scope: 13 features extending the Process Service Intake pipeline.

## Bundle

| Tag | Feature | Complexity | External |
|---|---|---|---|
| A | Source PDFs attached to case/call | Medium | — |
| B | Barcode + docket↔field sheet cross-check | Small | — |
| C | Multi-defendant handling | Medium | — |
| D | Priority auto-bump on tight deadline | Small | — |
| H | OCR fallback for scanned PDFs | Medium | tesseract on VPS |
| I | Duplicate-intake detection | Small | — |
| J | Auto-gen Affidavit of Service PDF | Medium | jsPDF (client already has) |
| L | Address confidence score | Small | fast-levenshtein or similar |
| M | Prior-serve history lookup | Small | — |
| N | Geocoder fallback (OSM Nominatim) | Small | — |
| O | PACER BK pre-check | Hard | PACER scrape (brittle, legal grey) |
| Q | QR code on printed CFS | Small | qrcode npm (already installed server-side) |
| R | Photo EXIF GPS auto-fill | Small | exifr npm (new) |

## Risks / prerequisites

**H (OCR):** Tesseract is NOT installed on the VPS. First-run deploy will need `apt install tesseract-ocr` on root@194.113.64.90. Node binding: `node-tesseract-ocr` (wraps the CLI). ~50MB install size. Alternative: `tesseract.js` (pure JS, 50MB but no root required). Recommend CLI wrapper for speed.

**O (PACER BK pre-check):** PACER (pacer.uscourts.gov) is paid and has strict terms — scraping violates TOS. Free alternatives: UniCourt, CourtListener RECAP. CourtListener has a free API (recap.email) that covers most federal bankruptcies. **Recommendation:** use CourtListener Free API for BK case lookup, not PACER itself. If no hit found, NOT a definitive negative — still flag as "no record found, officer should still ask." Never block intake on O, only warn.

**Everything else:** pure code + 2 small deps (`exifr`, `fast-levenshtein`).

## Per-feature design

### A — Source PDFs attached to case/call

**Storage:** `server/uploads/serve-intake/{call_number}/{doc_type}.pdf` (e.g. `26-CFS00169/fieldSheet.pdf`). `server/uploads` is already gitignored and excluded from rsync deploys.

**Schema:** Use existing `call_attachments` table if present (grep for it); otherwise add `addCol` migrations to create it:
```sql
CREATE TABLE IF NOT EXISTS call_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id INTEGER NOT NULL,
  case_id INTEGER,
  filename TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  doc_type TEXT,         -- 'fieldSheet' | 'infoSheet' | 'courtDocket' | 'affidavit' | 'other'
  mime_type TEXT DEFAULT 'application/pdf',
  byte_size INTEGER,
  uploaded_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (call_id) REFERENCES calls_for_service(id),
  FOREIGN KEY (case_id) REFERENCES cases(id)
);
```

**API contract change:** Current `/api/serve-intake/intake` takes `{documents: [{type, text}]}`. Change the client to send `FormData` with `fieldSheet.pdf`, `infoSheet.pdf`, `courtDocket.pdf` as file blobs. Server extracts text (via pdftotext) AND saves the binary. Response adds `attachment_ids: number[]`.

**UI:** [ServeIntakePage.tsx](client/src/pages/ServeIntakePage.tsx) — the File objects captured in `handleFiles` are already held; just pass them through to the multipart POST instead of dropping them after text extraction.

### B — Barcode + cross-check

**Barcode extraction:** The docket page-1 has `*S10000NNNNNN*` (asterisk-delimited Code39). pdftotext already captures it as plain text. Regex: `\*S\d+(\d{6})\*` → clientJobNumber validation.

**Field sheet cross-check:** Field sheet has `(NNNNNN)` in parens next to Job #. Current parser extracts both.

**Cross-check logic:** If `docketBarcodeJobNumber` and `fieldSheetClientJobNumber` disagree → add warning to `warnings[]` array. Surface in UI amber banner (already rendered).

**Second cross-check:** docket complaint ¶2 has `who resides at [address]`. Compare to field sheet address via normalized-distance. If >30% different → warning.

### C — Multi-defendant handling

**Parser change:** In `parseAllDocuments`, extract all party-to-serve entries. Field sheet has one `Party to Serve:`, but info sheet's Job Activity may reference multiples. Docket caption enumerates all defendants.

**Primary approach:** Keep intake single-defendant by default. Add optional `additional_defendants: string[]` in `ParseOutput`. If >1 detected, UI prompts user ("2 defendants detected — create separate jobs?"). Creating multiple jobs = loop the create logic per defendant, each getting its own CFS call + serve_queue, sharing one `cases` row.

**Out of scope for v1:** auto-split without confirmation. Keep human-in-loop.

### D — Priority auto-bump on tight deadline

In the route, compute `hoursUntilDue = (dueDate - now) / 3600000`. Rules:
- `hoursUntilDue < 3` → `priority = 'P2'`, `priority_score = 2`, add tag `rush`, add warning
- `hoursUntilDue < 24` → `priority = 'P3'`, `priority_score = 3`, add tag `rush`
- else → `P4` (current default)

### H — OCR fallback

In `/api/serve-intake/extract-text` (server/src/routes/serveIntake.ts:45), after pdftotext returns, check `text.length < 50` OR `text.trim() === ''`. If so, run `tesseract {tmpPdf} - --psm 1` via `execFile`. Return whichever succeeds.

**VPS install step** (root-only): `ssh root@194.113.64.90 "apt install -y tesseract-ocr poppler-utils"`. Include this as a manual step in the rollout.

### I — Duplicate-intake detection

Before creating `cases` row, query:
```sql
SELECT id, created_at FROM cases
WHERE case_number = ?
  AND datetime(created_at) > datetime('now','-90 days')
LIMIT 1;
```

If hit: add warning `Duplicate job: case #633570 was uploaded on 2026-02-15 (case_id=123)`. UI prompts `[Cancel] [Create anyway] [Merge into existing]`. Merge = update existing case's `updated_at` and link new serve_queue/attempts to the existing case.

**Default behavior:** create anyway (warn-not-block) — officers may legitimately re-intake when a client submits corrections.

### J — Auto-gen Affidavit of Service PDF

**Trigger:** `POST /api/serve/attempts/:id/complete` — when all 3 attempts close (served / final non-serve). Generate `server/uploads/serve-intake/{call_number}/affidavit.pdf` via jsPDF. Attach to call + case via the `call_attachments` table from A.

**Template:** Utah URCP 4(f) affidavit. Fields: defendant, address, date/time of each attempt, result, server name/badge, notary block (blank for manual signing).

**Deferred:** digital notarization.

### L — Address confidence score

Normalize 3 addresses (field sheet, info sheet recipient, docket complaint ¶2 residence). Drop unit/apt tokens, lowercase, strip punctuation. Compute pairwise Levenshtein ratio. Score = average of 3 pairs × 100. Below 80 → warning `Address mismatch: FieldSheet=..., Docket=..., confidence=62%`.

Dependency: `fast-levenshtein` (tiny, 1.4kb).

### M — Prior-serve history

At intake, query:
```sql
SELECT sq.id, sq.created_at, sq.status, sq.recipient_name, c.case_number, c.title
FROM serve_queue sq
JOIN calls_for_service c ON c.id = sq.call_id
WHERE (sq.recipient_name = ? OR sq.recipient_address = ?)
  AND datetime(sq.created_at) > datetime('now','-1 year')
ORDER BY sq.created_at DESC LIMIT 10;
```

Return in response as `prior_serves: Array<{id, created_at, status, match_type: 'name'|'address'|'both'}>`. UI displays in result panel as "Prior serves (3): …"

Also add a CLIENT HISTORY note entry with this data so the CFS printout reflects it.

### N — Geocoder fallback

`server/src/utils/geocode.ts` currently uses Google Maps. Wrap with fallback:
```ts
export async function geocodeAddress(addr: string) {
  try { const g = await googleGeocode(addr); if (g) return g; }
  catch (err) { logger.warn({ err, addr }, 'google geocode failed'); }
  try { const o = await osmGeocode(addr); if (o) return o; }
  catch (err) { logger.warn({ err, addr }, 'osm geocode failed'); }
  return null;
}
```

OSM Nominatim requires `User-Agent: RMPG-Flex/5.x (contact@rmpgutah.us)`. Rate limit: 1 req/sec (respect). Cache results in-memory with 24h TTL.

### O — CourtListener BK pre-check (replaces PACER per risk note)

`server/src/utils/bankruptcyCheck.ts`:
```ts
export async function checkBankruptcy(firstName: string, lastName: string, state = 'UT'): Promise<{ found: boolean; cases: Array<{caseNumber: string, filed: string, court: string}> }> {
  // CourtListener RECAP search API: https://www.courtlistener.com/api/rest/v3/search/
  // Filter: type=r (RECAP), q="{lastName} {firstName}", court=bankr
  // Requires free API token (stored in clients.* or env).
  // Respect 100/day free tier; cache by (name, state) for 7 days.
}
```

**At intake:** call `checkBankruptcy(defendant.first, defendant.last)`. If any open case found → warning `POSSIBLE BK: debtor "ARMSTRONG, ABBEY" has open BK case X filed Y at Utah District. DO NOT SERVE per client rule.` Do NOT block intake — just flag.

**Token storage:** add `system_config.courtlistener_api_token`. If empty, feature is inert (returns `{found: false}` silently).

### Q — QR code on CFS PDF

CFS PDF generator is on the client side. Install `qrcode` client-side (already installed server-side — just import on client). Add a render step at the bottom-right of PS-201 page 1: QR encoding `https://rmpgutah.us/serve?q={queue_id}` (no auth token — officer is already logged in when they scan).

Alternative: encode signed short-token so anyone with the printed PDF can update status for 72h window. Defer token flow; start with plain URL.

### R — Photo EXIF GPS auto-fill

On `POST /api/serve/attempts/:id/photo` — when a photo is uploaded, parse EXIF with `exifr`. If `GPSLatitude` present, call `db.prepare('UPDATE serve_attempts SET latitude=?, longitude=? WHERE id=? AND latitude IS NULL').run(...)`.

Dependency: `exifr` (~20kb). Already handles iOS HEIC + JPEG.

## Dependency order (implementation)

```
Layer 1 (pure, no deps):        D  B  L  M  I
Layer 2 (small 3rd-party):      N (OSM)  R (exifr)  L-impl (fast-levenshtein)
Layer 3 (medium):                A (multipart) → C (multi-def) → J (affidavit)
Layer 4 (new tooling):           H (tesseract install) → Q (QR render)
Layer 5 (external + legal):     O (courtlistener)
```

Recommend building Layer 1 first, deploy + live-test; then Layer 2; then 3+4 in a second PR; then O last.

## Acceptance

Per-feature acceptance = feature-specific. Aggregate = running Armstrong intake still produces a valid CFS; additionally:

- CFS has QR code bottom-right
- Result panel shows: prior_serves, address_confidence, warnings[], attachment_ids
- Uploading a scanned PDF succeeds (OCR)
- Intake with <24h deadline creates a P3 call with `rush` tag
- Intake with multi-defendant docket shows a confirm dialog
- Completing all 3 attempts produces an affidavit PDF attached to the case
- Photo upload with GPS EXIF auto-fills the attempt lat/lng

## Out of scope for this phase

- Digital notarization of affidavits (J defers this)
- PACER direct access (replaced by CourtListener in O)
- Multi-defendant auto-split without user confirmation (C defers this)
- QR token-based auth for printed CFS (Q starts with plain URL)
