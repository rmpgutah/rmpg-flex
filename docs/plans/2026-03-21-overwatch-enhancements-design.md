# OVERWATCH CRM Enhancement Design

> **Approach:** Horizontal sweep — visible improvements across all sections, with proposal PDF/contract renewal given deepest treatment.

---

## Section 1 — Dashboard (Command Center)

**Goal:** Transform the dashboard from a status summary into a real ops command center.

**Changes:**
- **Pipeline funnel widget** — horizontal bar showing lead counts per stage (new→won), clickable to jump to Leads filtered by that stage. Pulls from existing `/crm/leads/pipeline-summary`.
- **Revenue trend** — 6-month inline SVG sparkline of invoiced vs. paid. New endpoint: `GET /crm/reports/revenue-trend?months=6`.
- **Upcoming tasks widget** — replaces the second grid column. Shows tasks due this week, sorted by priority, each clicking to Tasks section. Pulled from existing `/crm/tasks`.
- **5th stat card: Pipeline Value** — sum of open lead estimated values from pipeline-summary endpoint.

**DB changes:** None.

---

## Section 2 — Leads Pipeline

**Goal:** Surface lead health and reduce friction on key transitions.

**Changes:**
- **Lead scoring badge** — 0–100 score: estimated value (40pts), recency of contact (−10pts if >14 days stale), stage progression speed, lead source quality weight. Computed server-side on save, stored as `lead_score INTEGER` on `crm_leads`.
- **Quick-convert to proposal** — "→ PROPOSAL" button in detail panel pre-fills new proposal from lead data.
- **Stale lead alert** — amber `⚠ STALE` badge if no activity in 14+ days. Client-side from `last_activity_at`.
- **Pipeline value total** — sum of estimated values for non-lost/dismissed leads displayed at top of pipeline view.

**DB changes:** Add `lead_score INTEGER` to `crm_leads`.

---

## Section 3 — Clients + Properties

**Goal:** Surface operational data from CAD and add contract visibility.

**Changes:**

**Clients:**
- **CAD incident feed** — "Incidents" sub-tab in client detail. `GET /crm/clients/:id/incidents?limit=20` joins `calls_for_service` via `property_id`.
- **Contract status banner** — color-coded header in detail panel: green (>90 days), amber (<90 days), red (<30 days / expired).
- **Quick-action bar** — `📞 Log Call`, `✉ Log Email`, `📋 New Task` icon buttons, pre-filled with selected client.

**Properties:**
- **Incident count chip** — `N incidents` badge per property row (last 30 days). `GET /crm/properties/incident-counts` returns `{property_id, count_30d}[]`.
- **Risk level field** — `risk_level` (low/medium/high/critical) on property edit form, shown as colored dot on list.

**DB changes:** Add `risk_level TEXT` to `properties`.

---

## Section 4 — Proposals (Deep Treatment)

**Goal:** Make proposals a complete workflow from draft to signed.

**Changes:**
- **PDF generation** — "Export PDF" button generates professional bid document via jsPDF. New utility: `client/src/utils/proposalPdf.ts`. Layout: RMPG logo, client block, scope table, pricing, terms, signature line.
- **Email send** — `POST /crm/proposals/:id/send` logs activity, advances stage to `sent`, optionally emails PDF if SMTP configured. Degrades gracefully without SMTP.
- **Version history** — every edit saves snapshot to `crm_proposal_versions` (id, proposal_id, version_num, snapshot JSON, edited_by, edited_at). "History" tab in detail panel.
- **Stage timeline** — horizontal stepper (draft→sent→viewed→accepted) with timestamps per transition from activity log.
- **Expiry countdown** — `valid_until` date shown as `Expires in N days` chip (amber <14 days, red expired).

**DB changes:**
- New `crm_proposal_versions` table.
- Add `stage_entered_at TEXT` (JSON map of stage→ISO timestamp) to `proposals`.

---

## Section 5 — Invoices

**Goal:** Surface aging, enable recurring billing, and close the payment loop.

**Changes:**
- **Aging dashboard** — 5-bucket summary bar: Current · 1–30 · 31–60 · 61–90 · 90+ days. Dollar amount + count per bucket, clickable to filter list. Client-side computation.
- **Recurring billing flag** — `is_recurring` + `recurrence_interval` (monthly/quarterly/annually) on invoice form. Dashboard load checks `/crm/invoices/due-recurring` and surfaces "Generate Next" prompt. Human-in-the-loop — no auto-creation.
- **Payment recording** — "Record Payment" modal: amount, date, method, reference. Stored in `crm_payments`. Invoice auto-transitions to `paid` when total payments ≥ amount.
- **Overdue escalation** — `OVERDUE N days` badge. At 60+ days: `⚠ ESCALATE` action logs activity + creates follow-up task.

**DB changes:**
- Add `is_recurring BOOLEAN`, `recurrence_interval TEXT`, `recurrence_anchor TEXT` to `invoices`.
- New `crm_payments` table (id, invoice_id, amount, paid_at, method, reference, recorded_by).

---

## Section 6 — Tasks

**Goal:** Make tasks actionable at a glance and close the contract renewal loop automatically.

**Changes:**
- **Due-date grouping** — three collapsible groups: Overdue (red) · Due This Week (amber) · Upcoming. Sorted by priority within each. Client-side only.
- **Quick-complete** — one-click checkmark on each row fires `PUT /crm/tasks/:id { status: 'completed' }`.
- **Dashboard surface** — overdue/today tasks create a notification dot on Tasks sidebar item.
- **Auto-task from contract renewal** — dashboard load logic creates `contract_renewal` tasks when client `contract_end` is 90/60/30 days out. Deduplicates. Tracked via `auto_created_by TEXT` column.
- **Task-to-activity link** — on complete, optional "Log completion note?" prompt creates client activity entry.

**DB changes:** Add `auto_created_by TEXT` to `crm_tasks`.

---

## Section 7 — Reports

**Goal:** Replace raw data displays with usable visualizations and add export.

**Changes:**
- **Revenue by client** — inline SVG bar chart, top 10 clients by invoiced MTD/YTD. Extend `/crm/reports/revenue` to return per-client rows.
- **Pipeline funnel** — vertical SVG funnel with stage conversion rates (e.g. "qualified→proposal: 68%"). From existing `/crm/leads/pipeline-summary`.
- **Lead source ROI table** — clean table: source, leads, conversion rate, avg deal size, total closed value.
- **Retention health** — client list sorted by at-risk score (expiring contract + low recent activity). Color-coded rows.
- **CSV export** — "Export" button on each report using existing `ExportButton` component pattern.

**DB changes:** Query change to `/crm/reports/revenue` only (no schema change).

---

## DB Migration Summary

| Table | Change |
|-------|--------|
| `crm_leads` | Add `lead_score INTEGER` |
| `properties` | Add `risk_level TEXT` |
| `crm_proposal_versions` | **New table** |
| `proposals` | Add `stage_entered_at TEXT` |
| `invoices` | Add `is_recurring`, `recurrence_interval`, `recurrence_anchor` |
| `crm_payments` | **New table** |
| `crm_tasks` | Add `auto_created_by TEXT` |

---

## New API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/crm/reports/revenue-trend` | 6-month invoiced vs. paid by month |
| `GET` | `/crm/clients/:id/incidents` | CAD incidents for client's properties |
| `GET` | `/crm/properties/incident-counts` | 30-day incident counts per property |
| `POST` | `/crm/proposals/:id/send` | Mark sent, log activity, optional email |
| `GET` | `/crm/invoices/due-recurring` | Recurring invoices due for regeneration |
| `POST` | `/crm/invoices/:id/payments` | Record payment against invoice |

---

## Files to Create/Modify

**New:**
- `client/src/utils/proposalPdf.ts` — jsPDF proposal generator

**Modified (client):**
- `client/src/pages/CrmPage.tsx` — dashboard, clients, properties, invoices, tasks sections
- `client/src/components/crm/LeadsTab.tsx` — scoring badge, quick-convert, stale alert, pipeline total
- `client/src/components/crm/ProposalsTab.tsx` — PDF button, send button, version history, stage timeline, expiry
- `client/src/components/crm/ReportsTab.tsx` — SVG charts, CSV export

**Modified (server):**
- `server/src/routes/crm.ts` — dashboard auto-tasks, new endpoints
- `server/src/routes/crmLeads.ts` — lead scoring on save
- `server/src/routes/crmProposals.ts` — send endpoint, version snapshot on save
- `server/src/models/database.ts` — all schema migrations
