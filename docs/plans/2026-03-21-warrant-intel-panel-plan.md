# Warrant Intelligence Panel Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the Utah Search tab with a unified Person Intelligence Panel that searches Utah warrants, court records, and local warrants in one query; add severity badges + dispatch linking to Watch Hits; add real-time warrant-hit banners to Dispatch and MDT pages.

**Architecture:** New `POST /api/warrants/person-intel` endpoint runs Utah warrants, court records, and local DB queries in parallel, returning a unified `PersonIntelResult[]` with per-result identity confidence scoring. Frontend replaces the `utah_search` tab content with a new `PersonIntelPanel` component. Watch Hits tab gets severity inference + call-link button. `DispatchPage` and `MdtPage` get a persistent `WarrantAlertBanner` component wired to the existing `call:warrant_alert` WebSocket event.

**Tech Stack:** Express 4 + TypeScript + better-sqlite3 (server); React 18 + TypeScript + Tailwind (client); existing `searchUtahWarrantsLive`, `searchCourtRecords` utilities; existing `call:warrant_alert` WebSocket broadcast.

---

## Task 1: Backend — `POST /api/warrants/person-intel` endpoint

**Files:**
- Modify: `server/src/routes/warrants.ts` (add after line 270, before the WARRANT WATCH section)

**Context:** The server already exports `searchUtahWarrantsLive` (utahWarrantScraper.ts:267) and `searchCourtRecords` (courtRecordsScraper.ts:360). The `warrants` and `persons` tables are queryable via `getDb()`.

**Step 1: Add the endpoint**

Insert after the `POST /utah/unblock` handler (after line 270) in `server/src/routes/warrants.ts`:

```typescript
// POST /api/warrants/person-intel — Unified person intelligence search
router.post('/person-intel', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (req: Request, res: Response) => {
  try {
    const { firstName, lastName, dob } = req.body;
    if (!firstName?.trim() || !lastName?.trim()) {
      res.status(400).json({ error: 'firstName and lastName are required' });
      return;
    }
    const first = String(firstName).trim().toUpperCase();
    const last = String(lastName).trim().toUpperCase();
    const db = getDb();

    // Run all three sources in parallel
    const [utahRaw, courtRaw] = await Promise.all([
      searchUtahWarrantsLive(first, last).catch(() => null),
      searchCourtRecords(`${first} ${last}`).catch(() => []),
    ]);

    // Local person match
    const localPersons = db.prepare(`
      SELECT id, first_name, last_name, dob, city
      FROM persons
      WHERE UPPER(first_name) = ? AND UPPER(last_name) = ?
      LIMIT 5
    `).all(first, last) as any[];

    // Group Utah results by utah_person_id
    const utahByPerson = new Map<string, any[]>();
    for (const w of (utahRaw || [])) {
      const key = w.utah_person_id;
      if (!utahByPerson.has(key)) utahByPerson.set(key, []);
      utahByPerson.get(key)!.push(w);
    }

    // Build result cards — one per distinct Utah person + one for local-only matches
    const seenPersonIds = new Set<string>();
    const results: any[] = [];

    for (const [personId, warrants] of utahByPerson) {
      seenPersonIds.add(personId);
      const sample = warrants[0];
      const matchedLocal = localPersons.find(p => {
        if (dob && p.dob) return p.dob === dob;
        if (sample.city && p.city) return p.city.toUpperCase() === sample.city.toUpperCase();
        return false;
      }) || null;

      // Confidence scoring
      let score = 0;
      const factors: string[] = ['name match'];
      if (dob && matchedLocal?.dob === dob) { score += 2; factors.push('DOB match'); }
      if (sample.city && matchedLocal?.city?.toUpperCase() === sample.city.toUpperCase()) { score += 1; factors.push('city match'); }
      const confidence = score >= 2 ? 'high' : score === 1 ? 'medium' : 'low';

      // Local warrants for matched person
      const localWarrants = matchedLocal
        ? db.prepare(`SELECT * FROM warrants WHERE subject_person_id = ? AND archived_at IS NULL ORDER BY created_at DESC LIMIT 20`).all(matchedLocal.id)
        : [];

      // Court records — filter by name similarity
      const personCourt = (courtRaw as any[] || []).filter((cr: any) =>
        (cr.defendant_name || '').toUpperCase().includes(last)
      );

      results.push({
        utahPersonId: personId,
        searchName: `${sample.first_name} ${sample.middle_name || ''} ${sample.last_name}`.trim(),
        age: sample.age,
        city: sample.city,
        localPersonMatch: matchedLocal ? { id: matchedLocal.id, name: `${matchedLocal.first_name} ${matchedLocal.last_name}`, dob: matchedLocal.dob } : null,
        identityConfidence: confidence,
        confidenceFactors: factors,
        utahWarrants: warrants,
        courtRecords: personCourt,
        localWarrants,
        watchHistory: [],
      });
    }

    // Sort: high confidence first
    const order = { high: 0, medium: 1, low: 2 };
    results.sort((a, b) => order[a.identityConfidence as keyof typeof order] - order[b.identityConfidence as keyof typeof order]);

    res.json({ results, apiAvailable: !isUtahApiBlocked(), utahNull: utahRaw === null });
  } catch (error: any) {
    console.error('Person intel error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

**Step 2: Add missing import**

`searchUtahWarrantsLive` needs to be imported. At the top of `warrants.ts`, the existing import is:
```typescript
import { searchUtahWarrants, searchUtahWarrantsCache, getUtahWarrantSyncStatus, runWarrantWatchScan, isUtahApiBlocked, clearUtahApiBlock } from '../utils/utahWarrantScraper';
```

Add `searchUtahWarrantsLive` to that import:
```typescript
import { searchUtahWarrants, searchUtahWarrantsLive, searchUtahWarrantsCache, getUtahWarrantSyncStatus, runWarrantWatchScan, isUtahApiBlocked, clearUtahApiBlock } from '../utils/utahWarrantScraper';
```

**Step 3: TypeScript check**
```bash
cd server && npx tsc --noEmit
```
Expected: no errors.

**Step 4: Commit**
```bash
git add server/src/routes/warrants.ts
git commit -m "feat(warrants): add POST /person-intel unified intelligence endpoint"
```

---

## Task 2: Backend — `POST /api/warrants/ingest-utah` endpoint

**Files:**
- Modify: `server/src/routes/warrants.ts` (add after the person-intel endpoint)

**Context:** The `warrants` table has `source`, `external_warrant_id` columns (added in the March 16 redesign). The POST `/` warrant creation handler (line 625) shows the full insert pattern to follow.

**Step 1: Add ingest endpoint**

Insert after the person-intel handler:

```typescript
// POST /api/warrants/ingest-utah — Create local warrant record from a Utah API hit
router.post('/ingest-utah', requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { utah_warrant_id, utah_person_id, first_name, last_name, court_name, case_id, charges, issue_date, age, city, subject_person_id } = req.body;

    if (!utah_warrant_id || !last_name) {
      res.status(400).json({ error: 'utah_warrant_id and last_name are required' });
      return;
    }

    // Deduplicate — return existing if already ingested
    const existing = db.prepare('SELECT id, warrant_number FROM warrants WHERE external_warrant_id = ?').get(utah_warrant_id) as any;
    if (existing) {
      res.json({ id: existing.id, warrant_number: existing.warrant_number, duplicate: true });
      return;
    }

    // Generate warrant number
    const year = new Date().getFullYear();
    const lastRow = db.prepare(`SELECT warrant_number FROM warrants WHERE warrant_number LIKE 'EXT-${year}-%' ORDER BY id DESC LIMIT 1`).get() as any;
    const seq = lastRow ? (parseInt(lastRow.warrant_number.split('-')[2], 10) + 1) : 1;
    const warrantNumber = `EXT-${year}-${String(seq).padStart(5, '0')}`;

    // Parse charges
    let chargesArr: string[] = [];
    try { chargesArr = typeof charges === 'string' ? JSON.parse(charges) : (charges || []); } catch { chargesArr = []; }
    const chargeText = chargesArr.join('; ') || 'See Utah warrant record';

    // Infer offense level from charge text
    const lower = chargeText.toLowerCase();
    const offenseLevel = /felony|f[123]/.test(lower) ? 'felony'
      : /misdemeanor|class [abc]/.test(lower) ? 'misdemeanor'
      : null;

    const now = localNow();
    const result = db.prepare(`
      INSERT INTO warrants (
        warrant_number, type, status, subject_person_id,
        subject_first_name, subject_last_name,
        issuing_court, case_id,
        charge_description, offense_level,
        issue_date, source, external_warrant_id,
        entered_by, created_at, updated_at
      ) VALUES (?, 'arrest', 'active', ?, ?, ?, ?, ?, ?, ?, ?, 'utah_api', ?, ?, ?, ?)
    `).run(
      warrantNumber, subject_person_id || null, first_name || null, last_name,
      court_name || null, case_id || null,
      chargeText, offenseLevel,
      issue_date || null, utah_warrant_id,
      req.user!.userId, now, now
    );

    broadcast('warrants', 'warrant:created', { id: result.lastInsertRowid, warrant_number: warrantNumber, source: 'utah_api' });
    auditLog(req, 'warrant_created', 'warrant', result.lastInsertRowid, `Ingested from Utah API: ${utah_warrant_id}`);

    res.status(201).json({ id: result.lastInsertRowid, warrant_number: warrantNumber, duplicate: false });
  } catch (error: any) {
    console.error('Ingest Utah warrant error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

**Step 2: TypeScript check**
```bash
cd server && npx tsc --noEmit
```

**Step 3: Commit**
```bash
git add server/src/routes/warrants.ts
git commit -m "feat(warrants): add POST /ingest-utah — create local record from Utah hit"
```

---

## Task 3: Backend — Severity inference in `GET /watch/log`

**Files:**
- Modify: `server/src/routes/warrants.ts` — `GET /watch/log` handler (lines 276–319)

**Context:** The watch/log query currently JOINs `warrant_watch_log` with `persons`. The `warrant_watch_log` table has a `charges` text field (JSON array). We need to add `resolvedSeverity` to each row in the response.

**Step 1: Add severity inference function**

Add this helper near the top of `warrants.ts` (after the router definition, around line 32):

```typescript
function inferSeverity(chargesJson: string | null, offenseLevel: string | null): 'felony' | 'misdemeanor' | 'bench' | 'civil' | null {
  if (offenseLevel) return offenseLevel as any;
  if (!chargesJson) return null;
  let text = '';
  try { text = JSON.parse(chargesJson).join(' ').toLowerCase(); } catch { text = chargesJson.toLowerCase(); }
  if (/felony|f[123]\b/.test(text)) return 'felony';
  if (/bench/.test(text)) return 'bench';
  if (/misdemeanor|class [abc]\b/.test(text)) return 'misdemeanor';
  if (/civil/.test(text)) return 'civil';
  return null;
}
```

**Step 2: Map severity onto rows in the watch/log response**

In the `GET /watch/log` handler, change the final `res.json(...)` from:
```typescript
res.json({
  data: rows,
  pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
});
```
to:
```typescript
res.json({
  data: (rows as any[]).map(r => ({
    ...r,
    resolvedSeverity: inferSeverity(r.charges, r.offense_level),
  })),
  pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
});
```

**Step 3: TypeScript check + commit**
```bash
cd server && npx tsc --noEmit
git add server/src/routes/warrants.ts
git commit -m "feat(warrants): add resolvedSeverity to watch/log response"
```

---

## Task 4: New component — `WarrantAlertBanner.tsx`

**Files:**
- Create: `client/src/components/WarrantAlertBanner.tsx`

**Context:** Both `DispatchPage` and `MdtPage` need the same persistent red banner when `call:warrant_alert` fires. Extract it as a shared component. The existing `DispatchPage` already subscribes at line 635 and uses `addToast` — the banner replaces that with a persistent overlay.

**Step 1: Create the component**

```tsx
// client/src/components/WarrantAlertBanner.tsx
import React from 'react';
import { AlertTriangle, X, ExternalLink } from 'lucide-react';

export interface WarrantAlert {
  id: string;
  callId?: number | string;
  callNumber?: string;
  personName: string;
  severity: 'felony' | 'misdemeanor' | 'bench' | 'civil' | null;
  charge?: string;
  source?: string;
  receivedAt: number;
}

const SEVERITY_STYLES: Record<string, string> = {
  felony: 'bg-red-950 border-red-700 text-red-200',
  misdemeanor: 'bg-amber-950 border-amber-700 text-amber-200',
  bench: 'bg-orange-950 border-orange-700 text-orange-200',
  civil: 'bg-blue-950 border-blue-700 text-blue-200',
};

interface Props {
  alerts: WarrantAlert[];
  onDismiss: (id: string) => void;
  onViewCall?: (callId: number | string) => void;
}

export default function WarrantAlertBanner({ alerts, onDismiss, onViewCall }: Props) {
  if (alerts.length === 0) return null;

  return (
    <div className="fixed top-[120px] right-4 z-[200] flex flex-col gap-2 max-w-sm">
      {alerts.map(alert => (
        <div
          key={alert.id}
          className={`flex items-start gap-3 p-3 rounded border text-sm shadow-xl ${SEVERITY_STYLES[alert.severity || ''] || 'bg-red-950 border-red-700 text-red-200'}`}
        >
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 animate-pulse" />
          <div className="flex-1 min-w-0">
            <div className="font-bold font-mono text-xs uppercase tracking-wider">
              ⚠ WARRANT HIT {alert.severity ? `— ${alert.severity.toUpperCase()}` : ''}
            </div>
            <div className="font-semibold truncate">{alert.personName}</div>
            {alert.charge && <div className="text-xs opacity-75 truncate">{alert.charge}</div>}
            {alert.callNumber && <div className="text-xs opacity-60">Call: {alert.callNumber}</div>}
          </div>
          <div className="flex flex-col gap-1 shrink-0">
            {onViewCall && alert.callId != null && (
              <button
                onClick={() => onViewCall(alert.callId!)}
                className="text-xs underline opacity-75 hover:opacity-100 flex items-center gap-1"
              >
                <ExternalLink className="w-3 h-3" /> View
              </button>
            )}
            <button onClick={() => onDismiss(alert.id)} className="text-xs opacity-60 hover:opacity-100">
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
```

**Step 2: Commit**
```bash
git add client/src/components/WarrantAlertBanner.tsx
git commit -m "feat(warrants): add WarrantAlertBanner shared component"
```

---

## Task 5: Wire `WarrantAlertBanner` into `DispatchPage`

**Files:**
- Modify: `client/src/pages/dispatch/DispatchPage.tsx`

**Context:** `DispatchPage` already subscribes to `call:warrant_alert` at line 635–640 using `addToast`. Replace that with the persistent banner. The component uses `useWebSocket` (already imported via the try/catch handlers from the previous session's fixes).

**Step 1: Add import at top of DispatchPage**

Find the existing imports block and add:
```tsx
import WarrantAlertBanner, { type WarrantAlert } from '../../components/WarrantAlertBanner';
```

**Step 2: Add state near other useState declarations (around line 130)**
```tsx
const [warrantAlerts, setWarrantAlerts] = useState<WarrantAlert[]>([]);
```

**Step 3: Replace existing `call:warrant_alert` subscription (lines 635–640)**

Replace:
```tsx
    // Listen for warrant alerts on linked persons
    const unsubWarrant = subscribe('call:warrant_alert', (msg: any) => {
      try {
        const data = msg.data || msg;
        addToast(`⚠️ WARRANT ALERT: ${data.personName} — ${data.warrantCount} active warrant(s) on call`, 'error');
        // Refresh data so warrant badges appear immediately
```

With:
```tsx
    // Listen for warrant alerts — show persistent banner
    const unsubWarrant = subscribe('call:warrant_alert', (msg: any) => {
      try {
        const data = msg.data || msg;
        const alert: WarrantAlert = {
          id: `${Date.now()}-${Math.random()}`,
          callId: data.callId,
          callNumber: data.callNumber,
          personName: data.personName || 'Unknown',
          severity: data.severity || null,
          charge: data.charge || data.warrantType || null,
          source: data.source || null,
          receivedAt: Date.now(),
        };
        setWarrantAlerts(prev => [alert, ...prev].slice(0, 5)); // cap at 5
```

Keep the existing `fetchData()` call and closing braces intact — only replace the `addToast` line and add the alert state update.

**Step 4: Render the banner**

In the DispatchPage return JSX, just before the outermost closing `</div>`, add:
```tsx
<WarrantAlertBanner
  alerts={warrantAlerts}
  onDismiss={id => setWarrantAlerts(prev => prev.filter(a => a.id !== id))}
  onViewCall={callId => {
    const call = calls.find(c => c.id === callId || String(c.id) === String(callId));
    if (call) setSelectedCall(call);
  }}
/>
```

**Step 5: TypeScript check + commit**
```bash
cd client && npx tsc --noEmit
git add client/src/pages/dispatch/DispatchPage.tsx
git commit -m "feat(dispatch): add persistent WarrantAlertBanner on call:warrant_alert"
```

---

## Task 6: Wire `WarrantAlertBanner` into `MdtPage`

**Files:**
- Modify: `client/src/pages/MdtPage.tsx`

**Context:** `MdtPage` imports `useWebSocket` at line 33 and calls `subscribe` at line 415. The page does NOT currently handle `call:warrant_alert` at all.

**Step 1: Add import**
```tsx
import WarrantAlertBanner, { type WarrantAlert } from '../components/WarrantAlertBanner';
```

**Step 2: Add state (near other useState calls)**
```tsx
const [warrantAlerts, setWarrantAlerts] = useState<WarrantAlert[]>([]);
```

**Step 3: Add subscription inside the existing `useEffect` that calls `subscribe` (around line 415)**

After the existing `subscribe` calls, add:
```tsx
    const unsubWarrant = subscribe('call:warrant_alert', (msg: any) => {
      try {
        const data = msg.data || msg;
        const alert: WarrantAlert = {
          id: `${Date.now()}-${Math.random()}`,
          callId: data.callId,
          callNumber: data.callNumber,
          personName: data.personName || 'Unknown',
          severity: data.severity || null,
          charge: data.charge || data.warrantType || null,
          source: data.source || null,
          receivedAt: Date.now(),
        };
        setWarrantAlerts(prev => [alert, ...prev].slice(0, 5));
      } catch {}
    });
```

Add `unsubWarrant` to the cleanup return alongside the other unsub calls.

**Step 4: Render banner in MdtPage JSX**

Just before the outermost closing `</div>` of the return:
```tsx
<WarrantAlertBanner
  alerts={warrantAlerts}
  onDismiss={id => setWarrantAlerts(prev => prev.filter(a => a.id !== id))}
/>
```

**Step 5: TypeScript check + commit**
```bash
cd client && npx tsc --noEmit
git add client/src/pages/MdtPage.tsx
git commit -m "feat(mdt): add persistent WarrantAlertBanner on call:warrant_alert"
```

---

## Task 7: New component — `PersonIntelPanel.tsx`

**Files:**
- Create: `client/src/components/PersonIntelPanel.tsx`

**Context:** This replaces the utah_search tab content entirely. It calls `POST /api/warrants/person-intel` and renders stacked collapsible result cards. Extracted as its own component to keep WarrantsPage manageable. Uses `apiFetch` from `../hooks/useApi`.

**Step 1: Create the component**

```tsx
// client/src/components/PersonIntelPanel.tsx
import React, { useState, useCallback } from 'react';
import { Search, Loader2, User, AlertTriangle, ChevronDown, ChevronRight, Plus, ExternalLink } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { formatDate } from '../utils/dateUtils';

interface UtahWarrant {
  utah_warrant_id: string;
  court_name: string | null;
  case_id: string | null;
  charges: string | null;
  issue_date: string | null;
  bail_amount?: number | null;
}

interface CourtRecord {
  case_number: string;
  court_name: string;
  case_type: string;
  filing_date: string;
  disposition: string;
  disposition_date: string;
  charges?: string;
  defendant_name?: string;
}

interface PersonIntelResult {
  utahPersonId: string | null;
  searchName: string;
  age: number | null;
  city: string | null;
  localPersonMatch: { id: number; name: string; dob: string | null } | null;
  identityConfidence: 'high' | 'medium' | 'low';
  confidenceFactors: string[];
  utahWarrants: UtahWarrant[];
  courtRecords: CourtRecord[];
  localWarrants: any[];
  watchHistory: any[];
}

const CONFIDENCE_STYLES = {
  high: 'text-green-400 border-green-700/40 bg-green-950/20',
  medium: 'text-amber-400 border-amber-700/40 bg-amber-950/20',
  low: 'text-rmpg-400 border-rmpg-700/20 bg-transparent',
};

const CONFIDENCE_BAR = { high: '100%', medium: '60%', low: '30%' };

const DISPOSITION_STYLES: Record<string, string> = {
  active: 'bg-red-900/40 text-red-300 border-red-800/40',
  pending: 'bg-amber-900/40 text-amber-300 border-amber-800/40',
  closed: 'bg-rmpg-700/20 text-rmpg-400 border-rmpg-700/20',
  convicted: 'bg-orange-900/40 text-orange-300 border-orange-800/40',
  dismissed: 'bg-rmpg-700/20 text-rmpg-400 border-rmpg-700/20',
};

function dispositionStyle(d: string): string {
  return DISPOSITION_STYLES[d?.toLowerCase()] || 'bg-rmpg-700/20 text-rmpg-400 border-rmpg-700/20';
}

interface Props {
  apiAvailable: boolean;
  onNavigatePerson?: (personId: number) => void;
}

export default function PersonIntelPanel({ apiAvailable, onNavigatePerson }: Props) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dob, setDob] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<PersonIntelResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [ingestingIds, setIngestingIds] = useState<Set<string>>(new Set());
  const [ingestedIds, setIngestedIds] = useState<Set<string>>(new Set());

  const search = useCallback(async () => {
    if (!firstName.trim() || !lastName.trim()) return;
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const res = await apiFetch<{ results: PersonIntelResult[]; apiAvailable: boolean; utahNull: boolean }>(
        '/warrants/person-intel',
        { method: 'POST', body: JSON.stringify({ firstName: firstName.trim(), lastName: lastName.trim(), dob: dob.trim() || undefined }) }
      );
      setResults(res.results || []);
      if (res.results?.length > 0) {
        // Auto-expand the highest-confidence result
        setExpanded(new Set([res.results[0].utahPersonId || res.results[0].searchName]));
      }
    } catch (err: any) {
      setError(err.message || 'Search failed');
    } finally {
      setLoading(false);
    }
  }, [firstName, lastName, dob]);

  const toggleExpand = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const ingestWarrant = async (result: PersonIntelResult, warrant: UtahWarrant) => {
    const key = warrant.utah_warrant_id;
    setIngestingIds(prev => new Set(prev).add(key));
    try {
      await apiFetch('/warrants/ingest-utah', {
        method: 'POST',
        body: JSON.stringify({
          utah_warrant_id: warrant.utah_warrant_id,
          utah_person_id: result.utahPersonId,
          first_name: result.searchName.split(' ')[0],
          last_name: result.searchName.split(' ').pop(),
          court_name: warrant.court_name,
          case_id: warrant.case_id,
          charges: warrant.charges,
          issue_date: warrant.issue_date,
          age: result.age,
          city: result.city,
          subject_person_id: result.localPersonMatch?.id || null,
        }),
      });
      setIngestedIds(prev => new Set(prev).add(key));
    } catch {} finally {
      setIngestingIds(prev => { const s = new Set(prev); s.delete(key); return s; });
    }
  };

  const ingestAll = async (result: PersonIntelResult) => {
    for (const w of result.utahWarrants) {
      if (!ingestedIds.has(w.utah_warrant_id)) await ingestWarrant(result, w);
    }
  };

  const parseCharges = (charges: string | null): string[] => {
    try { return JSON.parse(charges || '[]'); } catch { return charges ? [charges] : []; }
  };

  return (
    <div className="p-4 space-y-4">
      {/* Search bar */}
      <div className="flex flex-wrap gap-2">
        <input
          className="input-dark w-32"
          placeholder="First name"
          value={firstName}
          onChange={e => setFirstName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && search()}
        />
        <input
          className="input-dark w-40"
          placeholder="Last name"
          value={lastName}
          onChange={e => setLastName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && search()}
        />
        <input
          className="input-dark w-32"
          placeholder="DOB (optional)"
          value={dob}
          onChange={e => setDob(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && search()}
        />
        <button
          onClick={search}
          disabled={loading || !firstName.trim() || !lastName.trim()}
          className="toolbar-btn-primary px-4"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          <span className="ml-1">{loading ? 'Searching...' : 'Search'}</span>
        </button>
      </div>

      {/* API status */}
      <div className="flex items-center gap-2 text-[10px] font-mono text-rmpg-400">
        <span className={`led-dot ${apiAvailable ? 'led-green' : 'led-red'}`} />
        <span>warrants.utah.gov: {apiAvailable ? 'ONLINE' : 'OFFLINE'}</span>
      </div>

      {error && <div className="panel-inset p-3 text-red-400 text-sm">{error}</div>}

      {/* Results */}
      {results !== null && results.length === 0 && (
        <div className="panel-inset p-6 text-center text-rmpg-400 text-sm">No results found for {firstName} {lastName}</div>
      )}

      {results?.map((r, idx) => {
        const key = r.utahPersonId || r.searchName;
        const isOpen = expanded.has(key);
        const isHighConf = r.identityConfidence === 'high';
        const isLowConf = r.identityConfidence === 'low';

        // Low-confidence results after index 0 collapse by default and show a reveal button
        if (isLowConf && idx > 0 && !isOpen) {
          return (
            <button key={key} onClick={() => toggleExpand(key)} className="w-full text-left panel-inset p-2 text-[11px] text-rmpg-400 hover:text-white">
              <ChevronRight className="w-3 h-3 inline mr-1" />
              {r.searchName} · {r.identityConfidence} confidence · {r.utahWarrants.length} warrant(s)
            </button>
          );
        }

        return (
          <div key={key} className={`panel-raised rounded-sm border ${isHighConf ? 'border-green-800/30' : 'border-rmpg-700/30'}`}>
            {/* Card header */}
            <button
              onClick={() => toggleExpand(key)}
              className="w-full flex items-center justify-between p-3 hover:bg-white/5"
            >
              <div className="flex items-center gap-3">
                <User className="w-4 h-4 text-rmpg-400 shrink-0" />
                <div className="text-left">
                  <div className="font-bold text-white text-sm">{r.searchName}</div>
                  <div className="text-[11px] text-rmpg-400">
                    {[r.age ? `Age ${r.age}` : null, r.city].filter(Boolean).join(' · ')}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {/* Confidence indicator */}
                <div className={`text-[10px] font-mono px-2 py-0.5 rounded border ${CONFIDENCE_STYLES[r.identityConfidence]}`}>
                  <div className="flex items-center gap-1.5">
                    <div className="w-16 h-1 bg-rmpg-800 rounded">
                      <div className={`h-full rounded ${r.identityConfidence === 'high' ? 'bg-green-500' : r.identityConfidence === 'medium' ? 'bg-amber-500' : 'bg-rmpg-500'}`}
                        style={{ width: CONFIDENCE_BAR[r.identityConfidence] }} />
                    </div>
                    {r.identityConfidence.toUpperCase()}
                  </div>
                </div>
                {isOpen ? <ChevronDown className="w-4 h-4 text-rmpg-400" /> : <ChevronRight className="w-4 h-4 text-rmpg-400" />}
              </div>
            </button>

            {isOpen && (
              <div className="border-t border-rmpg-700/30 p-3 space-y-4">
                {/* Confidence factors + local person link */}
                <div className="flex items-center justify-between">
                  <div className="text-[10px] text-rmpg-400">
                    Match factors: <span className="text-white">{r.confidenceFactors.join(', ')}</span>
                  </div>
                  {r.localPersonMatch && (
                    <button
                      onClick={() => onNavigatePerson?.(r.localPersonMatch!.id)}
                      className="toolbar-btn text-[10px] flex items-center gap-1"
                    >
                      <ExternalLink className="w-3 h-3" />
                      VIEW PERSON — {r.localPersonMatch.name}
                    </button>
                  )}
                </div>

                {/* Utah Warrants */}
                {r.utahWarrants.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-[11px] font-mono text-rmpg-300 uppercase tracking-wider">
                        Utah Warrants ({r.utahWarrants.length})
                      </div>
                      <button
                        onClick={() => ingestAll(r)}
                        className="toolbar-btn-primary text-[10px] flex items-center gap-1"
                      >
                        <Plus className="w-3 h-3" /> INGEST ALL
                      </button>
                    </div>
                    <div className="space-y-2">
                      {r.utahWarrants.map(w => {
                        const charges = parseCharges(w.charges);
                        const isIngesting = ingestingIds.has(w.utah_warrant_id);
                        const isIngested = ingestedIds.has(w.utah_warrant_id);
                        return (
                          <div key={w.utah_warrant_id} className="panel-inset p-2.5 rounded-sm border border-red-900/20">
                            <div className="flex items-start justify-between gap-2">
                              <div className="space-y-1 flex-1">
                                <div className="flex flex-wrap gap-1">
                                  {charges.map((c, ci) => (
                                    <span key={ci} className="inline-block bg-red-900/30 text-red-300 text-[10px] px-1.5 py-0.5 rounded border border-red-800/30">{c}</span>
                                  ))}
                                </div>
                                <div className="text-[10px] text-rmpg-400 font-mono space-x-3">
                                  {w.court_name && <span>{w.court_name}</span>}
                                  {w.case_id && <span>Case: {w.case_id}</span>}
                                  {w.issue_date && <span>Issued: {formatDate(w.issue_date)}</span>}
                                  {w.bail_amount != null && <span className="text-amber-400">Bail: ${w.bail_amount.toLocaleString()}</span>}
                                </div>
                              </div>
                              <button
                                onClick={() => ingestWarrant(r, w)}
                                disabled={isIngesting || isIngested}
                                className={`toolbar-btn text-[10px] shrink-0 ${isIngested ? 'text-green-400' : ''}`}
                              >
                                {isIngesting ? <Loader2 className="w-3 h-3 animate-spin" /> : isIngested ? '✓ SAVED' : <><Plus className="w-3 h-3" /> SAVE</>}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Court Records */}
                {r.courtRecords.length > 0 && (
                  <div>
                    <div className="text-[11px] font-mono text-rmpg-300 uppercase tracking-wider mb-2">
                      Court Records ({r.courtRecords.length})
                    </div>
                    <div className="space-y-2">
                      {r.courtRecords.map((cr, ci) => (
                        <div key={ci} className="panel-inset p-2.5 rounded-sm border border-rmpg-700/20">
                          <div className="flex items-start justify-between gap-2">
                            <div className="space-y-0.5 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-mono text-[10px] text-white">{cr.case_number}</span>
                                <span className="text-[10px] text-rmpg-400">{cr.court_name}</span>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded border ${dispositionStyle(cr.disposition)}`}>
                                  {(cr.disposition || 'UNKNOWN').toUpperCase()}
                                </span>
                              </div>
                              {cr.charges && <div className="text-[10px] text-rmpg-300">{cr.charges}</div>}
                              <div className="text-[10px] text-rmpg-400 font-mono space-x-3">
                                {cr.filing_date && <span>Filed: {formatDate(cr.filing_date)}</span>}
                                {cr.disposition_date && cr.disposition !== 'pending' && <span>Closed: {formatDate(cr.disposition_date)}</span>}
                              </div>
                            </div>
                            {/* Confidence badge */}
                            <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border shrink-0 ${CONFIDENCE_STYLES[r.identityConfidence]}`}>
                              {r.identityConfidence.toUpperCase()}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Watch History */}
                {r.watchHistory.length > 0 && (
                  <div>
                    <div className="text-[11px] font-mono text-rmpg-300 uppercase tracking-wider mb-1">Watch History</div>
                    {r.watchHistory.map((h, hi) => (
                      <div key={hi} className="text-[10px] text-rmpg-400">
                        {formatDate(h.created_at)} · {h.event} via {h.source || 'scanner'}
                      </div>
                    ))}
                  </div>
                )}

                {r.utahWarrants.length === 0 && r.courtRecords.length === 0 && r.localWarrants.length === 0 && (
                  <div className="text-[11px] text-rmpg-400 text-center py-2">No warrants or court records found for this person</div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

**Step 2: TypeScript check**
```bash
cd client && npx tsc --noEmit
```

**Step 3: Commit**
```bash
git add client/src/components/PersonIntelPanel.tsx
git commit -m "feat(warrants): add PersonIntelPanel component"
```

---

## Task 8: Wire `PersonIntelPanel` into `WarrantsPage`

**Files:**
- Modify: `client/src/pages/WarrantsPage.tsx`

**Context:** The `utah_search` tab content starts at line 1640 (the `{activeTab === 'utah_search' && (` block). Replace its content with `<PersonIntelPanel>`. The `utahSyncStatus` state is already fetched when this tab is active (line 679).

**Step 1: Add import near top of WarrantsPage**
```tsx
import PersonIntelPanel from '../components/PersonIntelPanel';
```

**Step 2: Replace the entire `{activeTab === 'utah_search' && (...)}` block**

Find:
```tsx
      {activeTab === 'utah_search' && (
        <div className="p-4 space-y-4">
          {/* Search bar */}
          ...
        </div>
      )}
```

Replace with:
```tsx
      {activeTab === 'utah_search' && (
        <PersonIntelPanel
          apiAvailable={utahSyncStatus?.apiAvailable ?? true}
          onNavigatePerson={personId => {
            // Navigate to the persons records page filtered to this person
            window.location.href = `/records?person=${personId}`;
          }}
        />
      )}
```

**Step 3: Remove now-unused state variables** (they were only used in the old utah_search tab content):
- `utahSearchQuery` / `setUtahSearchQuery`
- `utahSearchResults` / `setUtahSearchResults`
- `utahSearching` / `setUtahSearching`
- `utahSource` / `setUtahSource`
- `searchUtah` callback

Keep `utahSyncStatus` — it's still used by `PersonIntelPanel` via the prop.

**Step 4: TypeScript check**
```bash
cd client && npx tsc --noEmit
```

**Step 5: Commit**
```bash
git add client/src/pages/WarrantsPage.tsx
git commit -m "feat(warrants): wire PersonIntelPanel into WarrantsPage utah_search tab"
```

---

## Task 9: Watch Hits severity badges + link-to-call button

**Files:**
- Modify: `client/src/pages/WarrantsPage.tsx` — the `watch_hits` tab render section

**Context:** `watchHits` rows now include `resolvedSeverity` (added in Task 3). The watch hits tab renders around line 1750+. Find the `{activeTab === 'watch_hits' && (...)}` block.

**Step 1: Add severity badge helper near the top of WarrantsPage (after imports)**
```tsx
const SEVERITY_BADGE: Record<string, string> = {
  felony: 'bg-red-900/40 text-red-300 border-red-800/40',
  misdemeanor: 'bg-amber-900/40 text-amber-300 border-amber-800/40',
  bench: 'bg-orange-900/40 text-orange-300 border-orange-800/40',
  civil: 'bg-blue-900/40 text-blue-300 border-blue-800/40',
};
```

**Step 2: Add link-to-call state + handler**

Near the other Watch Hits state (around line 453):
```tsx
const [linkCallTarget, setLinkCallTarget] = useState<any | null>(null); // watch hit being linked
const [openCalls, setOpenCalls] = useState<any[]>([]);
const [linkingId, setLinkingId] = useState<number | null>(null);
```

Add fetch for open calls when link picker opens:
```tsx
const fetchOpenCalls = useCallback(async () => {
  try {
    const res = await apiFetch<any>('/dispatch/calls?status=active,dispatched,enroute,onscene&per_page=50');
    setOpenCalls(res.data || []);
  } catch {}
}, []);
```

Add link-to-call handler:
```tsx
const linkHitToCall = async (hit: any, callId: number) => {
  setLinkingId(callId);
  try {
    await apiFetch(`/dispatch/calls/${callId}/notes`, {
      method: 'POST',
      body: JSON.stringify({
        content: `⚠ Warrant hit: ${hit.person_name} — ${(hit.resolvedSeverity || '').toUpperCase()} (${hit.charge_description || hit.source || 'scanner'}) via ${hit.source || 'Warrant Watch'}`,
        type: 'warrant_alert',
      }),
    });
    setLinkCallTarget(null);
  } catch {} finally {
    setLinkingId(null);
  }
};
```

**Step 3: Update watch hit rows in the JSX**

In the watch_hits tab render, find the hit row render. Add after each hit's name/person display:

```tsx
{/* Severity badge */}
{hit.resolvedSeverity && (
  <span className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${SEVERITY_BADGE[hit.resolvedSeverity] || ''}`}>
    {hit.resolvedSeverity.toUpperCase()}
  </span>
)}

{/* Link to call button */}
<button
  onClick={() => { setLinkCallTarget(hit); fetchOpenCalls(); }}
  className="toolbar-btn text-[10px]"
>
  LINK TO CALL
</button>
```

**Step 4: Add link-to-call mini-picker modal**

Just before the closing `</div>` of the page return, add:
```tsx
{linkCallTarget && (
  <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={() => setLinkCallTarget(null)}>
    <div className="panel-raised p-4 rounded-sm w-80 max-h-96 overflow-y-auto" onClick={e => e.stopPropagation()}>
      <div className="text-sm font-bold text-white mb-3">Link to Open Call</div>
      <div className="text-[11px] text-rmpg-400 mb-3">
        Warrant hit: {linkCallTarget.person_name}
      </div>
      {openCalls.length === 0 && <div className="text-[11px] text-rmpg-400">No open calls</div>}
      {openCalls.map((call: any) => (
        <button
          key={call.id}
          onClick={() => linkHitToCall(linkCallTarget, call.id)}
          disabled={linkingId === call.id}
          className="w-full text-left toolbar-btn mb-1 text-[11px]"
        >
          {call.call_number} — {call.incident_type} — {call.location_address}
        </button>
      ))}
      <button onClick={() => setLinkCallTarget(null)} className="toolbar-btn w-full mt-2 text-[11px]">Cancel</button>
    </div>
  </div>
)}
```

**Step 5: TypeScript check + commit**
```bash
cd client && npx tsc --noEmit
git add client/src/pages/WarrantsPage.tsx
git commit -m "feat(warrants): add severity badges + link-to-call to Watch Hits tab"
```

---

## Task 10: Deploy and verify

**Step 1: Full TypeScript check both sides**
```bash
cd "/Users/rmpgutah/RMPG Flex/server" && npx tsc --noEmit
cd "/Users/rmpgutah/RMPG Flex/client" && npx tsc --noEmit
```

**Step 2: Deploy**
```bash
cd "/Users/rmpgutah/RMPG Flex" && bash deploy/deploy.sh
```

**Step 3: Smoke test**
```bash
curl -sf https://rmpgutah.us/api/health
```

**Step 4: Verify person-intel endpoint responds**
```bash
# Replace TOKEN with a valid JWT from the browser dev tools
curl -s -X POST https://rmpgutah.us/api/warrants/person-intel \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"firstName":"JOHN","lastName":"SMITH"}' | python3 -m json.tool | head -30
```

Expected: `{ "results": [...], "apiAvailable": true }`

---

## Summary of Deliverables

| # | Deliverable | Files |
|---|-------------|-------|
| 1 | `/person-intel` endpoint | `server/src/routes/warrants.ts` |
| 2 | `/ingest-utah` endpoint | `server/src/routes/warrants.ts` |
| 3 | `resolvedSeverity` in watch/log | `server/src/routes/warrants.ts` |
| 4 | `WarrantAlertBanner` component | `client/src/components/WarrantAlertBanner.tsx` |
| 5 | Banner in DispatchPage | `client/src/pages/dispatch/DispatchPage.tsx` |
| 6 | Banner in MdtPage | `client/src/pages/MdtPage.tsx` |
| 7 | `PersonIntelPanel` component | `client/src/components/PersonIntelPanel.tsx` |
| 8 | Wire panel into WarrantsPage | `client/src/pages/WarrantsPage.tsx` |
| 9 | Severity + link-to-call in Watch Hits | `client/src/pages/WarrantsPage.tsx` |
| 10 | Deploy + verify | — |
