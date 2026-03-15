# Legal Leads Scraper Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build 4 new lead scrapers that pull debt collection firms and civil litigation attorneys from Utah legal/law websites into the Overwatch CRM pipeline.

**Architecture:** Each scraper follows the existing `leadScraperBase.ts` pattern — a standalone file that registers itself via `registerScraper()`, fetches/parses a public data source, and upserts leads with `INSERT OR IGNORE` dedup. A new `service_interest` column tags leads with the RMPG services they'd need (process serving, repo security, skip tracing).

**Tech Stack:** TypeScript, better-sqlite3, node-fetch (via `fetchWithTimeout`), HTML regex parsing, existing `leadScraperBase.ts` framework.

---

## Task 1: Schema — Add `service_interest` Column & Seed Sources

**Files:**
- Modify: `server/src/models/database.ts` (lines 4248-4256 for seeds)
- Modify: `server/src/utils/leadScraperBase.ts` (lines 35-60 for LeadUpsertData, lines 167-175 for INSERT)

**Step 1: Add migration column in `database.ts`**

Find the `addCol` calls for `crm_leads` and add after the last one:

```typescript
addCol('crm_leads', 'service_interest', 'TEXT');
```

**Step 2: Seed 4 new scrape sources in `database.ts`**

After line 4256 (the `dabc_liquor` seed), add:

```typescript
insertScrapeSource.run('utah_bar', 'Utah State Bar Directory', 'https://services.utahbar.org', 86400);
insertScrapeSource.run('ut_commerce_collections', 'UT Div of Commerce - Collections', 'https://commerce.utah.gov', 86400);
insertScrapeSource.run('ut_consumer_protection', 'UT Consumer Protection', 'https://dcp.utah.gov', 86400);
insertScrapeSource.run('ut_courts', 'Utah Courts XCHANGE', 'https://xchange.utcourts.gov', 43200);
```

**Step 3: Add `service_interest` to `LeadUpsertData` in `leadScraperBase.ts`**

Add to the interface (after line 59 `notes?: string;`):

```typescript
service_interest?: string;
```

**Step 4: Add `service_interest` to the INSERT in `upsertLead()`**

Update the INSERT statement (lines 167-175) to include `service_interest` in columns and a `?` in VALUES. Add `data.service_interest || null` to the `.run()` params (after `data.notes || null` on line 200).

**Step 5: Build to verify**

Run: `cd server && npx tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```
feat: add service_interest column and legal lead scrape sources
```

---

## Task 2: Lead Score Boost for Legal/Collections Leads

**Files:**
- Modify: `server/src/utils/leadScraperBase.ts` (lines 123-157 `calculateLeadScore`)

**Step 1: Add legal/collections scoring boost**

After the "Contact info completeness" block (line 154), add before `return`:

```typescript
// Legal / collections lead boost
const si = (lead.service_interest || '').toLowerCase();
if (si) score += 15; // Has identified service interest

const src = (lead.source || '').toLowerCase();
if (src === 'utah_bar' || src === 'ut_courts') score += 10;

const ind = (lead.industry || '').toLowerCase();
if (/collection|civil.?lit|debt|creditor|bankrupt|eviction/.test(ind)) score += 10;
```

**Step 2: Build to verify**

Run: `cd server && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```
feat: boost lead score for legal/collections sources
```

---

## Task 3: Utah State Bar Scraper

**Files:**
- Create: `server/src/utils/utahBarScraper.ts`
- Modify: `server/src/routes/crmLeads.ts` (line 20, add import)

**Step 1: Create `server/src/utils/utahBarScraper.ts`**

```typescript
/**
 * Utah State Bar Directory Scraper
 *
 * Scrapes the Utah State Bar member directory for attorneys practicing in
 * debt collection, civil litigation, bankruptcy, and creditor's rights.
 * These attorneys are leads for RMPG's process serving, repo security,
 * and skip tracing services.
 */
import {
  fetchWithTimeout, sleep, upsertLead, registerScraper,
  getSourceConfig, type ScrapeResult,
} from './leadScraperBase';

const SOURCE_KEY = 'utah_bar';
const BASE_URL = 'https://services.utahbar.org';
const REQUEST_DELAY_MS = 2_000;

// Practice areas that map to RMPG services
const PRACTICE_AREAS = [
  { query: 'Collections', service: 'process_serving,skip_tracing' },
  { query: 'Civil Litigation', service: 'process_serving' },
  { query: 'Bankruptcy', service: 'process_serving' },
  { query: 'Creditors Rights', service: 'process_serving,skip_tracing' },
  { query: 'Real Estate', service: 'repo_security' },
];

interface BarAttorney {
  barNumber: string;
  name: string;
  firm: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  practiceAreas: string;
  profileUrl: string;
  serviceInterest: string;
}

/**
 * Parse attorney listing from search results HTML.
 * The Bar directory typically returns a table or card list of members.
 */
function parseAttorneyList(html: string): Partial<BarAttorney>[] {
  const attorneys: Partial<BarAttorney>[] = [];

  // Match attorney card/row blocks — adapt regex to actual HTML structure
  // Pattern: look for bar number, name, firm, contact info
  const blocks = html.split(/(?=<div[^>]*class="[^"]*member[^"]*"|<tr[^>]*class="[^"]*member)/i);

  for (const block of blocks) {
    const barNum = block.match(/(?:Bar\s*(?:#|No\.?|Number)?:?\s*)(\d{4,8})/i)?.[1];
    if (!barNum) continue;

    // Extract name — typically in a heading or strong tag
    const name = block.match(/<(?:h[2-4]|strong|a)[^>]*>([^<]+)<\/(?:h[2-4]|strong|a)>/i)?.[1]?.trim();
    if (!name) continue;

    // Extract firm
    const firm = block.match(/(?:Firm|Company|Organization)[:\s]*([^<\n]+)/i)?.[1]?.trim()
      || block.match(/<(?:span|div)[^>]*class="[^"]*firm[^"]*"[^>]*>([^<]+)/i)?.[1]?.trim();

    // Extract contact info
    const phone = block.match(/(?:Phone|Tel)[:\s]*([\d\-\(\)\.\s]{10,})/i)?.[1]?.trim()
      || block.match(/(\(\d{3}\)\s*\d{3}[\-\.]\d{4})/)?.[1]?.trim();
    const email = block.match(/([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/)?.[1]?.trim();

    // Extract address
    const addrMatch = block.match(/(?:Address)[:\s]*([^<\n]+)/i);
    const cityMatch = block.match(/(?:City)[:\s]*([^<\n,]+)/i);
    const stateMatch = block.match(/\b(UT|Utah)\b/i);
    const zipMatch = block.match(/\b(\d{5}(?:-\d{4})?)\b/);

    attorneys.push({
      barNumber: barNum,
      name: stripHtmlEntities(name),
      firm: firm ? stripHtmlEntities(firm) : undefined,
      phone: phone || undefined,
      email: email || undefined,
      address: addrMatch?.[1]?.trim() || undefined,
      city: cityMatch?.[1]?.trim() || undefined,
      state: stateMatch?.[1] || 'UT',
      zip: zipMatch?.[1] || undefined,
    });
  }

  return attorneys;
}

function stripHtmlEntities(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#?\w+;/g, ' ').trim();
}

export async function scrapeUtahBar(): Promise<ScrapeResult> {
  const startTime = Date.now();
  let totalFound = 0, totalImported = 0, totalSkipped = 0;
  let lastError: string | undefined;
  const seen = new Set<string>(); // track bar numbers across practice areas

  const config = getSourceConfig(SOURCE_KEY);
  const extraConfig = config?.extra_config ? JSON.parse(config.extra_config) : {};
  const practiceAreas = extraConfig.practice_areas || PRACTICE_AREAS;

  try {
    for (const area of practiceAreas) {
      try {
        console.log(`[UtahBar] Searching practice area: ${area.query}`);
        await sleep(REQUEST_DELAY_MS);

        // Search the member directory by practice area
        const searchUrl = `${BASE_URL}/Member-Directory?PracticeArea=${encodeURIComponent(area.query)}`;
        const res = await fetchWithTimeout(searchUrl);
        if (!res.ok) {
          console.warn(`[UtahBar] HTTP ${res.status} for ${area.query}`);
          continue;
        }

        const html = await res.text();
        const attorneys = parseAttorneyList(html);
        console.log(`[UtahBar] Found ${attorneys.length} attorneys for ${area.query}`);
        totalFound += attorneys.length;

        for (const atty of attorneys) {
          if (!atty.barNumber || seen.has(atty.barNumber)) {
            totalSkipped++;
            continue;
          }
          seen.add(atty.barNumber);

          try {
            const result = upsertLead({
              source: SOURCE_KEY,
              source_id: atty.barNumber,
              source_url: atty.profileUrl || `${BASE_URL}/Member-Directory?BarNumber=${atty.barNumber}`,
              business_name: atty.firm || atty.name || 'Unknown',
              contact_name: atty.name,
              contact_email: atty.email,
              contact_phone: atty.phone,
              address: atty.address,
              city: atty.city,
              state: atty.state || 'UT',
              zip: atty.zip,
              industry: area.query,
              business_type: 'Law Firm',
              service_interest: area.service,
            });

            if (result.inserted) totalImported++;
            else totalSkipped++;
          } catch (err: any) {
            totalSkipped++;
            console.warn(`[UtahBar] Failed to upsert ${atty.barNumber}: ${err.message}`);
          }
        }
      } catch (err: any) {
        lastError = `${area.query}: ${err.message}`;
        console.error(`[UtahBar] Error scraping ${area.query}: ${err.message}`);
      }
    }
  } catch (err: any) {
    lastError = err.message;
    console.error(`[UtahBar] Fatal error: ${err.message}`);
  }

  const durationMs = Date.now() - startTime;
  const status = lastError && totalImported === 0 ? 'error' : totalImported > 0 ? 'success' : 'partial';

  console.log(`[UtahBar] Complete: found=${totalFound} imported=${totalImported} skipped=${totalSkipped} (${durationMs}ms)`);

  return {
    source_key: SOURCE_KEY,
    status,
    records_found: totalFound,
    records_imported: totalImported,
    records_skipped: totalSkipped,
    error_message: lastError,
    duration_ms: durationMs,
  };
}

registerScraper(SOURCE_KEY, scrapeUtahBar);
```

**Step 2: Import in `crmLeads.ts`**

After line 20 (`import '../utils/commercialReScraper';`), add:

```typescript
import '../utils/utahBarScraper';
```

**Step 3: Build to verify**

Run: `cd server && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```
feat: add Utah State Bar attorney lead scraper
```

---

## Task 4: Division of Commerce Collections Scraper

**Files:**
- Create: `server/src/utils/utCommerceCollectionsScraper.ts`
- Modify: `server/src/routes/crmLeads.ts` (add import)

**Step 1: Create `server/src/utils/utCommerceCollectionsScraper.ts`**

```typescript
/**
 * Utah Division of Commerce — Collection Agency Scraper
 *
 * Scrapes the Utah Division of Commerce for licensed collection agencies.
 * These are direct targets for RMPG's process serving, repo security,
 * and skip tracing services.
 */
import {
  fetchWithTimeout, sleep, upsertLead, registerScraper,
  getSourceConfig, type ScrapeResult,
} from './leadScraperBase';

const SOURCE_KEY = 'ut_commerce_collections';
const BASE_URL = 'https://commerce.utah.gov';
const REQUEST_DELAY_MS = 1_500;

interface CommerceLicense {
  licenseNumber: string;
  businessName: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  licenseStatus: string;
  registrationDate: string;
  detailUrl: string;
}

/**
 * Parse collection agency listings from search results.
 */
function parseLicenseResults(html: string): CommerceLicense[] {
  const results: CommerceLicense[] = [];

  // Split into individual license blocks
  const blocks = html.split(/(?=<(?:tr|div)[^>]*(?:license|result|row))/i);

  for (const block of blocks) {
    // Extract license number
    const licNum = block.match(/(?:License|Lic|Registration)\s*(?:#|No\.?|Number)?[:\s]*([A-Z0-9\-]{3,20})/i)?.[1];
    if (!licNum) continue;

    // Only process active licenses
    const status = block.match(/(?:Status)[:\s]*([A-Za-z]+)/i)?.[1]?.toLowerCase() || '';
    if (status && status !== 'active' && status !== 'current') continue;

    const name = block.match(/<(?:td|span|a|strong)[^>]*>([^<]{3,80})<\/(?:td|span|a|strong)>/i)?.[1]?.trim();
    if (!name) continue;

    const contact = block.match(/(?:Contact|Agent|Owner)[:\s]*([^<\n]{2,60})/i)?.[1]?.trim();
    const phone = block.match(/(\(\d{3}\)\s*\d{3}[\-\.]\d{4}|\d{3}[\-\.]\d{3}[\-\.]\d{4})/)?.[1];
    const email = block.match(/([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/)?.[1];
    const addr = block.match(/(?:Address)[:\s]*([^<\n]{5,80})/i)?.[1]?.trim();
    const city = block.match(/(?:City)[:\s]*([^<\n,]{2,40})/i)?.[1]?.trim();
    const zip = block.match(/\b(\d{5}(?:-\d{4})?)\b/)?.[1];
    const regDate = block.match(/(?:Issued|Registered|Date)[:\s]*([\d\/\-]{8,10})/i)?.[1];
    const detailHref = block.match(/href="([^"]*license[^"]*)"/i)?.[1];

    results.push({
      licenseNumber: licNum,
      businessName: name.replace(/&amp;/g, '&').trim(),
      contactName: contact || '',
      phone: phone || '',
      email: email || '',
      address: addr || '',
      city: city || '',
      state: 'UT',
      zip: zip || '',
      licenseStatus: 'active',
      registrationDate: regDate ? normalizeDate(regDate) : '',
      detailUrl: detailHref ? (detailHref.startsWith('http') ? detailHref : `${BASE_URL}${detailHref}`) : '',
    });
  }

  return results;
}

function normalizeDate(d: string): string {
  // Convert MM/DD/YYYY → YYYY-MM-DD
  const m = d.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return d;
}

export async function scrapeUtCommerceCollections(): Promise<ScrapeResult> {
  const startTime = Date.now();
  let totalFound = 0, totalImported = 0, totalSkipped = 0;
  let lastError: string | undefined;

  const config = getSourceConfig(SOURCE_KEY);
  const extraConfig = config?.extra_config ? JSON.parse(config.extra_config) : {};

  try {
    // Search for collection agency licenses
    const searchTerms = extraConfig.search_terms || ['collection agency', 'debt collector', 'collection bureau'];

    for (const term of searchTerms) {
      await sleep(REQUEST_DELAY_MS);
      console.log(`[UtCommerce] Searching: ${term}`);

      const searchUrl = `${BASE_URL}/search?q=${encodeURIComponent(term)}&type=license&division=dfi`;
      const res = await fetchWithTimeout(searchUrl);

      if (!res.ok) {
        console.warn(`[UtCommerce] HTTP ${res.status} for "${term}"`);
        continue;
      }

      const html = await res.text();
      const licenses = parseLicenseResults(html);
      console.log(`[UtCommerce] Found ${licenses.length} active licenses for "${term}"`);
      totalFound += licenses.length;

      for (const lic of licenses) {
        try {
          const result = upsertLead({
            source: SOURCE_KEY,
            source_id: lic.licenseNumber,
            source_url: lic.detailUrl || undefined,
            business_name: lic.businessName,
            contact_name: lic.contactName || undefined,
            contact_email: lic.email || undefined,
            contact_phone: lic.phone || undefined,
            address: lic.address || undefined,
            city: lic.city || undefined,
            state: 'UT',
            zip: lic.zip || undefined,
            license_number: lic.licenseNumber,
            registration_date: lic.registrationDate || undefined,
            industry: 'Debt Collection',
            business_type: 'Collection Agency',
            service_interest: 'process_serving,skip_tracing,repo_security',
          });

          if (result.inserted) totalImported++;
          else totalSkipped++;
        } catch (err: any) {
          totalSkipped++;
          console.warn(`[UtCommerce] Failed to upsert ${lic.licenseNumber}: ${err.message}`);
        }
      }
    }
  } catch (err: any) {
    lastError = err.message;
    console.error(`[UtCommerce] Fatal error: ${err.message}`);
  }

  const durationMs = Date.now() - startTime;
  const status = lastError && totalImported === 0 ? 'error' : totalImported > 0 ? 'success' : 'partial';

  console.log(`[UtCommerce] Complete: found=${totalFound} imported=${totalImported} skipped=${totalSkipped} (${durationMs}ms)`);

  return {
    source_key: SOURCE_KEY,
    status,
    records_found: totalFound,
    records_imported: totalImported,
    records_skipped: totalSkipped,
    error_message: lastError,
    duration_ms: durationMs,
  };
}

registerScraper(SOURCE_KEY, scrapeUtCommerceCollections);
```

**Step 2: Import in `crmLeads.ts`**

```typescript
import '../utils/utCommerceCollectionsScraper';
```

**Step 3: Build to verify**

Run: `cd server && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```
feat: add UT Division of Commerce collection agency scraper
```

---

## Task 5: Consumer Protection Scraper

**Files:**
- Create: `server/src/utils/utConsumerProtectionScraper.ts`
- Modify: `server/src/routes/crmLeads.ts` (add import)

**Step 1: Create `server/src/utils/utConsumerProtectionScraper.ts`**

Same pattern as Commerce scraper but targets the Division of Consumer Protection registered businesses in the debt collection category. Uses `SOURCE_KEY = 'ut_consumer_protection'`, searches `dcp.utah.gov` for registered debt collectors. Tags `service_interest = 'process_serving,skip_tracing'`. Dedup on registration number.

Follow the exact structure of `utCommerceCollectionsScraper.ts` but with:
- `SOURCE_KEY = 'ut_consumer_protection'`
- `BASE_URL = 'https://dcp.utah.gov'`
- Search terms: `['debt collection', 'collection service']`
- `industry = 'Consumer Debt Collection'`
- `business_type = 'Registered Debt Collector'`

**Step 2: Import in `crmLeads.ts`**

```typescript
import '../utils/utConsumerProtectionScraper';
```

**Step 3: Build to verify**

Run: `cd server && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```
feat: add UT Consumer Protection debt collector scraper
```

---

## Task 6: Utah Courts XCHANGE Scraper

**Files:**
- Create: `server/src/utils/utCourtsScraper.ts`
- Modify: `server/src/routes/crmLeads.ts` (add import)

**Step 1: Create `server/src/utils/utCourtsScraper.ts`**

This is the most complex scraper. Key differences from others:

- Searches recent civil filings (Debt Collection, Eviction, Small Claims)
- Extracts the **filing attorney/firm** from each case (not the defendant)
- **Aggregates** case count per attorney to find busiest filers
- Only imports attorneys/firms with `min_cases` (default 3) filings in `days_back` (default 30)
- Uses `estimated_value` as a proxy for case volume (more filings = more work potential)
- Dedup on bar number when available, otherwise SHA-256 hash of `firm_name + city`

Structure:
```typescript
const SOURCE_KEY = 'ut_courts';
const BASE_URL = 'https://xchange.utcourts.gov';
const REQUEST_DELAY_MS = 3_000;

const CASE_TYPES = [
  { type: 'Debt Collection', service: 'process_serving,skip_tracing' },
  { type: 'Eviction', service: 'repo_security,process_serving' },
  { type: 'Small Claims', service: 'process_serving' },
  { type: 'Civil', service: 'process_serving' },
];
```

The scraper should:
1. Build a `Map<string, { name, firm, cases, caseTypes, service }>` to aggregate
2. After scraping all case types, filter to those with >= `min_cases`
3. Upsert each qualifying attorney/firm as a lead

**Step 2: Import in `crmLeads.ts`**

```typescript
import '../utils/utCourtsScraper';
```

**Step 3: Build to verify**

Run: `cd server && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```
feat: add Utah Courts XCHANGE civil filing scraper
```

---

## Task 7: Update Client Types & LeadsTab Filter

**Files:**
- Modify: `client/src/types/index.ts` (line 2197)
- Modify: `client/src/components/crm/LeadsTab.tsx` (lines 365-370)

**Step 1: Expand `LeadSource` type**

In `client/src/types/index.ts` line 2197, replace:

```typescript
export type LeadSource = 'utah_biz' | 'construction_permit' | 'commercial_re' | 'liquor_license' | 'manual';
```

With:

```typescript
export type LeadSource = 'utah_biz' | 'construction_permit' | 'commercial_re' | 'liquor_license'
  | 'utah_bar' | 'ut_courts' | 'ut_commerce_collections' | 'ut_consumer_protection' | 'manual';
```

**Step 2: Add `service_interest` to `CrmLead` interface**

Find the `CrmLead` interface and add after `notes?`:

```typescript
service_interest?: string;
```

**Step 3: Add new sources to LeadsTab filter dropdown**

In `client/src/components/crm/LeadsTab.tsx`, after line 369 (`<option value="liquor_license">DABC Liquor</option>`), add:

```tsx
<option value="utah_bar">Utah Bar Attorneys</option>
<option value="ut_commerce_collections">UT Commerce Collections</option>
<option value="ut_consumer_protection">UT Consumer Protection</option>
<option value="ut_courts">Utah Courts Filings</option>
```

**Step 4: Add service interest filter after the source dropdown**

After the source `</select>` (line 371), add a new dropdown:

```tsx
<select
  value={filterService}
  onChange={e => setFilterService(e.target.value)}
  className="bg-[#0d1520] border border-rmpg-700 text-white text-xs px-2 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none"
>
  <option value="">All Services</option>
  <option value="process_serving">Process Serving</option>
  <option value="repo_security">Repo Security</option>
  <option value="skip_tracing">Skip Tracing</option>
</select>
```

Add `filterService` state variable near line 136:

```typescript
const [filterService, setFilterService] = useState<string>('');
```

Add to the `fetchLeads` params (near line 166):

```typescript
if (filterService) params.set('service_interest', filterService);
```

Add `filterService` to the `useCallback` dependency array on line 178.

**Step 5: Update server route to accept service_interest filter**

In `server/src/routes/crmLeads.ts`, in the GET `/leads` handler, add after the existing filters:

```typescript
if (req.query.service_interest) {
  sql += ' AND l.service_interest LIKE ?';
  params.push(`%${req.query.service_interest}%`);
}
```

**Step 6: Build both client and server**

Run: `cd client && npx vite build && cd ../server && npx tsc --noEmit`
Expected: No errors

**Step 7: Commit**

```
feat: add legal lead source filters and service interest to LeadsTab
```

---

## Task 8: Deploy & Verify

**Step 1: Deploy to production**

Run: `bash deploy/deploy.sh`
Expected: Deploy successful, server running

**Step 2: Verify new sources appear in Scraper Admin**

Navigate to Overwatch → Leads → Scraper Admin Panel. All 4 new sources should appear (disabled by default).

**Step 3: Enable and test one scraper**

Enable "Utah State Bar Directory" and click "Poll Now". Check scrape log for results.

**Step 4: Commit final state**

```
deploy: legal leads scrapers live
```

---

## Execution Order Summary

| Task | What | Files | Est. Time |
|------|------|-------|-----------|
| 1 | Schema + seeds | database.ts, leadScraperBase.ts | 5 min |
| 2 | Lead score boost | leadScraperBase.ts | 3 min |
| 3 | Utah Bar scraper | NEW utahBarScraper.ts, crmLeads.ts | 10 min |
| 4 | Commerce scraper | NEW utCommerceCollectionsScraper.ts, crmLeads.ts | 8 min |
| 5 | Consumer Protection scraper | NEW utConsumerProtectionScraper.ts, crmLeads.ts | 5 min |
| 6 | Courts XCHANGE scraper | NEW utCourtsScraper.ts, crmLeads.ts | 12 min |
| 7 | Client types + UI filters | types/index.ts, LeadsTab.tsx, crmLeads.ts route | 8 min |
| 8 | Deploy & verify | deploy.sh | 5 min |
