# Legal Leads Scraper Design — Debt Collection & Civil Suit Attorneys

**Date:** 2026-03-14
**Status:** Approved
**Goal:** Generate CRM leads from Utah legal/law websites for RMPG's process serving, repo security, and skip tracing services.

## Business Context

RMPG provides three services to debt collection firms and civil litigation attorneys:
1. **Process serving** — court papers, subpoenas, collection notices
2. **Repo/eviction security** — officer presence during enforcement actions
3. **Skip tracing / asset recovery** — locating defendants

## Data Sources (Priority Order)

| # | Source Key | Source | URL | Poll Interval | Complexity |
|---|-----------|--------|-----|---------------|------------|
| 1 | `utah_bar` | Utah State Bar Directory | services.utahbar.org | Daily (86400s) | Medium (HTML) |
| 2 | `ut_commerce_collections` | UT Division of Commerce | commerce.utah.gov | Daily (86400s) | Medium (API/HTML) |
| 3 | `ut_consumer_protection` | UT Consumer Protection | dcp.utah.gov | Daily (86400s) | Low |
| 4 | `ut_courts` | Utah Courts XCHANGE | xchange.utcourts.gov | 12hr (43200s) | High (session) |

## Schema Changes

### New column on `crm_leads`
```sql
ALTER TABLE crm_leads ADD COLUMN service_interest TEXT;
-- Comma-separated: 'process_serving', 'repo_security', 'skip_tracing'
```

### New scrape source seeds
```sql
INSERT OR IGNORE INTO lead_scrape_sources (source_key, display_name, base_url, poll_interval_seconds)
VALUES
  ('utah_bar', 'Utah State Bar Directory', 'https://services.utahbar.org', 86400),
  ('ut_commerce_collections', 'UT Div of Commerce - Collections', 'https://commerce.utah.gov', 86400),
  ('ut_consumer_protection', 'UT Consumer Protection', 'https://dcp.utah.gov', 86400),
  ('ut_courts', 'Utah Courts XCHANGE', 'https://xchange.utcourts.gov', 43200);
```

### LeadSource type expansion
```typescript
export type LeadSource = 'utah_biz' | 'construction_permit' | 'commercial_re' | 'liquor_license'
  | 'utah_bar' | 'ut_courts' | 'ut_commerce_collections' | 'ut_consumer_protection' | 'manual';
```

## Scraper Designs

### 1. Utah State Bar (`utahBarScraper.ts`)

- **Search** by practice areas: Collections, Civil Litigation, Bankruptcy, Creditor's Rights, Real Estate
- **Parse** attorney listings (HTML) → fetch detail pages for contact info
- **Dedup** on `source_id` = bar number
- **Service tagging:** Collections/Creditor's Rights → process_serving,skip_tracing; Civil Litigation → process_serving; Real Estate → repo_security
- **Rate limit:** 2s between requests

| Bar Field | CrmLead Field |
|-----------|---------------|
| Attorney Name | `contact_name` |
| Firm Name | `business_name` |
| Bar Number | `source_id` |
| Phone | `contact_phone` |
| Email | `contact_email` |
| Address/City/State/Zip | address fields |
| Practice Areas | `industry` |
| Profile URL | `source_url` |

### 2. Division of Commerce (`utCommerceCollectionsScraper.ts`)

- **Search** licensed collection agencies (license type filter)
- **Parse** business records (HTML/JSON)
- **Dedup** on `source_id` = license number
- **Service tagging:** All → process_serving,skip_tracing,repo_security
- **Filter:** Only "Active" license status
- **Rate limit:** 1.5s between requests

### 3. Consumer Protection (`utConsumerProtectionScraper.ts`)

- **Search** registered debt collection businesses
- **Parse** similar to Commerce scraper
- **Dedup** on `source_id` = registration number
- **Service tagging:** All → process_serving,skip_tracing
- **Rate limit:** 1.5s between requests

### 4. Utah Courts XCHANGE (`utCourtsScraper.ts`)

- **Search** recent civil filings: Debt Collection, Eviction, Small Claims, Civil
- **Extract** the filing attorney/firm (not defendants)
- **Aggregate** case count per attorney/firm (busiest filers = best leads)
- **Dedup** on `source_id` = bar number or SHA-256(firm_name + city)
- **Service tagging:** Debt Collection → process_serving,skip_tracing; Eviction → repo_security,process_serving
- **Extra config:** `{ "days_back": 30, "min_cases": 3 }`
- **Rate limit:** 3s between requests

## Lead Score Boost

In `calculateLeadScore()`:
- `service_interest` is set → +15 points
- Source is `utah_bar` or `ut_courts` → +10 points
- Practice area includes "collection" or "civil litigation" → +10 points

## Error Handling

- Circuit breaker: 5 consecutive failures → auto-disable (existing pattern)
- Per-record try/catch: individual failures don't kill the run
- Status: `error` (zero imports + fatal), `partial` (some imports + errors), `success` (imports, no fatal)

## Rate Limiting

| Source | Delay Between Requests |
|--------|----------------------|
| Utah Bar | 2,000ms |
| Div of Commerce | 1,500ms |
| Consumer Protection | 1,500ms |
| Courts XCHANGE | 3,000ms |

## Files to Create/Modify

| Action | File |
|--------|------|
| CREATE | `server/src/utils/utahBarScraper.ts` |
| CREATE | `server/src/utils/utCommerceCollectionsScraper.ts` |
| CREATE | `server/src/utils/utConsumerProtectionScraper.ts` |
| CREATE | `server/src/utils/utCourtsScraper.ts` |
| MODIFY | `server/src/models/database.ts` — add column + seed sources |
| MODIFY | `server/src/routes/crmLeads.ts` — import new scrapers |
| MODIFY | `server/src/utils/leadScraperBase.ts` — scoring boost |
| MODIFY | `client/src/types/index.ts` — expand LeadSource |
| MODIFY | `client/src/components/crm/LeadsTab.tsx` — source filter + service interest filter |

## Future Sources (Easy to Add Later)

The scraper architecture is plug-and-play. Future sources to consider:
- Federal PACER (federal civil filings)
- Utah Judiciary public records
- County recorder (liens, judgments)
- Better Business Bureau complaints
- State licensing boards (property management, real estate)
- National skip tracing databases
