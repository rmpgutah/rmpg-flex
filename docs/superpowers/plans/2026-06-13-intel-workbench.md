# Intel v2 — Wave 2: Intel Workbench — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing Connections graph workbench intel-aware — `intel_report` nodes + `intel_report_links` edges (styled by Admiralty grade/threat), a unified timeline lens, intel in saved investigations, and consolidate the redundant old graph page.

**Architecture:** Pure integration into the existing `src/routes/connections.ts` (graph/path/search/investigations) and `client/src/pages/ConnectionsPage.tsx` (d3-force SVG workbench). The hinge is `findConnections` — it powers BOTH `buildGraph` and `findShortestPath`, so adding intel edges there lights up graph expansion AND path-finding at once. **No DB migration** (intel tables from Wave 1 mig 0104 + investigations mig 0043 already exist; investigations store generic JSON). No new dependency.

**Tech Stack:** Hono + D1 (`src/utils/db.ts`), vitest (node env), React 18 + d3-force + custom SVG rendering, Tailwind (Spillman pure-black tokens).

**Spec:** `docs/superpowers/specs/2026-06-13-intel-workbench-design.md`

---

## Redaction invariant (applies to every task)

Only `status='disseminated'` intel_reports may appear as graph nodes, search results, or timeline events. Nodes expose sanitized fields only (`report_number`, `title`, grade, `threat_level`, `handling_code`) — never `raw_narrative` or source identity.

---

## File Structure

**Create:**
- `src/utils/connectionsTimeline.ts` — pure timeline helpers (`parseNodeRefs`, `buildTimelineEvent`).
- `tests/connectionsTimeline.test.ts` — unit tests.

**Modify:**
- `src/routes/connections.ts` — `VALID_TYPES` + `loadNode` + `findConnections` (intel edges) + `/search` (intel) + new `GET /timeline`.
- `client/src/pages/ConnectionsPage.tsx` — intel node styling + detail panel + timeline panel.
- `client/src/components/ConnectionsGraphPanel.tsx` — intel on the dossier mini-graph.
- `client/src/App.tsx` — `/intel/workbench` alias + `/forensics` redirect.
- `client/src/components/Sidebar.tsx` — Intel Workbench nav entry.
- `client/public/sw.js` — bump `CACHE_NAME` v918 → v919.

---

## Task 1: Pure timeline helpers (TDD)

**Files:**
- Create: `src/utils/connectionsTimeline.ts`
- Test: `tests/connectionsTimeline.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/connectionsTimeline.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseNodeRefs, buildTimelineEvent } from '../src/utils/connectionsTimeline';

describe('parseNodeRefs', () => {
  it('parses type:id pairs', () => {
    expect(parseNodeRefs('person:1,incident:5')).toEqual([
      { type: 'person', id: 1 }, { type: 'incident', id: 5 },
    ]);
  });
  it('drops garbage, non-numeric, and non-positive ids', () => {
    expect(parseNodeRefs('person:0,bad,vehicle:x,call:9')).toEqual([
      { type: 'call', id: 9 },
    ]);
  });
  it('dedups and caps', () => {
    expect(parseNodeRefs('person:1,person:1')).toEqual([{ type: 'person', id: 1 }]);
    expect(parseNodeRefs(Array.from({ length: 100 }, (_, i) => `person:${i + 1}`).join(','), 60).length).toBe(60);
  });
  it('handles empty/undefined', () => {
    expect(parseNodeRefs('')).toEqual([]);
  });
});

describe('buildTimelineEvent', () => {
  it('maps an intel_report row to a sanitized intel event', () => {
    const ev = buildTimelineEvent('intel_report', {
      id: 3, report_number: 'INT-2026-0003', title: 'Surveillance',
      disseminated_at: '2026-06-13T07:51:35Z', source_reliability: 'B',
      info_credibility: 2, threat_level: 'high',
    });
    expect(ev).toMatchObject({ kind: 'intel', id: 3, date: '2026-06-13T07:51:35Z', status: 'DISSEMINATED' });
    expect(ev!.title).toContain('INT-2026-0003');
    expect(ev!.subtitle).toContain('B2');
    expect(ev!.subtitle).toContain('high');
  });
  it('maps an incident row using occurred_date', () => {
    const ev = buildTimelineEvent('incident', { id: 5, incident_number: 'I-1', incident_type: 'Theft', occurred_date: '2026-01-02', status: 'closed', location_address: 'Main St' });
    expect(ev).toMatchObject({ kind: 'incident', id: 5, date: '2026-01-02' });
    expect(ev!.title).toContain('Theft');
  });
  it('returns null for an undated/unknown type', () => {
    expect(buildTimelineEvent('person', { id: 1 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/connectionsTimeline.test.ts`
Expected: FAIL — cannot resolve `../src/utils/connectionsTimeline`.

- [ ] **Step 3: Implement**

Create `src/utils/connectionsTimeline.ts`:

```ts
// ============================================================
// RMPG Flex — Connections timeline pure helpers (Intel Wave 2).
// Turns the current graph's node set into a merged chronological
// stream. Pure (no D1/Hono) — tested in tests/connectionsTimeline.test.ts.
// mergeTimeline is reused from intelDossier.ts.
// ============================================================
import type { TimelineEvent } from './intelDossier';

export interface NodeRef { type: string; id: number; }

/** Parse "person:1,incident:5" → refs. Drops junk, dedups, caps. */
export function parseNodeRefs(param: string, cap = 60): NodeRef[] {
  const out: NodeRef[] = [];
  const seen = new Set<string>();
  for (const tok of String(param || '').split(',')) {
    const [type, idStr] = tok.split(':');
    const id = Number(idStr);
    if (!type || !Number.isInteger(id) || id <= 0) continue;
    const key = `${type}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type, id });
    if (out.length >= cap) break;
  }
  return out;
}

const s = (v: unknown) => (v == null ? '' : String(v));

/** Map one DB row of a dated type to a TimelineEvent (or null if undated/unknown). */
export function buildTimelineEvent(type: string, row: any): TimelineEvent | null {
  switch (type) {
    case 'incident':
      return { kind: 'incident', id: row.id, date: row.occurred_date || row.created_at || null,
        title: `${s(row.incident_number)} ${s(row.incident_type)}`.trim() || `Incident #${row.id}`,
        subtitle: s(row.location_address), status: s(row.status) };
    case 'call':
      return { kind: 'call', id: row.id, date: row.created_at || null,
        title: `${row.call_number || `CFS-${row.id}`} ${s(row.incident_type)}`.trim(),
        subtitle: s(row.location_address), status: s(row.status) };
    case 'citation':
      return { kind: 'citation', id: row.id, date: row.violation_date || null,
        title: s(row.citation_number) || `CIT-${row.id}`, subtitle: s(row.violation_description), status: s(row.status) };
    case 'warrant':
      return { kind: 'warrant', id: row.id, date: row.issued_date || null,
        title: s(row.warrant_number) || `W-${row.id}`, subtitle: s(row.charge_description), status: s(row.status) };
    case 'arrest':
      return { kind: 'arrest', id: row.id, date: row.booking_date || null,
        title: s(row.full_name) || `Arrest #${row.id}`, subtitle: s(row.charges), status: s(row.status) };
    case 'field_interview':
      return { kind: 'field_interview', id: row.id, date: row.created_at || null,
        title: s(row.fi_number) || `FI-${row.id}`, subtitle: s(row.contact_reason), status: s(row.status) };
    case 'trespass_order':
      return { kind: 'trespass_order', id: row.id, date: row.effective_date || null,
        title: s(row.order_number) || `TO-${row.id}`, subtitle: s(row.location), status: s(row.status) };
    case 'case':
      return { kind: 'case', id: row.id, date: row.created_at || null,
        title: `${s(row.case_number)} ${s(row.title)}`.trim() || `Case #${row.id}`, subtitle: s(row.case_type), status: s(row.status) };
    case 'evidence':
      return { kind: 'evidence', id: row.id, date: row.created_at || null,
        title: s(row.evidence_number) || `Evidence #${row.id}`, subtitle: s(row.description), status: s(row.status) };
    case 'intel_report':
      return { kind: 'intel', id: row.id, date: row.disseminated_at || null,
        title: `${row.report_number || `INT-${row.id}`} — ${s(row.title)}`.trim(),
        subtitle: `${s(row.source_reliability) || '?'}${s(row.info_credibility) || '?'} · ${s(row.threat_level)}`,
        status: 'DISSEMINATED' };
    default:
      return null;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/connectionsTimeline.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/utils/connectionsTimeline.ts tests/connectionsTimeline.test.ts
git commit -m "feat(intel): connections timeline pure helpers"
```

---

## Task 2: Make `connections.ts` intel-aware (node + edges + search)

**Files:**
- Modify: `src/routes/connections.ts`

- [ ] **Step 1: Add `intel_report` to `VALID_TYPES`**

Find the `VALID_TYPES` array (~line 50) and add `'intel_report'`:

```ts
const VALID_TYPES = [
  'person', 'vehicle', 'property', 'evidence', 'case', 'incident',
  'warrant', 'citation', 'arrest', 'field_interview', 'trespass_order',
  'serve_job', 'call', 'report', 'intel_report',
];
```

- [ ] **Step 2: Add the `intel_report` case to `loadNode`**

In `loadNode`'s switch, immediately before `default:`, add (disseminated-only, sanitized metadata):

```ts
      case 'intel_report': {
        const r = await queryFirst<any>(db,
          `SELECT report_number, title, source_reliability, info_credibility, handling_code, threat_level
           FROM intel_reports WHERE id = ? AND status = 'disseminated'`, id);
        if (!r) return { label: `Intel #${id}`, metadata: {} };
        const grade = (r.source_reliability && r.info_credibility) ? `${r.source_reliability}${r.info_credibility}` : '';
        return {
          label: `${r.report_number || `INT-${id}`} — ${r.title || ''}`.trim(),
          metadata: { grade, threat_level: r.threat_level || 'low', handling_code: r.handling_code || '', intel: true },
        };
      }
```

- [ ] **Step 3: Add intel edges to `findConnections` (forward + generic reverse)**

In `findConnections`, inside the type-specific `switch (type)`, add a forward case before its `default`/closing (a disseminated intel report → the entities it names):

```ts
      case 'intel_report': {
        for (const r of await query<any>(db,
          `SELECT entity_type, entity_id, role FROM intel_report_links WHERE report_id = ? LIMIT 200`, id))
          add(r.entity_type, r.entity_id, r.role || 'mentioned', 'intel_report_links');
        break;
      }
```

Then, AFTER the `switch (type) { ... }` block closes (but still inside `findConnections`, before `return results;`), add a generic reverse lookup so ANY entity surfaces the disseminated intel that names it:

```ts
  // 3. Disseminated intel products that name this entity (any node type).
  try {
    for (const r of await query<any>(db,
      `SELECT l.report_id, l.role FROM intel_report_links l
       JOIN intel_reports rp ON rp.id = l.report_id
       WHERE l.entity_type = ? AND l.entity_id = ? AND rp.status = 'disseminated'
       LIMIT 200`, type, id))
      add('intel_report', r.report_id, r.role || 'intel_subject', 'intel_report_links');
  } catch (err: any) { console.error('[Connections] intel link edges error:', err?.message); }
```

> Verify exact placement: the type-specific work is wrapped in a `try { switch (type) { ... } } catch {}`. Put the forward `case 'intel_report'` inside the switch; put section 3 after that try/catch closes, before `return results;`. Read the function end to place it correctly.

- [ ] **Step 4: Add an intel branch to `/search`**

In the `/search` handler, before `return c.json(results);`, add:

```ts
  try {
    for (const r of await query<any>(db,
      `SELECT id, report_number, title FROM intel_reports
       WHERE status = 'disseminated' AND (report_number LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\') LIMIT 8`, term, term))
      results.push({ id: r.id, type: 'intel_report', label: `${r.report_number || `INT-${r.id}`} — ${r.title || ''}`.trim() });
  } catch (err: any) { console.error('[Connections] intel search error:', err?.message); }
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/routes/connections.ts
git commit -m "feat(intel): intel_report nodes + edges + search in connections graph"
```

---

## Task 3: `GET /connections/timeline` endpoint

**Files:**
- Modify: `src/routes/connections.ts`

- [ ] **Step 1: Add the import**

At the top of `connections.ts` with the other imports, add:

```ts
import { mergeTimeline } from '../utils/intelDossier';
import { parseNodeRefs, buildTimelineEvent } from '../utils/connectionsTimeline';
```

- [ ] **Step 2: Add the route**

After the `/search` handler (before the investigations section), add:

```ts
// GET /timeline?nodes=person:1,incident:5,intel_report:3 — merged chronology of a node set
const TIMELINE_QUERY: Record<string, string> = {
  incident: 'id, incident_number, incident_type, occurred_date, created_at, location_address, status',
  call: 'id, call_number, incident_type, created_at, location_address, status',
  citation: 'id, citation_number, violation_description, violation_date, status',
  warrant: 'id, warrant_number, charge_description, issued_date, status',
  arrest: 'id, full_name, charges, booking_date, status',
  field_interview: 'id, fi_number, contact_reason, created_at, status',
  trespass_order: 'id, order_number, location, effective_date, status',
  case: 'id, case_number, title, case_type, created_at, status',
  evidence: 'id, evidence_number, description, created_at, status',
  intel_report: 'id, report_number, title, disseminated_at, source_reliability, info_credibility, threat_level',
};
const TIMELINE_TABLE: Record<string, string> = {
  incident: 'incidents', call: 'calls_for_service', citation: 'citations', warrant: 'warrants',
  arrest: 'arrest_records', field_interview: 'field_interviews', trespass_order: 'trespass_orders',
  case: 'cases', evidence: 'evidence', intel_report: 'intel_reports',
};

connections.get('/timeline', operational, async (c) => {
  const refs = parseNodeRefs(c.req.query('nodes') || '');
  const byType = new Map<string, number[]>();
  for (const r of refs) {
    if (!TIMELINE_QUERY[r.type]) continue; // skip undated types (person/vehicle/property/...)
    byType.set(r.type, [...(byType.get(r.type) || []), r.id]);
  }
  const db = getDb(c.env);
  const sources: any[][] = [];
  for (const [type, ids] of byType) {
    try {
      const ph = ids.map(() => '?').join(',');
      const extra = type === 'intel_report' ? "AND status = 'disseminated'" : '';
      const rows = await query<any>(db,
        `SELECT ${TIMELINE_QUERY[type]} FROM ${TIMELINE_TABLE[type]} WHERE id IN (${ph}) ${extra}`, ...ids);
      sources.push(rows.map((row) => buildTimelineEvent(type, row)).filter(Boolean));
    } catch (err: any) { console.error(`[Connections] timeline ${type} error:`, err?.message); }
  }
  return c.json(mergeTimeline(sources as any));
});
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/routes/connections.ts
git commit -m "feat(intel): /connections/timeline merged chronology endpoint"
```

---

## Task 4: Client — intel nodes in the workbench

**Files:**
- Modify: `client/src/pages/ConnectionsPage.tsx`

- [ ] **Step 1: Add intel to the color + radius maps**

In `NODE_COLORS` (~line 45) add a final entry, and in `NODE_RADIUS` (~line 62) add one:

```ts
// in NODE_COLORS:
  report: '#ec4899',
  intel_report: '#e879f9',
// in NODE_RADIUS:
  call: 20, report: 14, intel_report: 20,
```

- [ ] **Step 2: Render a grade badge + threat ring on intel nodes**

In the node-rendering map (`visibleNodes.map(n => { ... })`, ~line 618, where `const color = NODE_COLORS[n.type] || '#888';` and the `<circle>` is drawn), add — right after the main node `<circle>` for the node body — intel-specific decoration. Locate the node `<g>` for each node and inside it, after the body circle, add:

```tsx
{n.type === 'intel_report' && (() => {
  const THREAT_RING: Record<string, string> = { critical: '#ef4444', high: '#f59e0b', medium: '#d4a017', low: '#64748b' };
  const ring = THREAT_RING[(n.metadata?.threat_level as string) || 'low'] || '#64748b';
  const rr = (NODE_RADIUS[n.type] || 20);
  return (
    <>
      <circle cx={n.x} cy={n.y} r={rr + 3} fill="none" stroke={ring} strokeWidth={2.5} />
      {n.metadata?.grade ? (
        <text x={n.x} y={(n.y ?? 0) + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="#0a0a0a">
          {String(n.metadata.grade)}
        </text>
      ) : null}
    </>
  );
})()}
```

> Match the existing `n.x`/`n.y` access pattern used by the surrounding node JSX (the file uses `n.x`, `n.y` from the simulation). If the body circle is keyed/wrapped a specific way, place this decoration as a sibling inside the same per-node group.

- [ ] **Step 3: Show intel detail in the selected-node panel**

Find the selected-node detail panel (it renders `nodes.find(n => n.id === selectedNodeId)` and shows label/metadata). Add an intel block: when the selected node `type === 'intel_report'`, render grade/threat/handling and a link. Insert into that panel's JSX:

```tsx
{selectedNode?.type === 'intel_report' && (
  <div className="mt-2 space-y-1 text-[11px]">
    <div style={{ color: '#aaa' }}>
      Grade {String(selectedNode.metadata?.grade || '—')} · Threat {String(selectedNode.metadata?.threat_level || '—')} · Handling {String(selectedNode.metadata?.handling_code || '—')}
    </div>
    <a href={`/intel/reports/${selectedNode.entityId}`}
       style={{ color: '#e879f9' }}>Open intelligence product →</a>
  </div>
)}
```

> `selectedNode` is whatever local the panel already computes (e.g. `const selectedNode = nodes.find(n => n.id === selectedNodeId)`). Reuse the existing variable; if it's named differently, match it.

- [ ] **Step 4: Typecheck client**

Run: `cd client && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/ConnectionsPage.tsx
git commit -m "feat(intel): intel nodes (grade badge + threat ring + detail) in workbench"
```

---

## Task 5: Client — timeline side panel

**Files:**
- Modify: `client/src/pages/ConnectionsPage.tsx`

- [ ] **Step 1: Add timeline state + fetch**

Near the other `useState` hooks (~line 80-105), add:

```tsx
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [timeline, setTimeline] = useState<Array<{ kind: string; id: number; date: string | null; title: string; subtitle: string; status: string }>>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState('');
```

After the component's other effects, add an effect that loads the timeline when it's open and the node set changes:

```tsx
  useEffect(() => {
    if (!timelineOpen || nodes.length === 0) { setTimeline([]); return; }
    const param = nodes.map(n => `${n.type}:${n.entityId}`).join(',');
    setTimelineLoading(true); setTimelineError('');
    apiFetch<any[]>(`/connections/timeline?nodes=${encodeURIComponent(param)}`)
      .then(r => setTimeline(Array.isArray(r) ? r : []))
      .catch(() => setTimelineError('Failed to load timeline.'))
      .finally(() => setTimelineLoading(false));
  }, [timelineOpen, nodes]);
```

> `apiFetch` is already imported in this file (used for `/connections/*` calls). If not, add `import { apiFetch } from '../hooks/useApi';`.

- [ ] **Step 2: Add the toggle button + panel**

Add a "TIMELINE" toggle button alongside the existing graph controls (near the depth slider / save buttons), and a side panel. Add the button:

```tsx
<button onClick={() => setTimelineOpen(o => !o)}
  style={{ background: timelineOpen ? '#e879f9' : '#0b0b0b', color: timelineOpen ? '#000' : '#888', borderRadius: 2, padding: '4px 10px', fontSize: 11, fontWeight: 600 }}>
  TIMELINE
</button>
```

And the panel (render it when `timelineOpen`, beside the graph — match the page's existing fl/grid layout for side panels):

```tsx
{timelineOpen && (
  <div style={{ width: 320, background: '#0a0a0a', borderLeft: '1px solid #232323', overflowY: 'auto', padding: 8 }}>
    <div className="text-[9px] font-semibold mb-2" style={{ color: '#e879f9' }}>TIMELINE — {nodes.length} NODES</div>
    {timelineError && <div style={{ color: '#ef4444', fontSize: 11 }}>{timelineError}</div>}
    {timelineLoading && <div style={{ color: '#555', fontSize: 11 }}>Loading…</div>}
    {!timelineLoading && timeline.length === 0 && <div style={{ color: '#555', fontSize: 11 }}>No dated events.</div>}
    {timeline.map((ev, i) => {
      const KIND_COLOR: Record<string, string> = { intel: '#e879f9', incident: '#f59e0b', call: '#22d3ee', citation: '#fbbf24', warrant: '#dc2626', arrest: '#ef4444', field_interview: '#64748b', trespass_order: '#a855f7', case: '#d4a017', evidence: '#ef4444' };
      return (
        <div key={`${ev.kind}-${ev.id}-${i}`} className="py-[3px]" style={{ borderTop: '1px solid #1a1a1a' }}>
          <div className="flex items-center gap-2 text-[10px]">
            <span style={{ color: KIND_COLOR[ev.kind] || '#888', fontWeight: 700 }}>{ev.kind.toUpperCase()}</span>
            <span style={{ color: '#666' }}>{ev.date ? ev.date.slice(0, 10) : '—'}</span>
          </div>
          <div className="text-[11px]" style={{ color: '#ddd' }}>{ev.title}</div>
          {ev.subtitle && <div className="text-[10px]" style={{ color: '#777' }}>{ev.subtitle}</div>}
        </div>
      );
    })}
  </div>
)}
```

> Place the panel so the graph stays visible (the page already uses a flex layout with a controls/detail column — add this as another column or a right-side drawer consistent with that layout).

- [ ] **Step 3: Typecheck + client build**

Run: `cd client && npx tsc --noEmit && npx vite build`
Expected: both PASS.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/ConnectionsPage.tsx
git commit -m "feat(intel): timeline side panel in the workbench"
```

---

## Task 6: Client — intel on the dossier mini-graph

**Files:**
- Modify: `client/src/components/ConnectionsGraphPanel.tsx`

The mini-graph fetches `/connections/graph?type=person&id=...&depth=1`. Because Task 2 added intel edges to `findConnections`, disseminated intel that names the person is now returned automatically. This task only ensures the component RENDERS the new `intel_report` node type (color + label) rather than dropping it.

- [ ] **Step 1: Ensure the intel node type has a color/label**

Open `ConnectionsGraphPanel.tsx`. Find its node color map (it has one analogous to `NODE_COLORS`, or it reuses a shared one). If it has its own map, add `intel_report: '#e879f9',`. If it filters to a fixed set of types, add `'intel_report'` to that set so intel nodes aren't dropped. Confirm the component renders `intel_report` nodes with their label (the label already comes from the API).

- [ ] **Step 2: Typecheck client + run the panel test**

Run: `cd client && npx tsc --noEmit && npx vitest run src/components/__tests__/ConnectionsGraphPanel.test.tsx`
Expected: PASS (existing test still green).

- [ ] **Step 3: Commit**

```bash
git add client/src/components/ConnectionsGraphPanel.tsx
git commit -m "feat(intel): show linked intel on the dossier mini-graph"
```

---

## Task 7: Consolidation — routes, nav, SW bump

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/src/components/Sidebar.tsx`
- Modify: `client/public/sw.js`

- [ ] **Step 1: Add `/intel/workbench` alias + redirect `/forensics`**

In `client/src/App.tsx`: find the `<Route path="/connections" ... />` and the `<Route path="/forensics" ... />` lines. Add an alias route for the workbench (rendering the same `ConnectionsPage` lazy component already imported) and convert `/forensics` to a redirect. Use:

```tsx
            <Route path="/intel/workbench" element={<RouteErrorBoundary><ConnectionsPage /></RouteErrorBoundary>} />
```

And replace the existing `/forensics` route element with a redirect (import `Navigate` from `react-router-dom` if not already imported):

```tsx
            <Route path="/forensics" element={<Navigate to="/connections" replace />} />
```

> `ConnectionsPage` is already a lazy import in App.tsx (used by `/connections`). Reuse it — do not add a second import. Do NOT touch `/forensic-lab` (ForensicLabPage).

- [ ] **Step 2: Add the Sidebar nav entry**

In `client/src/components/Sidebar.tsx`, in the `'intel'` section's `items` array (the "Intelligence" section added in Wave 1, containing Intel Products + Source Registry), add an entry pointing to the workbench, matching the existing `{ path, icon, label }` shape (reuse an already-imported icon such as `Network` or `Share2`):

```tsx
      { path: '/intel/workbench', icon: Network, label: 'Intel Workbench' },
```

> If `Network` is already used by another entry in this section, pick a different already-imported icon (e.g. `GitBranch`, `Share2`) — do not add a new import unless necessary.

- [ ] **Step 3: Bump the service worker**

In `client/public/sw.js`, change `const CACHE_NAME = 'rmpg-flex-v918';` to `const CACHE_NAME = 'rmpg-flex-v919';`. (Confirm current value first; bump to the next integer above whatever is there.)

- [ ] **Step 4: Typecheck + build client**

Run: `cd client && npx tsc --noEmit && npx vite build`
Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/App.tsx client/src/components/Sidebar.tsx client/public/sw.js
git commit -m "feat(intel): Intel Workbench nav + /intel/workbench alias + retire old /forensics (SW v919)"
```

---

## Task 8: Full verification + PR

**Files:** none (verification)

- [ ] **Step 1: Worker typecheck + tests**

Run: `npm run typecheck && npm test`
Expected: PASS — all prior tests + new `connectionsTimeline.test.ts` green.

- [ ] **Step 2: Client typecheck + tests + build**

Run: `cd client && npx tsc --noEmit && npx vitest run && npx vite build`
Expected: all PASS.

- [ ] **Step 3: Push + open PR**

```bash
git push -u origin claude/intel-wave2-workbench
gh pr create --title "Intel v2 Wave 2 — Intel Workbench (graph + timeline)" --body "$(cat <<'EOF'
## Summary
Wave 2 of Intel v2: make the existing Connections graph workbench intel-aware.

- `intel_report` is now a graph node type; `intel_report_links` are traced edges (both directions) — disseminated intel flows into link analysis, **path-finding**, and saved investigations.
- Intel nodes styled by Admiralty grade (badge) + threat (ring); detail panel links to the product.
- New `GET /connections/timeline` + a workbench timeline side panel (merged chronology of the current node set, intel events highlighted).
- Dossier mini-graph shows linked intel.
- Consolidation: `/intel/workbench` alias + "Intel Workbench" nav; redundant old `/forensics` graph redirects to `/connections`. ForensicLab untouched.

**No DB migration** (Wave 1 mig 0104 + investigations mig 0043 already exist). SW v918 → v919.
Redaction held: only `status='disseminated'` reports appear; nodes/search/timeline expose sanitized fields only.

Spec: `docs/superpowers/specs/2026-06-13-intel-workbench-design.md`
Plan: `docs/superpowers/plans/2026-06-13-intel-workbench.md`

## Test Plan
- [x] Worker typecheck + tests (incl. connectionsTimeline)
- [x] Client typecheck + tests + build
- [ ] Post-merge: browser — open Intel Workbench, seed a person linked to a disseminated product, confirm the intel node (grade/threat) appears, the timeline shows the intel event, an investigation round-trips, and `/forensics` redirects.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- Intel-aware graph (node + edges + search) → Task 2. ✔
- Redaction (disseminated-only, sanitized) → Task 2 (loadNode/findConnections/search all filter `status='disseminated'`), Task 3 (timeline). ✔
- Path-finding through intel → free via `findConnections` (Task 2) — `findShortestPath` reuses it. ✔
- Unified timeline → Task 1 (pure helpers) + Task 3 (endpoint) + Task 5 (panel). ✔
- Intel in investigations → generic JSON already supports it; intel nodes serialize via existing seed/layout (no code beyond rendering, Task 4). ✔
- Dossier mini-graph intel → Task 6. ✔
- Consolidation (alias, nav, /forensics redirect, SW) → Task 7. ✔
- Testing → Task 1 + Task 8. ✔

**Placeholder scan:** No TBD/TODO. Tasks 4/6 contain "match the existing variable/map" guidance flagged explicitly because the exact local name (`selectedNode`) and the mini-graph's color map must be matched at edit time — the code to add is fully specified; only the insertion anchor is verified live.

**Type consistency:** `NodeRef`/`buildTimelineEvent`/`parseNodeRefs` (Task 1) match their call sites in the `/timeline` route (Task 3). `TimelineEvent` reused from `intelDossier.ts`. Node color `#e879f9` for `intel_report` consistent across NODE_COLORS (Task 4), the timeline KIND_COLOR `intel` (Task 5), the detail link (Task 4), and the mini-graph (Task 6). `nodeKey` format `${type}-${id}` (worker) vs the timeline param format `${type}:${id}` (client→`parseNodeRefs`) are intentionally different and each internally consistent.
