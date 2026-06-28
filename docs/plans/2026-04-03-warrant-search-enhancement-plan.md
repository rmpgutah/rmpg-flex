# Warrant Search Enhancement — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enhance the warrant system with unified cross-source search, rich watch list cards with map, BOLO/summary PDF generation, and cross-module warrant integration.

**Architecture:** Additive changes to the existing 5-tab WarrantsPage. Replace "UTAH SEARCH" tab with "SEARCH ALL" tab backed by a new fan-out endpoint. Upgrade Watch List tab with rich person cards and embedded Google Map. Add 3 PDF outputs using existing jsPDF infrastructure. Add warrant badges and navigation links in dispatch/records/MDT pages.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Express, better-sqlite3, jsPDF, Google Maps JS API

**Design Doc:** `docs/plans/2026-04-03-warrant-search-enhancement-design.md`

---

## Task 1: Unified Search API Endpoint

**Files:**
- Modify: `server/src/routes/warrants.ts` (insert before line 1523, before `export default router`)

**Step 1: Add `POST /api/warrants/search-all` endpoint**

This endpoint fans out to local warrants, Utah API/cache, and scraped_warrants. It reuses the existing `searchUtahWarrantsLive`, `searchUtahWarrantsCache`, and `isUtahApiBlocked` utilities already imported at the top of the file.

```typescript
// ════════════════════════════════════════════════════════════
// Unified Cross-Source Search
// ════════════════════════════════════════════════════════════
router.post('/search-all', (req: Request, res: Response) => {
  (async () => {
    try {
      const {
        firstName, lastName, dob, warrantNumber, court,
        source, offenseLevel, status, type, chargeKeyword,
        dateFrom, dateTo,
      } = req.body;

      const startTime = Date.now();
      const db = getDb();
      const sourcesQueried: string[] = [];

      // ── 1. Local warrants ──
      let localWhere = 'WHERE 1=1';
      const localParams: any[] = [];

      if (firstName?.trim()) {
        localWhere += ' AND LOWER(p.first_name) LIKE LOWER(?)';
        localParams.push(`%${firstName.trim()}%`);
      }
      if (lastName?.trim()) {
        localWhere += ' AND LOWER(p.last_name) LIKE LOWER(?)';
        localParams.push(`%${lastName.trim()}%`);
      }
      if (dob?.trim()) {
        localWhere += ' AND p.dob = ?';
        localParams.push(dob.trim());
      }
      if (warrantNumber?.trim()) {
        localWhere += ' AND LOWER(w.warrant_number) LIKE LOWER(?)';
        localParams.push(`%${warrantNumber.trim()}%`);
      }
      if (court?.trim()) {
        localWhere += ' AND LOWER(w.issuing_court) LIKE LOWER(?)';
        localParams.push(`%${court.trim()}%`);
      }
      if (offenseLevel) {
        localWhere += ' AND w.offense_level = ?';
        localParams.push(offenseLevel);
      }
      if (status) {
        localWhere += ' AND w.status = ?';
        localParams.push(status);
      }
      if (type) {
        localWhere += ' AND w.type = ?';
        localParams.push(type);
      }
      if (chargeKeyword?.trim()) {
        localWhere += ' AND LOWER(w.charge_description) LIKE LOWER(?)';
        localParams.push(`%${chargeKeyword.trim()}%`);
      }
      if (dateFrom) {
        localWhere += ' AND w.created_at >= ?';
        localParams.push(dateFrom);
      }
      if (dateTo) {
        localWhere += ' AND w.created_at <= ?';
        localParams.push(dateTo);
      }

      const localWarrants = db.prepare(`
        SELECT w.*, p.first_name as subject_first_name, p.last_name as subject_last_name,
          (p.first_name || ' ' || p.last_name) as subject_name,
          p.dob as subject_dob, p.gender as subject_gender, p.race as subject_race,
          p.height as subject_height, p.weight as subject_weight,
          p.hair_color as subject_hair_color, p.eye_color as subject_eye_color,
          p.address as subject_address, p.photo_url as subject_photo_url,
          u.full_name as entered_by_name
        FROM warrants w
        LEFT JOIN persons p ON w.subject_person_id = p.id
        LEFT JOIN users u ON w.entered_by = u.id
        ${localWhere}
        ORDER BY w.created_at DESC LIMIT 100
      `).all(...localParams);
      sourcesQueried.push('local');

      // ── 2. Utah API (only if name provided) ──
      let utahResults: any[] = [];
      let utahBlocked = false;
      if (firstName?.trim() && lastName?.trim() && (!source || source === 'utah' || source === 'all')) {
        try {
          if (isUtahApiBlocked()) {
            utahBlocked = true;
            throw new Error('blocked');
          }
          utahResults = (await searchUtahWarrantsLive(firstName.trim(), lastName.trim())) || [];
        } catch {
          // Fallback to cache
          utahResults = db.prepare(`
            SELECT * FROM utah_warrants
            WHERE LOWER(first_name) = LOWER(?) AND LOWER(last_name) = LOWER(?)
            ORDER BY fetched_at DESC LIMIT 100
          `).all(firstName.trim(), lastName.trim()) as any[];
        }
        sourcesQueried.push('utah');
      }

      // ── 3. Scraped warrants ──
      let scrapedWhere = 'WHERE 1=1';
      const scrapedParams: any[] = [];
      if (firstName?.trim()) {
        scrapedWhere += ' AND LOWER(first_name) LIKE LOWER(?)';
        scrapedParams.push(`%${firstName.trim()}%`);
      }
      if (lastName?.trim()) {
        scrapedWhere += ' AND LOWER(last_name) LIKE LOWER(?)';
        scrapedParams.push(`%${lastName.trim()}%`);
      }
      if (chargeKeyword?.trim()) {
        scrapedWhere += ' AND LOWER(charge_description) LIKE LOWER(?)';
        scrapedParams.push(`%${chargeKeyword.trim()}%`);
      }
      if (offenseLevel) {
        scrapedWhere += ' AND offense_level = ?';
        scrapedParams.push(offenseLevel);
      }

      const scrapedWarrants = (!source || source === 'scraped' || source === 'all')
        ? db.prepare(`SELECT * FROM scraped_warrants ${scrapedWhere} ORDER BY parsed_at DESC LIMIT 100`).all(...scrapedParams)
        : [];
      if (!source || source === 'scraped' || source === 'all') sourcesQueried.push('scraped');

      // Audit log
      const searchTerms = [firstName, lastName, dob, warrantNumber].filter(Boolean).join(' ');
      auditLog(req, 'SEARCH' as any, 'warrant' as any, 0, `Unified search: ${searchTerms} — ${localWarrants.length + utahResults.length + (scrapedWarrants as any[]).length} results`);

      res.json({
        local: localWarrants,
        utah: utahResults,
        scraped: scrapedWarrants,
        meta: {
          duration: Date.now() - startTime,
          sources: sourcesQueried,
          utahBlocked,
          searchedAt: localNow(),
          totalHits: localWarrants.length + utahResults.length + (scrapedWarrants as any[]).length,
        },
      });
    } catch (error: any) {
      console.error('Unified warrant search error:', error);
      res.status(500).json({ error: 'Search failed', code: 'UNIFIED_SEARCH_ERROR' });
    }
  })();
});
```

**Step 2: Add `GET /api/warrants/summary-report` endpoint**

Insert after the search-all endpoint:

```typescript
// ════════════════════════════════════════════════════════════
// Summary Report Data
// ════════════════════════════════════════════════════════════
router.get('/summary-report', requireRole('dispatcher', 'supervisor', 'admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { from, to } = req.query;
    const dateFilter = (from && to) ? `AND w.created_at BETWEEN ? AND ?` : '';
    const dateParams = (from && to) ? [from, to] : [];

    const byStatus = db.prepare(`
      SELECT status, COUNT(*) as count FROM warrants w
      WHERE archived_at IS NULL ${dateFilter} GROUP BY status
    `).all(...dateParams) as any[];

    const byType = db.prepare(`
      SELECT type, COUNT(*) as count FROM warrants w
      WHERE archived_at IS NULL ${dateFilter} GROUP BY type
    `).all(...dateParams) as any[];

    const bySeverity = db.prepare(`
      SELECT offense_level, COUNT(*) as count FROM warrants w
      WHERE archived_at IS NULL ${dateFilter} GROUP BY offense_level
    `).all(...dateParams) as any[];

    const bySource = db.prepare(`
      SELECT COALESCE(source, 'local') as source, COUNT(*) as count FROM warrants w
      WHERE archived_at IS NULL ${dateFilter} GROUP BY source
    `).all(...dateParams) as any[];

    const topCourts = db.prepare(`
      SELECT issuing_court, COUNT(*) as count FROM warrants w
      WHERE issuing_court IS NOT NULL AND archived_at IS NULL ${dateFilter}
      GROUP BY issuing_court ORDER BY count DESC LIMIT 10
    `).all(...dateParams) as any[];

    const newThisPeriod = (from && to) ? (db.prepare(`
      SELECT COUNT(*) as count FROM warrants WHERE created_at BETWEEN ? AND ?
    `).get(from, to) as any)?.count || 0 : null;

    const clearedThisPeriod = (from && to) ? (db.prepare(`
      SELECT COUNT(*) as count FROM warrants WHERE status IN ('served', 'recalled', 'quashed')
        AND updated_at BETWEEN ? AND ?
    `).get(from, to) as any)?.count || 0 : null;

    // Scan activity
    const scanActivity = db.prepare(`
      SELECT COUNT(*) as total_scans,
        SUM(new_warrants_found) as total_found,
        SUM(warrants_cleared) as total_cleared
      FROM warrant_watch_runs
      ${(from && to) ? 'WHERE created_at BETWEEN ? AND ?' : ''}
    `).get(...dateParams) as any;

    res.json({
      byStatus: Object.fromEntries(byStatus.map((r: any) => [r.status, r.count])),
      byType: Object.fromEntries(byType.map((r: any) => [r.type, r.count])),
      bySeverity: Object.fromEntries(bySeverity.map((r: any) => [r.offense_level || 'unknown', r.count])),
      bySource: Object.fromEntries(bySource.map((r: any) => [r.source, r.count])),
      topCourts,
      newThisPeriod,
      clearedThisPeriod,
      scanActivity: {
        totalScans: scanActivity?.total_scans || 0,
        totalFound: scanActivity?.total_found || 0,
        totalCleared: scanActivity?.total_cleared || 0,
      },
      period: { from: from || null, to: to || null },
    });
  } catch (error: any) {
    console.error('Summary report error:', error);
    res.status(500).json({ error: 'Failed to generate summary report', code: 'SUMMARY_REPORT_ERROR' });
  }
});
```

**Step 3: Enhance auto-poll-status to include person details and warrants**

Modify `server/src/routes/warrants.ts:1296-1339`. Replace the `flaggedPersons` query to join person physical description fields and include full warrant details:

```typescript
// Replace the existing flaggedPersons query at line 1308-1318 with:
const flaggedPersons = db.prepare(`
  SELECT p.id, p.first_name, p.last_name, p.dob, p.gender, p.race,
    p.height, p.weight, p.hair_color, p.eye_color, p.address, p.photo_url,
    (SELECT COUNT(*) FROM warrants w WHERE w.subject_person_id = p.id AND w.status = 'active') as local_warrant_count,
    (SELECT COUNT(*) FROM utah_warrants uw WHERE LOWER(uw.first_name) = LOWER(p.first_name) AND LOWER(uw.last_name) = LOWER(p.last_name)) as utah_hit_count,
    (SELECT w2.offense_level FROM warrants w2 WHERE w2.subject_person_id = p.id AND w2.status = 'active'
     ORDER BY CASE w2.offense_level WHEN 'felony' THEN 1 WHEN 'misdemeanor' THEN 2 ELSE 3 END LIMIT 1) as warrant_severity
  FROM persons p
  WHERE (SELECT COUNT(*) FROM warrants w WHERE w.subject_person_id = p.id AND w.status = 'active') > 0
     OR (SELECT COUNT(*) FROM utah_warrants uw WHERE LOWER(uw.first_name) = LOWER(p.first_name) AND LOWER(uw.last_name) = LOWER(p.last_name)) > 0
  ORDER BY
    CASE (SELECT w3.offense_level FROM warrants w3 WHERE w3.subject_person_id = p.id AND w3.status = 'active'
          ORDER BY CASE w3.offense_level WHEN 'felony' THEN 1 WHEN 'misdemeanor' THEN 2 ELSE 3 END LIMIT 1)
      WHEN 'felony' THEN 1 WHEN 'misdemeanor' THEN 2 WHEN 'infraction' THEN 3 ELSE 4 END,
    p.last_name
  LIMIT 200
`).all() as any[];

// After flaggedPersons query, fetch full warrant details per person
const flaggedWithWarrants = flaggedPersons.map((p: any) => {
  const warrants = db.prepare(`
    SELECT w.id, w.warrant_number, w.type, w.status, w.charge_description,
      w.offense_level, w.bail_amount, w.issuing_court, w.source, w.created_at
    FROM warrants w WHERE w.subject_person_id = ? AND w.status = 'active'
    ORDER BY w.created_at DESC
  `).all(p.id);

  const utahWarrants = db.prepare(`
    SELECT utah_warrant_id, charges, court_name, issue_date
    FROM utah_warrants
    WHERE LOWER(first_name) = LOWER(?) AND LOWER(last_name) = LOWER(?)
    ORDER BY fetched_at DESC LIMIT 20
  `).all(p.first_name, p.last_name);

  return { ...p, warrants, utahWarrants };
});

// In the res.json() response, change `flaggedPersons` to `flaggedWithWarrants`:
// flaggedPersons: flaggedWithWarrants,
```

**Step 4: Commit**

```bash
git add server/src/routes/warrants.ts
git commit -m "feat: add unified warrant search-all endpoint, summary report, and enhanced auto-poll"
```

---

## Task 2: Unified Search Tab (Client)

**Files:**
- Modify: `client/src/pages/WarrantsPage.tsx`

**Step 1: Update tab configuration and types**

Near line 165-196, add the unified search types:

```typescript
// Add after UtahSearchResults interface (~line 196):
interface UnifiedSearchResults {
  local: Warrant[];
  utah: UtahWarrantResult[];
  scraped: UtahWarrantResult[];
  meta: {
    duration: number;
    sources: string[];
    utahBlocked: boolean;
    searchedAt: string;
    totalHits: number;
  };
}
```

At line 289, change the tab ID:
```typescript
// Change 'utah-search' to 'search-all' in TabId:
type TabId = 'dashboard' | 'warrants' | 'search-all' | 'watch' | 'sources';
```

At line 294, update the tab label:
```typescript
// Change the utah-search tab entry:
{ id: 'search-all', label: 'SEARCH ALL', icon: Globe },
```

**Step 2: Add unified search state variables**

Near line 530-534 (where utahSearch state is), replace with expanded state:

```typescript
// Unified Search state
const [uniSearchFirst, setUniSearchFirst] = useState('');
const [uniSearchLast, setUniSearchLast] = useState('');
const [uniSearchDob, setUniSearchDob] = useState('');
const [uniSearchWarrantNum, setUniSearchWarrantNum] = useState('');
const [uniSearchCourt, setUniSearchCourt] = useState('');
const [uniSearchSource, setUniSearchSource] = useState('');
const [uniSearchOffenseLevel, setUniSearchOffenseLevel] = useState('');
const [uniSearchStatus, setUniSearchStatus] = useState('');
const [uniSearchType, setUniSearchType] = useState('');
const [uniSearchCharge, setUniSearchCharge] = useState('');
const [uniSearchDateFrom, setUniSearchDateFrom] = useState('');
const [uniSearchDateTo, setUniSearchDateTo] = useState('');
const [uniSearching, setUniSearching] = useState(false);
const [uniResults, setUniResults] = useState<UnifiedSearchResults | null>(null);
const [uniAdvancedOpen, setUniAdvancedOpen] = useState(false);
const [uniSearchHistory, setUniSearchHistory] = useState<{ first: string; last: string; hits: number; at: string }[]>([]);

// Typeahead
const [nameTypeahead, setNameTypeahead] = useState<Person[]>([]);
const [nameTypeaheadLoading, setNameTypeaheadLoading] = useState(false);
const typeaheadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
```

**Step 3: Add unified search function**

Near line 712 (where `runUtahSearch` is), add the unified search callback. Keep `runUtahSearch` for backward compat within the page (some buttons call it) but wire the new search tab to `runUnifiedSearch`:

```typescript
const runUnifiedSearch = useCallback(async () => {
  if (!uniSearchFirst.trim() && !uniSearchLast.trim() && !uniSearchWarrantNum.trim()) return;
  setUniSearching(true);
  try {
    const body: Record<string, string> = {};
    if (uniSearchFirst.trim()) body.firstName = uniSearchFirst.trim();
    if (uniSearchLast.trim()) body.lastName = uniSearchLast.trim();
    if (uniSearchDob.trim()) body.dob = uniSearchDob.trim();
    if (uniSearchWarrantNum.trim()) body.warrantNumber = uniSearchWarrantNum.trim();
    if (uniSearchCourt.trim()) body.court = uniSearchCourt.trim();
    if (uniSearchSource) body.source = uniSearchSource;
    if (uniSearchOffenseLevel) body.offenseLevel = uniSearchOffenseLevel;
    if (uniSearchStatus) body.status = uniSearchStatus;
    if (uniSearchType) body.type = uniSearchType;
    if (uniSearchCharge.trim()) body.chargeKeyword = uniSearchCharge.trim();
    if (uniSearchDateFrom) body.dateFrom = uniSearchDateFrom;
    if (uniSearchDateTo) body.dateTo = uniSearchDateTo;

    const res = await apiFetch<UnifiedSearchResults>('/warrants/search-all', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    setUniResults(res);
    if (uniSearchFirst.trim() && uniSearchLast.trim()) {
      setUniSearchHistory(prev => [
        { first: uniSearchFirst.trim(), last: uniSearchLast.trim(), hits: res.meta.totalHits, at: new Date().toISOString() },
        ...prev.filter(h => !(h.first === uniSearchFirst.trim() && h.last === uniSearchLast.trim())),
      ].slice(0, 10));
    }
  } finally { setUniSearching(false); }
}, [uniSearchFirst, uniSearchLast, uniSearchDob, uniSearchWarrantNum, uniSearchCourt,
    uniSearchSource, uniSearchOffenseLevel, uniSearchStatus, uniSearchType,
    uniSearchCharge, uniSearchDateFrom, uniSearchDateTo]);
```

**Step 4: Add typeahead effect**

```typescript
// Name typeahead effect (debounced 300ms)
useEffect(() => {
  if (typeaheadTimer.current) clearTimeout(typeaheadTimer.current);
  const query = `${uniSearchFirst} ${uniSearchLast}`.trim();
  if (query.length < 2) { setNameTypeahead([]); return; }
  typeaheadTimer.current = setTimeout(async () => {
    setNameTypeaheadLoading(true);
    try {
      const res = await apiFetch<{ data: Person[] }>(`/records/persons?search=${encodeURIComponent(query)}&limit=8`);
      setNameTypeahead(res.data || []);
    } finally { setNameTypeaheadLoading(false); }
  }, 300);
  return () => { if (typeaheadTimer.current) clearTimeout(typeaheadTimer.current); };
}, [uniSearchFirst, uniSearchLast]);
```

**Step 5: Replace the Utah Search tab JSX**

Replace the entire `{activeTab === 'utah-search' && (...)}` block (lines 1862-2074) with the new SEARCH ALL tab. This is a large JSX block — build it with:

- Search form with first/last/DOB + warrant#/court/source dropdowns
- Collapsible "Advanced Filters" with ChevronDown toggle
- Typeahead dropdown below name fields showing matching persons
- Results area grouped by source (local, utah, scraped) with count badges
- Each result row clickable (reuse existing `openUtahDetail` pattern)
- Import to Local button on external results
- Search history chips at bottom

**Step 6: Update all references to `utah-search` tab ID**

Search for `'utah-search'` string references in the file and update to `'search-all'`. Key locations:
- Tab button click handlers that switch to utah-search
- Watch list "search utah" button (~line 2183-2187) — change to pre-fill unified search
- Person profile "search again" logic (~line 809-813)
- Dashboard quick search enter handler if it routes to utah-search

**Step 7: Commit**

```bash
git add client/src/pages/WarrantsPage.tsx
git commit -m "feat: replace Utah Search tab with unified cross-source Search All tab"
```

---

## Task 3: Watch List Rich Person Cards

**Files:**
- Modify: `client/src/pages/WarrantsPage.tsx` (Watch tab section, ~lines 2076-2270)

**Step 1: Update the AutoPollStatus interface**

Update the `AutoPollStatus` interface (~line 198-205) to include the new person fields:

```typescript
interface AutoPollStatus {
  syncStatus: { lastSync: string | null; warrantCount: number; status: string; lastError: string | null };
  blocked: boolean;
  runs: WatchRun[];
  flaggedPersons: WatchPerson[];
  recentHits: { id: number; person_id: number; person_name: string; event: string; charges?: string; court_name?: string; created_at: string }[];
  totalPersons: number;
}

interface WatchPerson {
  id: number;
  first_name: string;
  last_name: string;
  dob?: string;
  gender?: string;
  race?: string;
  height?: string;
  weight?: string;
  hair_color?: string;
  eye_color?: string;
  address?: string;
  photo_url?: string | null;
  warrant_severity: string | null;
  local_warrant_count: number;
  utah_hit_count: number;
  warrants: { id: number; warrant_number: string; type: string; status: string; charge_description: string; offense_level: string | null; bail_amount: number | null; issuing_court: string | null; source: string | null; created_at: string }[];
  utahWarrants: { utah_warrant_id: string; charges: string; court_name: string; issue_date: string }[];
}
```

**Step 2: Add sort state for watch list**

```typescript
const [watchSort, setWatchSort] = useState<'severity' | 'recent' | 'name'>('severity');
const [watchMapOpen, setWatchMapOpen] = useState(false);
```

**Step 3: Replace flagged persons section**

Replace the flat list section (lines ~2137-2195) with rich person cards. Each card:

- Photo (40x40) or User icon placeholder
- Name, DOB, physical description row (gender/race/height/weight/hair/eyes)
- Address line
- Severity badge (colored by level, grouped visually)
- Expandable warrants list (all local + utah warrants inline)
- Action buttons row: Search All, Print Sheet, View Record, View Calls, Run Check

Sort the `flaggedPersons` array client-side based on `watchSort` before rendering.

**Step 4: Commit**

```bash
git add client/src/pages/WarrantsPage.tsx
git commit -m "feat: upgrade watch list to rich person cards with priority sorting"
```

---

## Task 4: Watch List Embedded Map

**Files:**
- Modify: `client/src/pages/WarrantsPage.tsx`

**Step 1: Add map container and toggle**

Below the sort controls in the watch tab, add a collapsible Google Maps panel:

```tsx
{watchMapOpen && (
  <div className="panel-inset bg-surface-sunken rounded-sm overflow-hidden" style={{ height: 280 }}>
    <div ref={watchMapRef} className="w-full h-full" />
  </div>
)}
```

**Step 2: Initialize Google Maps with markers**

Use the existing `googleMapsLoader.ts` infrastructure. Add a `useEffect` that:
1. Loads the Google Maps API via the existing loader
2. Creates a map centered on SLC (40.76, -111.89)
3. Applies the existing `DARK_MAP_STYLE`
4. For each flagged person with an address, creates a marker
5. Clicking a marker scrolls to that person's card (using `document.getElementById`)

Reference: Check `client/src/pages/map/MapPage.tsx` for how the existing map is initialized with dark style.

**Step 3: Add ref for map container and person card scroll targets**

```typescript
const watchMapRef = useRef<HTMLDivElement>(null);
const watchMapInstance = useRef<google.maps.Map | null>(null);
```

Each person card gets `id={`watch-person-${p.id}`}` for scroll targeting.

**Step 4: Commit**

```bash
git add client/src/pages/WarrantsPage.tsx
git commit -m "feat: add embedded map to watch list showing flagged person locations"
```

---

## Task 5: Enhanced Warrant PDF + BOLO Packet + Summary Report

**Files:**
- Modify: `client/src/utils/recordPdfGenerator.ts`
- Modify: `client/src/pages/WarrantsPage.tsx`

**Step 5a: Enhance individual warrant PDF**

Modify `generateWarrantReport` function (line 2069-3147) to add:
1. Subject photo — if `data.subject_photo_url` is provided, use `doc.addImage()` in the top-right of the Subject section
2. Add `subject_photo_url` to the `WarrantPdfData` interface (line 419-459)
3. Add `service_attempts` array field to `WarrantPdfData` for service history
4. After the Court section, add a Service Attempts section if attempts exist

**Step 5b: Add BOLO packet generator**

Add a new exported function in `recordPdfGenerator.ts`:

```typescript
export interface BoloSubject {
  first_name: string;
  last_name: string;
  dob?: string;
  gender?: string;
  race?: string;
  height?: string;
  weight?: string;
  hair_color?: string;
  eye_color?: string;
  address?: string;
  photo_url?: string | null;
  warrants: { warrant_number: string; type: string; charge_description: string; offense_level: string | null; issuing_court: string | null; bail_amount: number | null }[];
}

export function generateBoloPdf(subjects: BoloSubject[]): jsPDF {
  // New multi-page PDF:
  // - Header page: RMPG seal, "BE ON THE LOOKOUT (BOLO) PACKET", date, count
  // - 2-3 subjects per page, each with photo, physical desc, warrant list
  // - Sorted by severity (felony first)
  // - Uses existing drawNibrsHeader, drawFormSection helpers
}
```

**Step 5c: Add summary report PDF generator**

Add a new exported function:

```typescript
export interface WarrantSummaryData {
  period: { from: string | null; to: string | null };
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  bySeverity: Record<string, number>;
  bySource: Record<string, number>;
  topCourts: { issuing_court: string; count: number }[];
  newThisPeriod: number | null;
  clearedThisPeriod: number | null;
  scanActivity: { totalScans: number; totalFound: number; totalCleared: number };
}

export function generateWarrantSummaryPdf(data: WarrantSummaryData): jsPDF {
  // Single-page PDF with:
  // - RMPG header + "WARRANT ACTIVITY SUMMARY REPORT"
  // - Period display
  // - Tables for each breakdown (status, type, severity, source, courts)
  // - Scan activity summary
  // - Uses existing drawNibrsHeader, drawFormSection helpers
}
```

**Step 5d: Wire print buttons into WarrantsPage**

1. **Dashboard tab**: Add "Export Report" button that opens a date range modal, fetches `/api/warrants/summary-report`, and calls `generateWarrantSummaryPdf`
2. **Watch List tab toolbar**: Add "Print BOLO Packet" button that gathers flaggedPersons data and calls `generateBoloPdf`
3. **Warrant detail panel**: Update the existing PDF download to pass `subject_photo_url` and `service_attempts`

**Step 5e: Commit**

```bash
git add client/src/utils/recordPdfGenerator.ts client/src/pages/WarrantsPage.tsx
git commit -m "feat: add BOLO packet PDF, summary report PDF, and enhanced warrant sheet"
```

---

## Task 6: Internal Integration — Cross-Module Links

**Files:**
- Modify: `client/src/pages/WarrantsPage.tsx` (warrant detail panel, ~lines 1654-1844)
- Modify: `client/src/pages/records/PersonsTab.tsx`
- Modify: `client/src/pages/dispatch/DispatchPage.tsx`
- Modify: `client/src/pages/MdtPage.tsx`

**Step 6a: Add navigation links in warrant detail panel**

In the warrant detail Subject Information section (~line 1733-1793), make the subject name a clickable link:

```tsx
<button
  type="button"
  onClick={() => navigate(`/records?tab=persons&personId=${selectedWarrant.subject_person_id}`)}
  className="text-brand-300 hover:text-brand-200 font-bold underline decoration-brand-700 cursor-pointer"
>
  {selectedWarrant.subject_name}
</button>
```

Add an action buttons row after the subject info section:

```tsx
<div className="flex gap-2 flex-wrap mt-2">
  {selectedWarrant.subject_person_id && (
    <>
      <button type="button" onClick={() => navigate(`/records?tab=persons&personId=${selectedWarrant.subject_person_id}`)}
        className="toolbar-btn text-[9px]"><User className="w-3 h-3" /> View Record</button>
      <button type="button" onClick={() => navigate(`/dispatch?personId=${selectedWarrant.subject_person_id}`)}
        className="toolbar-btn text-[9px]"><Activity className="w-3 h-3" /> View Calls</button>
      <button type="button" onClick={() => navigate(`/records?tab=arrests&personId=${selectedWarrant.subject_person_id}`)}
        className="toolbar-btn text-[9px]"><Shield className="w-3 h-3" /> View Arrests</button>
    </>
  )}
</div>
```

Note: Import `useNavigate` from `react-router-dom` if not already imported in WarrantsPage.

**Step 6b: Add warrant badge in PersonsTab**

In `client/src/pages/records/PersonsTab.tsx`, find where person details are displayed. Add a warrant check:

```tsx
// Fetch active warrant count for selected person
const [warrantCount, setWarrantCount] = useState(0);
useEffect(() => {
  if (!selectedPerson?.id) return;
  apiFetch<{ count: number }>(`/warrants/check/${selectedPerson.id}`)
    .then(res => setWarrantCount(res.count));
}, [selectedPerson?.id]);

// In the person detail render, add:
{warrantCount > 0 && (
  <button
    type="button"
    onClick={() => navigate(`/warrants?personId=${selectedPerson.id}`)}
    className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-sm bg-red-900/50 text-red-400 border border-red-700/50 hover:bg-red-900/70 transition-colors"
  >
    <AlertTriangle className="w-3 h-3" />
    {warrantCount} ACTIVE WARRANT{warrantCount !== 1 ? 'S' : ''}
  </button>
)}
```

**Step 6c: Add warrant badge in DispatchPage call detail**

In `client/src/pages/dispatch/DispatchPage.tsx`, where person names appear in the call detail panel, add the existing `WarrantBadge` component (already imported in some pages). Find where involved persons are listed and add:

```tsx
<WarrantBadge personId={person.id} onClick={() => navigate(`/warrants?personId=${person.id}`)} />
```

The `WarrantBadge` component at `client/src/components/WarrantBadge.tsx` already handles fetching and displaying — check if it accepts a `personId` prop or if it needs the flags passed in. Adapt accordingly.

**Step 6d: Same treatment in MdtPage**

Follow the same pattern as DispatchPage for `client/src/pages/MdtPage.tsx`.

**Step 6e: Commit**

```bash
git add client/src/pages/WarrantsPage.tsx client/src/pages/records/PersonsTab.tsx \
  client/src/pages/dispatch/DispatchPage.tsx client/src/pages/MdtPage.tsx
git commit -m "feat: add cross-module warrant navigation links and badges"
```

---

## Task 7: Build and Verify

**Step 1: Build client**

```bash
cd client && npx vite build
```

Expected: Clean build with no TypeScript errors.

**Step 2: Fix any build errors**

Address any type errors or import issues. Common ones:
- Missing imports for `useNavigate`
- Type mismatches on new interface fields
- Any `google.maps` type references need `/// <reference types="google.maps" />`

**Step 3: Verify server starts**

```bash
cd server && npx tsx src/index.ts
```

Verify the new endpoints respond:
```bash
curl -s http://localhost:3001/api/health
```

**Step 4: Final commit**

```bash
git add -A
git commit -m "fix: resolve build errors from warrant enhancement"
```

---

## Execution Order Summary

| Task | Area | Est. Complexity | Dependencies |
|------|------|----------------|--------------|
| 1 | Server endpoints | Medium | None |
| 2 | Unified search tab | Large | Task 1 |
| 3 | Watch list cards | Medium | Task 1 (enhanced auto-poll) |
| 4 | Watch list map | Small | Task 3 |
| 5 | PDF generation | Large | Task 3 (BOLO uses watch data) |
| 6 | Cross-module links | Small | None (can parallel with 2-5) |
| 7 | Build & verify | Small | All above |

Tasks 1 and 6 can run in parallel. Tasks 2, 3, 4, 5 are sequential. Task 7 is final.
