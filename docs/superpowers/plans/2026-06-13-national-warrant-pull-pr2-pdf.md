# National Warrant Pull — PR2 (PDF Wave) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add PDF warrant-list ingestion to the national-warrant framework — `unpdf` text extraction + a PDF adapter family + header-driven parsers (Zuercher, TX-municipal, Newton GA) + batched ingest that lifts the per-source cap and re-enables Baton Rouge.

**Architecture:** A `pdf` adapter family in the config registry fetches a PDF, extracts text via `unpdf` (Workers-compatible pdf.js), and dispatches to a per-layout parser keyed by `family`. A new batched store (`bulkUpsertScrapedWarrants`) replaces the per-hit upsert in the full-list leg so large rosters fit the cron budget.

**Tech Stack:** Cloudflare Workers, D1, `unpdf` (serverless pdf.js text extraction), Hono, vitest. Builds on PR1's `warrantSources/` framework (dual-mode adapters, config registry, normalize, full-list leg).

**Spec:** [`docs/superpowers/specs/2026-06-13-national-warrant-pull-design.md`](../specs/2026-06-13-national-warrant-pull-design.md) §4 (PDF sources), §5.3 (PDF parsing), §12 (PR2). **PR1 plan:** [`2026-06-13-national-warrant-pull-pr1.md`](2026-06-13-national-warrant-pull-pr1.md).

**Prereq:** PR1 (framework) merged or on this branch's base. This plan assumes `src/utils/warrantSources/{types,normalize,configRegistry,registry,runScan,store}.ts` from PR1 exist.

**Scope note:** PR2 = PDF infra + **3 parser families** (Zuercher [McKenzie ND/Codington SD/Tuscarawas OH/Harrison OH], TX-muni [Killeen/Bell Mead/Taylor TX], Newton GA) + batched ingest + Baton Rouge re-enable. The remaining bespoke PDF layouts (Kootenai ID block, PSIMS Hancock IL, Kanawha WV, St. Louis MN) are a same-pattern follow-on (PR2b): each is "capture fixture → write parser → add config row," no new infrastructure.

---

## Confirmed facts (verified)
- Next migration prefix: **0109** (0108 = case_management_v2).
- No PDF dependency yet (`unpdf` to be added to the root `package.json`).
- `store.ts` exports `upsertScrapedWarrant(db, hit, personId)` (SELECT-then-upsert, no UNIQUE index assumed) + `markScrapedCleared(db, sourceKey, runStartedAt)`. `executeBatch(db, [{sql,bindings}])` is in `src/utils/db.ts`.
- PR1: `RawWarrantHit` (types.ts), `cleanName/normalizeDate/normalizeBond/displayName` (normalize.ts), `getConfigAdapters`/`makeAdapter` (configRegistry.ts) currently handle families `socrata`/`arcgis` and `return null` for others, `runFullListLeg(db, adapters)` (runScan.ts) with a `MAX_FULL_LIST_HITS=5000` cap and per-hit `upsertScrapedWarrant`, `national_warrant_sources` config table (mig 0107).
- Documented PDF layouts (from the verified discovery sweep — the implementer will capture REAL `unpdf` text as fixtures, these are the column guides):
  - **Zuercher/CentralSquare** (`Printed on <Month DD, YYYY>` header): McKenzie ND cols `Date Issued | Warrant Number | OCA # | Last, First Name | Charges | Bond | Extradition | Status`; Codington SD cols `Last, First Name | Charges | Bond | Date Issued`. **Column set varies per county → parse by detecting the header row.**
  - **TX-municipal/CivicPlus** (4-col): `Defendant Name | Warrant Date | Balance Due | Offense Description` (Killeen); Taylor adds a `Citation No` column.
  - **Newton GA** (myocv): `Defendant's Name | Date of Birth | Warrant Number | Offense | Date Received` — has DOB.

## File Structure
**Create:** `src/utils/warrantSources/pdfText.ts` (unpdf helper), `.../parse/pdfTable.ts` (shared header-driven table parser), `.../parse/pdfZuercher.ts`, `.../parse/pdfTxMuni.ts`, `.../parse/pdfNewton.ts`, `migrations/0109_national_warrant_pdf_sources.sql`, fixtures under `tests/fixtures/warrants/` + tests `tests/warrantPdfText.test.ts`, `tests/warrantBulkStore.test.ts`, `tests/warrantPdfZuercher.test.ts`, `tests/warrantPdfTxMuni.test.ts`, `tests/warrantPdfNewton.test.ts`.
**Modify:** `src/utils/warrantSources/store.ts` (add `bulkUpsertScrapedWarrants`), `.../runScan.ts` (use batched store, raise cap), `.../configRegistry.ts` (pdf family), `package.json` (`unpdf`), `client/public/sw.js` (cache bump).

---

## Task 1: Add `unpdf` + a Worker-safe PDF text helper (HARD GATE — de-risk first)

**Files:** Modify `package.json`; Create `src/utils/warrantSources/pdfText.ts`, `tests/warrantPdfText.test.ts`

- [ ] **Step 1: Add the dependency** — Run: `npm install unpdf` (it provides a serverless/Workers build of pdf.js with no native deps). Confirm it lands in `package.json` dependencies.

- [ ] **Step 2: Implement `src/utils/warrantSources/pdfText.ts`**
```ts
import { extractText, getDocumentProxy } from 'unpdf';

/** Extract the full text layer of a PDF (Workers-compatible via unpdf's serverless pdf.js).
 *  Returns one big string with page texts joined by newlines. Returns '' on any failure. */
export async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });
    return typeof text === 'string' ? text : (Array.isArray(text) ? text.join('\n') : '');
  } catch {
    return '';
  }
}

/** Fetch a PDF URL (browser UA — some county CMS/CivicPlus 403 bots) and extract its text. */
export async function fetchPdfText(url: string): Promise<string> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36', Accept: 'application/pdf,*/*' } });
    if (!res.ok) return '';
    return await extractPdfText(await res.arrayBuffer());
  } catch {
    return '';
  }
}
```

- [ ] **Step 3: Validate unpdf BUNDLES + RUNS in the Worker build (the de-risk).** This is the gate — if unpdf can't bundle/run under wrangler's esbuild for Workers, PR2 is blocked and you must STOP and report BLOCKED (don't write parsers against a dead helper).
  - First a unit smoke: `tests/warrantPdfText.test.ts`:
    ```ts
    import { describe, it, expect } from 'vitest';
    import { extractPdfText } from '../src/utils/warrantSources/pdfText';
    import { readFileSync } from 'node:fs';

    describe('extractPdfText', () => {
      it('returns text from a real PDF buffer', async () => {
        // A tiny known PDF fixture; create tests/fixtures/warrants/sample.pdf by downloading
        // a small public PDF (e.g. the Kanawha WV file, ~44KB) once and committing it, OR
        // generate a 1-page PDF. The assertion is just that SOME text comes back.
        const buf = readFileSync('tests/fixtures/warrants/sample.pdf');
        const text = await extractPdfText(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
        expect(text.length).toBeGreaterThan(0);
      }, 30000);
    });
    ```
    Capture `tests/fixtures/warrants/sample.pdf` by downloading a small public warrant PDF once: `mkdir -p tests/fixtures/warrants && curl -sL 'https://www.kanawhasheriff.us/Documents/WarrantData/Charleston%20-%20Other.pdf' -o tests/fixtures/warrants/sample.pdf` (or any small text-layer PDF). Run `npx vitest run tests/warrantPdfText.test.ts` → expect PASS (text length > 0).
  - Then confirm the WORKER bundle accepts unpdf: run `npm run typecheck`, and `npx wrangler deploy --dry-run --outdir /tmp/nwp-bundle 2>&1 | tail -20` (a dry-run build; it must complete without an esbuild/resolution error for unpdf). If the dry-run build fails specifically due to unpdf (native module, `node:` builtin not polyfilled, etc.), STOP → report BLOCKED with the exact error (PR2 needs a different PDF approach).

- [ ] **Step 4: Commit**
```bash
git add package.json package-lock.json src/utils/warrantSources/pdfText.ts tests/warrantPdfText.test.ts tests/fixtures/warrants/sample.pdf
git commit -m "feat(national-warrants): unpdf PDF text extraction helper (+ Worker bundle validated)"
```

---

## Task 2: Batched store + raise the full-list cap

**Files:** Modify `src/utils/warrantSources/store.ts`, `src/utils/warrantSources/runScan.ts`; Create `tests/warrantBulkStore.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/warrantBulkStore.test.ts`
```ts
import { describe, it, expect } from 'vitest';
import { bulkUpsertScrapedWarrants } from '../src/utils/warrantSources/store';
import type { RawWarrantHit } from '../src/utils/warrantSources/types';

function fakeDb(existingIds: string[] = []) {
  const calls: { sql: string; bindings?: unknown[] }[] = [];
  const DB: any = {
    prepare(sql: string) {
      return { bind: (...b: any[]) => ({
        all: async () => ({ results: existingIds.map((wid) => ({ warrant_id: wid, id: 1 })) }),
        first: async () => null, run: async () => { calls.push({ sql }); return { meta: {} }; },
      }) };
    },
    batch: async (stmts: any[]) => { for (const _ of stmts) calls.push({ sql: 'batch-stmt' }); return stmts.map(() => ({})); },
  };
  return { DB, calls };
}

describe('bulkUpsertScrapedWarrants', () => {
  it('batch-inserts new hits and reports the count', async () => {
    const { DB, calls } = fakeDb([]);
    const hits: RawWarrantHit[] = [
      { source_key: 's', warrant_id: 'a', full_name: 'Doe, A' },
      { source_key: 's', warrant_id: 'b', full_name: 'Roe, B' },
    ];
    const n = await bulkUpsertScrapedWarrants(DB, 's', hits);
    expect(n).toBe(2);
    expect(calls.some((c) => c.sql === 'batch-stmt')).toBe(true);
  });
  it('updates existing warrant_ids rather than duplicating', async () => {
    const { DB } = fakeDb(['a']); // 'a' already exists
    const hits: RawWarrantHit[] = [
      { source_key: 's', warrant_id: 'a', full_name: 'Doe, A' }, // update
      { source_key: 's', warrant_id: 'c', full_name: 'New, C' }, // insert
    ];
    const n = await bulkUpsertScrapedWarrants(DB, 's', hits);
    expect(n).toBe(2); // both processed
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/warrantBulkStore.test.ts` → FAIL.

- [ ] **Step 3: Implement `bulkUpsertScrapedWarrants` in `store.ts`** (preload existing ids for the source → batch INSERT new + batch UPDATE existing; chunks of 100 via `executeBatch`). Read the existing `upsertScrapedWarrant` column list first and MATCH it exactly (same columns/order) so the batch writes are consistent:
```ts
import { query, execute, executeBatch } from '../db';   // ensure executeBatch + query imported

/** Batched upsert of a full source roster into scraped_warrants. Pre-loads the source's
 *  existing warrant_ids in one query, then INSERTs new + UPDATEs changed in batches of 100
 *  (executeBatch = one round-trip per chunk). Returns the number of hits processed. */
export async function bulkUpsertScrapedWarrants(db: D1Database, sourceKey: string, hits: RawWarrantHit[]): Promise<number> {
  const existing = await query<{ warrant_id: string }>(db,
    'SELECT warrant_id FROM scraped_warrants WHERE source_key = ?', sourceKey).catch(() => []);
  const have = new Set(existing.map((r) => r.warrant_id));
  const fullName = (h: RawWarrantHit) => h.full_name ?? ([h.first_name, h.last_name].filter(Boolean).join(' ').trim() || null);
  const CHUNK = 100;
  for (let i = 0; i < hits.length; i += CHUNK) {
    const slice = hits.slice(i, i + CHUNK);
    const stmts = slice.map((h) => {
      const fn = fullName(h);
      if (have.has(h.warrant_id)) {
        return { sql: `UPDATE scraped_warrants SET status='active', cleared_at=NULL, last_seen_at=datetime('now'), scraped_at=datetime('now'),
                         full_name=?, first_name=?, last_name=?, middle_name=?, date_of_birth=?, age=?, city=?, state=?,
                         warrant_type=?, charge_description=?, court_name=?, case_number=?, bail_amount=?, issue_date=?, photo_url=?, detail_url=?
                       WHERE source_key=? AND warrant_id=?`,
          bindings: [fn, h.first_name ?? null, h.last_name ?? null, h.middle_name ?? null, h.date_of_birth ?? null, h.age ?? null, h.city ?? null, h.state ?? null,
            h.warrant_type ?? null, h.charge_description ?? null, h.court_name ?? null, h.case_number ?? null, h.bail_amount ?? null, h.issue_date ?? null, h.photo_url ?? null, h.detail_url ?? null,
            sourceKey, h.warrant_id] };
      }
      return { sql: `INSERT INTO scraped_warrants
                       (source_key, warrant_id, full_name, first_name, last_name, middle_name, date_of_birth, age, city, state,
                        warrant_type, charge_description, court_name, case_number, bail_amount, issue_date, photo_url, detail_url,
                        status, first_seen_at, last_seen_at, scraped_at)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'active', datetime('now'), datetime('now'), datetime('now'))`,
        bindings: [sourceKey, h.warrant_id, fn, h.first_name ?? null, h.last_name ?? null, h.middle_name ?? null, h.date_of_birth ?? null, h.age ?? null, h.city ?? null, h.state ?? null,
          h.warrant_type ?? null, h.charge_description ?? null, h.court_name ?? null, h.case_number ?? null, h.bail_amount ?? null, h.issue_date ?? null, h.photo_url ?? null, h.detail_url ?? null] };
    });
    await executeBatch(db, stmts);
  }
  return hits.length;
}
```
VERIFY the column list against the real `upsertScrapedWarrant` (read store.ts) — if the live `scraped_warrants` is missing any column you reference, drop it from both the INSERT and UPDATE. Do NOT reference `kind` here (kind population is deferred per PR1's final review).

- [ ] **Step 4: Wire into `runFullListLeg` (`runScan.ts`)** — replace the per-hit upsert loop with the batched call and raise the cap (batching makes large sources affordable):
```ts
      // was: for (const hit of toStore) { try { await upsertScrapedWarrant(db, hit, null); found++; } catch { errors++; } }
      const MAX_FULL_LIST_HITS = 200000;  // batched ingest handles large rosters; keep a sane ceiling
      const toStore = hits.length > MAX_FULL_LIST_HITS ? hits.slice(0, MAX_FULL_LIST_HITS) : hits;
      try { found = await bulkUpsertScrapedWarrants(db, adapter.meta.key, toStore); } catch { errors++; }
```
(Keep the surrounding try/catch + `markScrapedCleared` + the `runStartedAt` capture. `upsertScrapedWarrant` stays exported for the per-person leg.)

- [ ] **Step 5: Run to verify pass** — `npx vitest run tests/warrantBulkStore.test.ts tests/warrantFullList.test.ts` → PASS (the existing full-list test must still pass — adapt its fake DB if needed to satisfy `batch()`; if the PR1 full-list test asserted `INSERT INTO scraped_warrants` per-hit, update it to assert the batched path instead). `npm test` → full suite green. `npm run typecheck` → PASS.

- [ ] **Step 6: Commit**
```bash
git add src/utils/warrantSources/store.ts src/utils/warrantSources/runScan.ts tests/warrantBulkStore.test.ts tests/warrantFullList.test.ts
git commit -m "feat(national-warrants): batched scraped_warrants ingest + raise full-list cap"
```

---

## Task 3: PDF adapter family in the config registry

**Files:** Modify `src/utils/warrantSources/configRegistry.ts`

- [ ] **Step 1: Add a PDF parser registry + family branch.** PDF config rows use `family` values `pdf-zuercher`, `pdf-txmuni`, `pdf-newton` (one per layout); `base_url` is the PDF URL. Add to `configRegistry.ts`:
```ts
import { fetchPdfText } from './pdfText';
import { parseZuercherPdf } from './parse/pdfZuercher';
import { parseTxMuniPdf } from './parse/pdfTxMuni';
import { parseNewtonPdf } from './parse/pdfNewton';

type PdfParser = (text: string, sourceKey: string, state: string) => import('./types').RawWarrantHit[];
const PDF_PARSERS: Record<string, PdfParser> = {
  'pdf-zuercher': parseZuercherPdf,
  'pdf-txmuni': parseTxMuniPdf,
  'pdf-newton': parseNewtonPdf,
};
```
Then in `makeAdapter`, after the `arcgis` branch and before `return null`, add:
```ts
  const pdfParser = PDF_PARSERS[row.family];
  if (pdfParser) {
    return { meta, mode: 'full-list', async fetchAll(): Promise<RawWarrantHit[]> {
      const text = await fetchPdfText(row.base_url ?? '');
      if (!text) return [];
      try { return pdfParser(text, row.source_key, row.state ?? 'US'); } catch { return []; }
    } };
  }
```

- [ ] **Step 2: Typecheck** — will FAIL until the 3 parser modules exist (Tasks 4-6). That's expected; this task's code is verified once those land. For now, create empty stubs so typecheck passes incrementally is NOT allowed (no stubs). Instead: **do Tasks 4, 5, 6 FIRST, then this task's import wiring.** (Reorder: implement parsers 4-6, then return here.) If executing in order, mark this task's commit as the step AFTER the parsers exist.

- [ ] **Step 3: Commit** (after parsers exist + typecheck passes)
```bash
git add src/utils/warrantSources/configRegistry.ts
git commit -m "feat(national-warrants): PDF adapter family (fetch → unpdf → layout parser)"
```

> NOTE TO EXECUTOR: implement Tasks 4 (Zuercher), 5 (TX-muni), 6 (Newton) BEFORE committing Task 3, since Task 3 imports them. Do the parser TDD first, then wire + commit Task 3.

---

## Task 4: Zuercher PDF parser (capture real fixture, header-driven, TDD)

**Files:** Create `src/utils/warrantSources/parse/pdfTable.ts` (shared helper), `.../parse/pdfZuercher.ts`, `tests/warrantPdfZuercher.test.ts`, fixture `tests/fixtures/warrants/zuercher-mckenzie.txt`

- [ ] **Step 1: Capture the REAL extracted text as a fixture.** Write a one-off node script (or use the helper) to fetch + extract McKenzie ND and save the text:
  ```bash
  node -e "import('./src/utils/warrantSources/pdfText.ts')" # (or via a small ts-node/vitest harness)
  ```
  Simplest: add a temporary vitest that calls `fetchPdfText('https://www.mckenziesheriff.net/usrfiles/cp/warrant_list_11-15-24.pdf')` and `console.log`s the first 60 lines; run it, copy the output into `tests/fixtures/warrants/zuercher-mckenzie.txt`, then delete the temp test. (If that dated URL 404s, find the current `/usrfiles/cp/warrant_list_<date>.pdf` from `https://www.mckenziesheriff.net`.) Also capture Codington SD (`https://codington.sdcounty.gov/sheriff/information/warrants/Warrants.pdf`) into `zuercher-codington.txt` to validate the header-driven approach across both column sets.

- [ ] **Step 2: Write the failing test** — `tests/warrantPdfZuercher.test.ts` (assert against the REAL captured fixtures — read them to write realistic expectations; the structure below shows the shape):
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseZuercherPdf } from '../src/utils/warrantSources/parse/pdfZuercher';

describe('parseZuercherPdf', () => {
  it('parses the McKenzie ND report (8-col) into hits', () => {
    const text = readFileSync('tests/fixtures/warrants/zuercher-mckenzie.txt', 'utf8');
    const hits = parseZuercherPdf(text, 'pdf-zuercher-mckenzie-nd', 'ND');
    expect(hits.length).toBeGreaterThan(0);
    const h = hits[0];
    expect(h.source_key).toBe('pdf-zuercher-mckenzie-nd');
    expect(h.state).toBe('ND');
    expect(h.full_name).toBeTruthy();          // "Last, First"
    expect(h.warrant_id).toBeTruthy();         // warrant number or derived
    // assert charge/issue_date/bond per what the real fixture shows
  });
  it('parses the Codington SD report (4-col) with the same parser', () => {
    const text = readFileSync('tests/fixtures/warrants/zuercher-codington.txt', 'utf8');
    const hits = parseZuercherPdf(text, 'pdf-zuercher-codington-sd', 'SD');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].full_name).toBeTruthy();
  });
});
```

- [ ] **Step 3: Implement `parse/pdfTable.ts` (shared) + `parse/pdfZuercher.ts`.** The Zuercher reports share a `Last, First Name` column + a header row naming columns; the parser detects column headers and maps cells. `pdfTable.ts` holds a generic "split text into rows, find the header line, map columns by name" helper; `pdfZuercher.ts` configures it with Zuercher's known header tokens (`Last, First Name`, `Charges`, `Bond`, `Date Issued`, `Warrant Number`, `OCA #`, `Extradition`, `Status`). Build the parser AGAINST THE REAL FIXTURE TEXT (the exact whitespace/line layout unpdf produces determines the row-splitting). Map → `RawWarrantHit` using `displayName`/`normalizeDate`/`normalizeBond` from `../normalize`; derive `warrant_id` from the warrant number, else `deriveWarrantId` (export it from socrata.ts or duplicate the small hash). Skip header/footer/"Printed on" lines.
  > Because the exact unpdf line layout is only known from the captured fixture, write `pdfTable.ts`'s row/column logic to match what the fixture actually contains. Keep it tolerant (skip blank/short lines; a row needs at least a name + one detail field).

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/warrantPdfZuercher.test.ts` → PASS (both counties). `npm run typecheck` → PASS.

- [ ] **Step 5: Commit**
```bash
git add src/utils/warrantSources/parse/pdfTable.ts src/utils/warrantSources/parse/pdfZuercher.ts tests/warrantPdfZuercher.test.ts tests/fixtures/warrants/zuercher-*.txt
git commit -m "feat(national-warrants): Zuercher PDF parser (header-driven, McKenzie+Codington fixtures)"
```

---

## Task 5: TX-municipal PDF parser (capture fixture, TDD)

**Files:** Create `src/utils/warrantSources/parse/pdfTxMuni.ts`, `tests/warrantPdfTxMuni.test.ts`, fixture `tests/fixtures/warrants/txmuni-killeen.txt`

- [ ] **Step 1: Capture the real fixture** from Killeen TX: `fetchPdfText('https://www.killeentexas.gov/DocumentCenter/View/6548/Active-Warrant-List-PDF')` → save first ~60 lines to `tests/fixtures/warrants/txmuni-killeen.txt` (same temp-test capture method as Task 4). Layout: `Defendant Name | Warrant Date | Balance Due | Offense Description`.

- [ ] **Step 2: Failing test** — `tests/warrantPdfTxMuni.test.ts` asserting `parseTxMuniPdf(fixture, 'pdf-txmuni-killeen-tx', 'TX')` → hits with `full_name`, `issue_date` (from Warrant Date), `bail_amount` (from Balance Due), `charge_description` (Offense Description). Write expectations from the real fixture. Run → FAIL.

- [ ] **Step 3: Implement `parse/pdfTxMuni.ts`** reusing `pdfTable.ts` with TX-muni header tokens (`Defendant Name`, `Warrant Date`/`Citation No`, `Balance Due`, `Offense Description`). Map via `displayName`/`normalizeDate`/`normalizeBond`; `warrant_id` from a warrant/citation number else `deriveWarrantId([name, issue_date])`. Tolerate Taylor's extra `Citation No` column via the header detection.

- [ ] **Step 4: Pass** — `npx vitest run tests/warrantPdfTxMuni.test.ts` → PASS. `npm run typecheck` → PASS.

- [ ] **Step 5: Commit**
```bash
git add src/utils/warrantSources/parse/pdfTxMuni.ts tests/warrantPdfTxMuni.test.ts tests/fixtures/warrants/txmuni-killeen.txt
git commit -m "feat(national-warrants): TX-municipal PDF parser (Killeen fixture)"
```

---

## Task 6: Newton GA PDF parser (capture fixture, TDD — includes DOB)

**Files:** Create `src/utils/warrantSources/parse/pdfNewton.ts`, `tests/warrantPdfNewton.test.ts`, fixture `tests/fixtures/warrants/newton-ga.txt`

- [ ] **Step 1: Capture** from the myocv CDN (find the current `<MMDDYY> Warrants.PDF` link on `https://www.newtonsheriffga.org` or use the documented `https://cdn.myocv.com/ocvapps/a70830014/files/...Warrants.PDF`): `fetchPdfText(url)` → `tests/fixtures/warrants/newton-ga.txt`. Layout: `Defendant's Name | Date of Birth | Warrant Number | Offense | Date Received`.

- [ ] **Step 2: Failing test** — assert `parseNewtonPdf(fixture, 'pdf-newton-ga', 'GA')` → hits with `full_name`, `date_of_birth` (DOB present!), `warrant_id` (Warrant Number), `charge_description` (Offense), `issue_date` (Date Received). Run → FAIL.

- [ ] **Step 3: Implement `parse/pdfNewton.ts`** via `pdfTable.ts` with Newton header tokens; map DOB → `normalizeDate`, name → `displayName`, warrant number → `warrant_id`. 

- [ ] **Step 4: Pass** — `npx vitest run tests/warrantPdfNewton.test.ts` → PASS. `npm run typecheck` → PASS.

- [ ] **Step 5: Commit + then commit Task 3's wiring** (now that all 3 parsers exist, the configRegistry import compiles):
```bash
git add src/utils/warrantSources/parse/pdfNewton.ts tests/warrantPdfNewton.test.ts tests/fixtures/warrants/newton-ga.txt
git commit -m "feat(national-warrants): Newton GA PDF parser (with DOB)"
# then Task 3 wiring:
git add src/utils/warrantSources/configRegistry.ts
git commit -m "feat(national-warrants): PDF adapter family (fetch → unpdf → layout parser)"
```
Run `npm run typecheck` → PASS (configRegistry now resolves the 3 parser imports).

---

## Task 7: Migration 0109 — seed PDF source rows + re-enable Baton Rouge

**Files:** Create `migrations/0109_national_warrant_pdf_sources.sql`

- [ ] **Step 1: Write the migration**
```sql
-- 0109: PDF warrant sources for the national pull (PR2) + re-enable Baton Rouge (batched ingest now handles volume).
-- ⚠️ Apply directly to live D1 (785de7ae) after merge.
INSERT OR IGNORE INTO national_warrant_sources
  (source_key, family, display_name, state, jurisdiction, base_url, resource_id, field_map, mode, format, kind, enabled, priority) VALUES
  ('pdf-zuercher-mckenzie-nd', 'pdf-zuercher', 'McKenzie County ND Sheriff Warrants', 'ND', 'McKenzie', 'https://www.mckenziesheriff.net/usrfiles/cp/warrant_list_11-15-24.pdf', NULL, NULL, 'full-list', 'pdf', 'criminal', 1, 3),
  ('pdf-zuercher-codington-sd', 'pdf-zuercher', 'Codington County SD Sheriff Warrants', 'SD', 'Codington', 'https://codington.sdcounty.gov/sheriff/information/warrants/Warrants.pdf', NULL, NULL, 'full-list', 'pdf', 'criminal', 1, 3),
  ('pdf-zuercher-tuscarawas-oh', 'pdf-zuercher', 'Tuscarawas County OH Sheriff Warrants', 'OH', 'Tuscarawas', 'https://cms3.revize.com/revize/tuscarawas/_assets_/files/Active_Warrants_list_for_TCSO_website.pdf', NULL, NULL, 'full-list', 'pdf', 'criminal', 1, 3),
  ('pdf-zuercher-harrison-oh', 'pdf-zuercher', 'Harrison County OH Outstanding Warrants', 'OH', 'Harrison', 'https://www.harrisoncountyohio.gov/outstanding-warrants', NULL, NULL, 'full-list', 'pdf', 'criminal', 1, 3),
  ('pdf-txmuni-killeen-tx', 'pdf-txmuni', 'Killeen TX Municipal Warrants', 'TX', 'Killeen', 'https://www.killeentexas.gov/DocumentCenter/View/6548/Active-Warrant-List-PDF', NULL, NULL, 'full-list', 'pdf', 'criminal', 1, 3),
  ('pdf-txmuni-bellmead-tx', 'pdf-txmuni', 'Bell Mead TX Municipal Warrants', 'TX', 'Bell Mead', 'https://bellmeadtx.gov/DocumentCenter/View/1486/Active-Warrant-Listing-as-of-December-18-2025', NULL, NULL, 'full-list', 'pdf', 'criminal', 1, 3),
  ('pdf-txmuni-taylor-tx', 'pdf-txmuni', 'Taylor TX Municipal Warrants', 'TX', 'Taylor', 'https://www.taylortx.gov/DocumentCenter/View/15624/Updated-Warrant-List-2025', NULL, NULL, 'full-list', 'pdf', 'criminal', 1, 3),
  ('pdf-newton-ga', 'pdf-newton', 'Newton County GA Sheriff Warrants', 'GA', 'Newton', 'https://cdn.myocv.com/ocvapps/a70830014/files/012926%20Warrants.PDF', NULL, NULL, 'full-list', 'pdf', 'criminal', 1, 3);

-- Re-enable Baton Rouge now that batched ingest (PR2) handles 113K rows.
UPDATE national_warrant_sources SET enabled = 1 WHERE source_key = 'socrata-brla-citycourt';
```
> The dated PDF URLs (McKenzie `_11-15-24`, Newton `012926`) rotate. PR2b adds link-discovery (scrape the landing page for the current dated link); for PR2 the seeded URLs are the verified-at-research-time ones — the adapter's `fetchPdfText` returns [] (not a crash) if a URL 404s, so a stale URL degrades gracefully.

- [ ] **Step 2: Apply locally + verify** — `npx wrangler d1 execute rmpg-flex --local --file migrations/0109_national_warrant_pdf_sources.sql` then `... --command "SELECT family, COUNT(*) FROM national_warrant_sources GROUP BY family;"` → expect socrata(2), arcgis(1), pdf-zuercher(4), pdf-txmuni(3), pdf-newton(1).

- [ ] **Step 3: Commit**
```bash
git add migrations/0109_national_warrant_pdf_sources.sql
git commit -m "feat(national-warrants): migration 0109 — seed 8 PDF sources + re-enable Baton Rouge"
```

---

## Task 8: SW bump + full verification + PR

**Files:** Modify `client/public/sw.js`

- [ ] **Step 1: Bump `CACHE_NAME`** to the next version (read current, increment).
- [ ] **Step 2: Verify**
  - `npm run typecheck` → PASS
  - `npm test` → all pass (incl. new pdfText/bulkStore/3-parser suites)
  - `npx wrangler deploy --dry-run --outdir /tmp/nwp-bundle2 2>&1 | tail -5` → bundle succeeds with unpdf (re-confirm)
  - `cd client && npx vite build` → succeeds (client unchanged but confirm)
- [ ] **Step 3: Commit + push + PR**
```bash
git add client/public/sw.js
git commit -m "chore(sw): bump cache for national warrant PDF wave (PR2)"
git push -u origin <branch>
gh pr create --base main --title "feat(national-warrants): PDF wave — unpdf + Zuercher/TX-muni/Newton parsers + batched ingest (PR2)" --body "PDF ingestion for the national warrant pull. unpdf text extraction + a PDF adapter family + 3 header-driven parsers (8 sources) + batched scraped_warrants ingest (re-enables Baton Rouge). See docs/superpowers/plans/2026-06-13-national-warrant-pull-pr2-pdf.md. Post-merge: apply migrations/0109 to live D1 785de7ae; verify a scan populates the PDF sources. PR2b = remaining bespoke PDF layouts (Kootenai/PSIMS/Kanawha/St-Louis) + dated-URL link discovery."
```

### Ship-gates (post-merge)
1. Apply `migrations/0109` to live D1 `785de7ae`; verify the 8 PDF rows + Baton Rouge enabled=1.
2. Confirm the deployed Worker bundle includes unpdf (a `/national/scan` that touches a PDF source must not 500/timeout).
3. Trigger `POST /api/warrants/national/scan`; confirm PDF sources populate `scraped_warrants` and appear in `/national-search`.

---

## Self-Review
**Spec coverage:** PDF extraction (§5.3)→T1; batched ingest + Baton Rouge re-enable (§9/§12)→T2,T7; PDF family factory (§5.2)→T3; Zuercher/TX-muni/Newton parsers (§4)→T4,T5,T6; migration→T7; verify/PR→T8. Remaining PDF layouts (Kootenai/PSIMS/Kanawha/St-Louis, §4) explicitly deferred to PR2b. ✓
**Placeholder scan:** The parser tasks intentionally instruct "capture the REAL unpdf text as the fixture, then write the parser against it" — this is NOT a placeholder; it's the correct method for PDF parsing where the exact text layout is only knowable by running unpdf. The `pdfTable.ts` row/column logic is specified to match the captured fixture. Task 1 is a hard gate (BLOCK if unpdf won't bundle). No TBD/TODO. ✓
**Type consistency:** `extractPdfText`/`fetchPdfText` (T1) used by T3; `bulkUpsertScrapedWarrants` (T2) used in runScan (T2 step 4); `parseZuercherPdf`/`parseTxMuniPdf`/`parseNewtonPdf` (T4-6) imported in configRegistry (T3); `pdfTable.ts` shared by all 3 parsers; `RawWarrantHit`/`displayName`/`normalizeDate`/`normalizeBond` from PR1 reused. Task 3 wiring commits AFTER T4-6 (noted). ✓
