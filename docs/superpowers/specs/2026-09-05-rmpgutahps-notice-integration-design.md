# rmpgutahps.us ↔ RMPG Flex — Notice of Attempt integration (follow-up scope)

**Status:** scoped, not started · **Parent PR:** #4133 (Notice of Attempt copy + support panel)
**Owner:** process-service module · **Target:** one follow-up PR on RMPG Flex + a matching change on rmpgutahps.us

## 1. Problem

PR #4133 puts three rmpgutahps.us touch-points on a document handed to a member of the
public: the `AGENCY REF ID` in the header, `rmpgutahps.us/support` in the support
panel, and `rmpgutahps.us/notice-of-attempt` as the plain-language explainer. Today
none of those pages can do anything with the reference the subject is holding, and the
QR code still has to point at `rmpgutah.us/verify` because that is the only page that
talks to the Worker's public verify route.

That verify route ([`src/routes/serveQrScan.ts`](../../../src/routes/serveQrScan.ts),
mounted `auth: 'public'` at `/api/verify`) is load-bearing. On every scan it:

- inserts a `serve_qr_scans` row with Cloudflare IP-geo, device type, and (via the
  follow-up `POST /telemetry`, `/details`, `/details/timeonpage`, `/location` calls from
  the landing page) browser fingerprint, GPS after consent, and time-on-page;
- broadcasts `serve_qr_scan` over WebSocket and inserts a `high`-priority
  `notifications` row for the assigned officer: **"QR Code Scanned — Subject Engaged"**.

Retargeting the QR at rmpgutahps.us without first teaching that site to make those
calls would silently delete the scan log and the officer alert. PR #4133 therefore
keeps the QR on `rmpgutah.us/verify`; this spec moves it.

## 2. Goals

1. A subject scanning the QR, or typing the `AGENCY REF ID` into rmpgutahps.us, lands
   on a public page that confirms the notice is genuine and offers to schedule
   delivery, **and** the officer still gets the Subject Engaged alert with the same
   telemetry as today.
2. `AGENCY REF ID` is the one identifier both systems speak. RMPG Flex already emits
   `JOB-<serve_queue.id>` ([`ServePage.tsx:460`](../../../client/src/pages/ServePage.tsx))
   and the verify route already resolves that shape; rmpgutahps.us must accept it verbatim.
3. A "schedule delivery" request from the subject lands on the serve job in RMPG Flex as
   a note + officer notification, without giving the public site write access to
   anything else.

## 3. Non-goals

- Exposing recipient name, address, hiring party, attempt notes, or GPS to the public
  page. The verify route already returns only agency identity + a generic message; keep
  that contract.
- Two-way sync of serve jobs, billing, or the `ps_pricing_items` rate card (migration
  0104 already names rmpgutahps.us as the pricing source of truth — separate track).
- Replacing the existing `integrations/services/rmpgutahps` outbound key + URL pair or
  the `integration_api_keys` inbound model. Both are reused as-is.

## 4. Design

### 4.1 Reference format (both sides)

`AGENCY REF ID` = `JOB-<id>` where `<id>` is `serve_queue.id`. Case-insensitive on
input, always printed upper-case. rmpgutahps.us validates `^JOB-\d+$` before calling
the Worker; anything else is a "we couldn't find that reference" page, not an API call.

### 4.2 Worker (RMPG Flex) changes

| # | Change | File | Notes |
|---|---|---|---|
| W1 | Add `https://rmpgutahps.us` and `https://www.rmpgutahps.us` to `CORS_ORIGINS` | `wrangler.toml` `[vars]` | Browser on rmpgutahps.us must be able to call `/api/verify*`. `credentials: true` is already set; these routes send no cookies. |
| W2 | Add `redirect_url`/`support_url` fields to the `GET /api/verify` response, sourced from `SUBJECT_SUPPORT` mirrored server-side | `src/routes/serveQrScan.ts` | Lets the public page render the same channels as the printed panel from one source. Keep `website` for back-compat with `VerifyNoticePage`. |
| W3 | New public route `POST /api/verify/schedule-request` | `src/routes/serveQrScan.ts` | Body: `{ ref, preferred_window: 'morning'\|'afternoon'\|'evening'\|'weekend', contact_method: 'phone'\|'email', contact_value, note? }`. Inserts a `serve_job_notes` (or existing notes table — verify live schema first) row + `notifications` row (`type='serve_schedule_request'`, `priority='high'`) for the officer, broadcasts `serve_schedule_request` over WS. Rate-limit by IP via KV (5/hr) and by ref (3/day). Turnstile token required (`TURNSTILE_SECRET` binding; 503-style `{ok:false, code:'not_configured'}` if unset). |
| W4 | Schema: `serve_schedule_requests` table (ref, job_id, window, contact_method, contact_value, note, ip, created_at, status) | `migrations/02NN_serve_schedule_requests.sql` | Idempotent `CREATE TABLE IF NOT EXISTS`. Apply + track via `scripts/apply-migration.sh` after merge. |
| W5 | Officer surface: show pending schedule requests on `ServeJobCard` + the mobile Active Calls card | `client/src/components/serve/ServeJobCard.tsx`, `client/src/pages/mobile/cards/ActiveCallsCard.tsx` | Accept → sets `status='accepted'`, optional write to `nextAttemptNote`. |
| W6 | Flip the QR target | `client/src/utils/servePdfGenerator.ts` (`verifyUrl`) | `SUBJECT_SUPPORT.noticeInfoUrl + '?ref=' + headerRef`. **Last step, gated on rmpgutahps.us P1 being live.** |
| W7 | `VerifyNoticePage` becomes a thin redirect to the rmpgutahps.us page carrying `?ref=` | `client/src/pages/VerifyNoticePage.tsx` | Old printed notices in the field keep working. |

### 4.3 rmpgutahps.us changes (sibling repo)

| # | Change | Notes |
|---|---|---|
| P1 | `/notice-of-attempt?ref=JOB-N` page | On load: `GET https://api.rmpgutah.us/api/verify?ref=` → render "Verified: issued by RMPG" card + ref badge + the three support channels. Then fire the same `POST /telemetry`, `/details`, `/details/timeonpage` beacons `VerifyNoticePage` fires today (port the payload builders verbatim — the Worker schema in migrations 0252/0253 is the contract). Location prompt is opt-in, as today. |
| P2 | "Schedule a delivery" form on that page | Posts to W3 with a Turnstile token. Confirmation copy: "Thanks — the assigned server will reach out using the contact you provided." |
| P3 | `/support` gets a "Have a Notice of Attempt?" entry with a ref input that routes to P1 | No API call until the regex passes. |
| P4 | Copy alignment | Use "AGENCY REF ID" verbatim everywhere; phone route "press 1, then 1, then 3"; email server@rmpgutah.us. |

### 4.4 Security / privacy

- Public routes stay in `isPublicAuthBypass()` / `auth: 'public'` only for `/api/verify*`.
  No JWT-gated data crosses to rmpgutahps.us.
- W3 is the only public write. Turnstile + KV rate limits + strict body validation
  (lengths, enums) + no free-text reaching the officer unsanitized (reuse
  `sanitizePdfText`-style stripping or a dedicated validator).
- Never echo recipient PII back to the public page. The verify response must remain
  agency-only.
- `CORS_ORIGINS` gains exactly the two rmpgutahps.us origins; no wildcard.

### 4.5 Rollout order

1. W1, W2, W3, W4, W5 merge and deploy (QR still on rmpgutah.us). Verify with a curl to
   `/api/verify?ref=JOB-<live id>` from a rmpgutahps.us origin header.
2. P1–P4 ship on rmpgutahps.us. Confirm a real scan of an existing notice through the
   new page produces a `serve_qr_scans` row **and** the officer notification.
3. W6 + W7 merge. New notices print the rmpgutahps.us QR; old ones redirect.

### 4.6 Tests

- Worker (`tests/` + `test-workers/`): W3 happy path, rate-limit 429s, Turnstile-unset
  503 shape, bad-ref 400, PII never present in `GET /api/verify` body.
- Client: `noticeOfAttempt.layout.test.ts` gains an assertion that the QR payload
  starts with `SUBJECT_SUPPORT.noticeInfoUrl` (decode via the `qrcode` lib's
  `toString` in test, not pixel decoding) once W6 lands.
- Manual: print one notice on the PJ-700 and scan with a phone from off-network; check
  Dispatch receives Subject Engaged.

## 5. Open questions for the operator

1. Is rmpgutahps.us static (Pages) or does it have its own Worker? If static, the
   telemetry beacons and the schedule form call `api.rmpgutah.us` directly (needs W1).
   If it has a Worker, it can proxy and W1 becomes optional.
2. Does a `serve_job_notes`-style table exist on live, or should W3 write to
   `serve_queue.notes`? Check `sqlite_master` before writing W4.
3. Should accepted schedule requests auto-populate `nextAttemptNote` on the next printed
   Notice, or stay officer-confirmed only?

## 6. Estimate

Worker + client (W1–W7): ~1 PR, 1–2 days incl. tests. rmpgutahps.us (P1–P4): 1–2 days
depending on the site's stack. Rollout step 2 is the gate; step 3 is a 2-line change.
