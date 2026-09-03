# Daily Email Reports — Implementation Plan

**Date:** 2026-09-01
**Status:** Draft
**Goal:** Send daily email reports to configurable recipients (managers, admins, supervisors) at 23:55 MT, containing an extended-scope HTML summary body + the daily blotter PDF attachment.

## Problem

Management and supervisory staff need a daily email summarizing all operational activity (calls, citations, fleet, warrants, incidents, ALPR scans, patrol scans, new persons) for the 00:00–23:59 MT period. The existing Fleet Daily Blotter generates a PDF nightly at 00:05 but is not emailed — recipients must manually log in and download it. This feature sends the report proactively.

## Architecture

### Components

| File | Purpose |
|------|---------|
| `src/utils/dailyEmail/config.ts` | Recipient list management (system_config CRUD) |
| `src/utils/dailyEmail/collectExtended.ts` | Extended data collection (warrants, incidents, ALPR, patrol, persons) |
| `src/utils/dailyEmail/renderHtml.ts` | HTML email body builder |
| `src/utils/dailyEmail/sendDailyEmails.ts` | Orchestrator: collect → render → attach PDF → send via Resend |
| `src/routes/dailyEmailAdmin.ts` | Admin endpoints for recipient list management |
| `src/index.ts` | Modified: add 23:55 MT cron gate |

### Data Flow

```
23:55 MT cron trigger
  → collectDailyReport(date)          // existing blotter data
  → collectExtendedActivity(date)     // warrants, incidents, ALPR, patrol, persons
  → renderDailyReport(data)           // existing PDF renderer → Uint8Array
  → renderDailyEmailHtml(data, ext)   // new HTML summary
  → sendViaResend(apiKey, {           // existing Resend client
      to: recipients,
      subject: "RMPG Daily Activity Report — YYYY-MM-DD",
      html: renderDailyEmailHtml(...),
      attachments: [{ filename: "rmpg-daily-YYYY-MM-DD.pdf", content: base64 }]
    })
```

## New Dependencies

None — Resend is already integrated (`src/utils/resendEmail.ts`). `pdf-lib` is already in use for the blotter renderer.

## Configurable Recipient List

Stored in `system_config` (category `'daily_email'`):

| config_key | Value |
|------------|-------|
| `daily_email_recipients` | Comma-separated email addresses |
| `daily_email_enabled` | `'1'` or `'0'` |
| `daily_email_include_pdf` | `'1'` or `'0'` |

Admin endpoints at `/api/admin/daily-email`:
- `GET /recipients` — returns current list + enabled flag
- `PUT /recipients` — body `{ enabled: boolean, recipients: string[] }`
- `POST /test-send` — sends a test email to verify Resend config

## HTML Email Template

Professional, readable email with:
- RMPG header with date
- Summary counters (total calls, citations, warrants, ALPR scans, etc.)
- Section breakdowns with key metrics
- Table-style layout for readability in email clients
- "No activity recorded" for empty sections

## Cron Schedule

Add to existing per-minute cron (`* * * * *`) with a Denver-timezone gate:

```ts
if (denverHour === 23 && denverMinute === 55) {
  await runDailyEmails(env, ctx);
}
```

This follows the existing pattern used by the daily blotter (00:05 gate).

## Extended Data Sources

| Source Table | What to Collect | Query Window |
|--------------|-----------------|--------------|
| `calls_for_service` | Call count by type, status | 00:00–23:59 MT |
| `citations` | Citation count, total fines | 00:00–23:59 MT |
| `warrants` | New warrants, status changes | 00:00–23:59 MT |
| `incidents` | New incidents, approval status | 00:00–23:59 MT |
| `alpr_captures` | ALPR scans, hits, plates | 00:00–23:59 MT |
| `patrol_scans` | Checkpoint compliance | 00:00–23:59 MT |
| `persons` | New persons added | 00:00–23:59 MT |
| `unit_trips` | Fleet trips + mileage | 00:00–23:59 MT |
| `fleet_fuel_log` | Fuel entries | 00:00–23:59 MT |
| `fleet_inspections` | Inspections | 00:00–23:59 MT |
| `work_orders` | Work orders opened/closed | 00:00–23:59 MT |

## Error Handling

| Condition | Behavior |
|-----------|----------|
| `RESEND_API_KEY` not set | Skip email send, log warning, don't crash cron |
| No recipients configured | Skip send, log info, no error |
| Recipient list empty after filtering | Skip send |
| Resend API error | Log to `error_log`, continue cron |
| D1 query fails | Log error, skip that section, include what succeeded |
| PDF generation fails | Send HTML-only email (no attachment) |

## Testing

### Unit Tests

- `tests/dailyEmailConfig.test.ts` — recipient list CRUD
- `tests/dailyEmailCollect.test.ts` — extended data collection with stubbed D1
- `tests/dailyEmailRenderHtml.test.ts` — HTML output validation
- `tests/dailyEmailSend.test.ts` — orchestrator logic with mocked Resend

### Integration Tests

- `test-workers/dailyEmailAdmin.test.ts` — admin endpoints (Miniflare)

## Security

- Recipient management is admin-only (`requireRole('admin')`)
- `RESEND_API_KEY` is a secret (`wrangler secret put RESEND_API_KEY`)
- Email addresses are not validated beyond basic format check
- Test send is admin-only and rate-limited

## Deployment

1. Set `RESEND_API_KEY` via `wrangler secret put RESEND_API_KEY`
2. Deploy worker
3. Configure recipients via `PUT /api/admin/daily-email/recipients`
4. Verify with `POST /api/admin/daily-email/test-send`
5. Cron will automatically start sending at 23:55 MT

## Implementation Tasks

### Task 1: Recipient config module
**Files:** `src/utils/dailyEmail/config.ts`, `tests/dailyEmailConfig.test.ts`
**Steps:**
- [ ] Create config module with getRecipients, setRecipients, isEnabled, setEnabled
- [ ] Write unit tests for config CRUD
- [ ] Typecheck + commit

### Task 2: Extended data collection
**Files:** `src/utils/dailyEmail/collectExtended.ts`, `tests/dailyEmailCollect.test.ts`
**Steps:**
- [ ] Create extended collector that queries warrants, incidents, ALPR, patrol, persons
- [ ] Reuse `denverDayBoundsUtc` from existing dailyReport module
- [ ] Write unit tests with stubbed D1
- [ ] Typecheck + commit

### Task 3: HTML email renderer
**Files:** `src/utils/dailyEmail/renderHtml.ts`, `tests/dailyEmailRenderHtml.test.ts`
**Steps:**
- [ ] Create HTML builder with professional email template
- [ ] Include summary counters and section breakdowns
- [ ] Handle empty sections gracefully
- [ ] Write tests for output structure
- [ ] Typecheck + commit

### Task 4: Email send orchestrator
**Files:** `src/utils/dailyEmail/sendDailyEmails.ts`, `tests/dailyEmailSend.test.ts`
**Steps:**
- [ ] Create orchestrator that ties together collect → render → PDF → send
- [ ] Reuse existing `renderDailyReport` for PDF
- [ ] Reuse existing `sendViaResend` for email delivery
- [ ] Handle errors gracefully (PDF failure → HTML only, etc.)
- [ ] Write tests with mocked dependencies
- [ ] Typecheck + commit

### Task 5: Admin endpoints
**Files:** `src/routes/dailyEmailAdmin.ts`, `test-workers/dailyEmailAdmin.test.ts`
**Steps:**
- [ ] Create router with GET/PUT /recipients and POST /test-send
- [ ] Gate behind requireRole('admin')
- [ ] Mount in src/routesConfig.ts
- [ ] Write Miniflare integration tests
- [ ] Typecheck + commit

### Task 6: Cron integration
**Files:** `src/index.ts` (modified)
**Steps:**
- [ ] Add 23:55 MT gate in the per-minute cron handler
- [ ] Import and call runDailyEmails
- [ ] Wrap in try/catch with logErrorToDb
- [ ] Typecheck + commit

### Task 7: End-to-end verification
**Steps:**
- [ ] Set RESEND_API_KEY secret
- [ ] Configure test recipients
- [ ] Send test email
- [ ] Verify PDF attachment renders
- [ ] Verify HTML body is readable
- [ ] Run full test suite
