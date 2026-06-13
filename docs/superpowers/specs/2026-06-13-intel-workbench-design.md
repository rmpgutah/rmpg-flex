# Intel v2 — Wave 2: Intel Workbench (graph + timeline integration)

**Date:** 2026-06-13
**Status:** Approved (design) — pending spec review
**Program:** Intel v2 (4-wave). This is **Wave 2 of 4**. Depends on Wave 1 ([[2026-06-13-intel-development-cycle-design]], PR #1187, live).

---

## 0. Context & the key realization

Wave 2 was originally scoped as "build a unified Palantir-style workbench." Exploration
found that **the workbench already exists** as the Connections subsystem:

- `src/routes/connections.ts` (~800 lines): `buildGraph` (multi-depth BFS over 14 entity
  types), `findShortestPath` (BFS to 6 hops), `/graph` `/path` `/search`, and **saved
  investigations** (`POST/GET/PUT/DELETE /investigations`, table `connection_investigations`
  mig 0043 — `seed_nodes`/`pinned_layout`/`annotations`/`shared_user_ids`).
- `client/src/pages/ConnectionsPage.tsx` (~940 lines): full graph workbench on
  `react-force-graph-2d` — search, seed, depth slider, type filters, path-finding UI,
  per-node annotations, save/load investigations, PNG/PDF export.
- `client/src/components/ConnectionsGraphPanel.tsx`: read-only 1-hop mini-graph embedded
  in the person dossier.

**The one gap: intel products are invisible to all of it.** `connections.ts` knows
persons/vehicles/incidents/calls/cases/… but `intel_report` is not a node type and
`intel_report_links` is not a traced edge. Wave 1's graded, disseminated intelligence
cannot appear in link analysis, path-finding, or investigations.

**So Wave 2 is an integration, not a rebuild.** It makes the existing workbench
intel-aware, adds a timeline lens, lets investigations pin intel, and consolidates the
redundant older graph page.

**No database migration** — `intel_reports` + `intel_report_links` (Wave 1, mig 0104)
and `connection_investigations` (mig 0043) already exist; investigations store generic
JSON, so intel nodes fit with zero schema change. No new dependency (`react-force-graph-2d`
already present). Branches off `origin/main` (has Wave 1).

---

## 1. Goals (the 4 approved pieces)

1. **Intel-aware graph** — `intel_report` becomes a first-class node type with traced
   `intel_report_links` edges, styled by Admiralty grade + threat.
2. **Unified timeline view** — a chronological lens beside the graph, merging all linked
   entity activity including disseminated intel.
3. **Intel in investigations** — intel nodes pin/annotate/share like any node; expanding an
   entity surfaces its linked intel.
4. **Consolidation** — `ConnectionsPage` becomes the canonical **Intel Workbench**
   (surfaced under the Intelligence nav); the redundant old `ForensicsPage` graph redirects
   to it. `ForensicLabPage` (evidence/custody) is untouched.

---

## 2. Redaction model (carry Wave 1's guarantee into the graph)

The source-protection guarantee from Wave 1 must hold in the graph:

- **Only `status='disseminated'` intel_reports may load as nodes.** Drafts
  (submitted/graded/analyzed) and rejected/recalled/purged reports never enter the graph.
- An intel node exposes **sanitized fields only**: `report_number`, `title`,
  `source_reliability`+`info_credibility` (as a grade badge), `threat_level`,
  `handling_code`. **Never** `raw_narrative`, `assessment` internal text beyond a sanitized
  summary, or any source identity.
- Timeline intel events likewise use only `report_number`/`title`/grade.

This means the existing `loadNode`/`findConnections` intel branches filter on
`status='disseminated'` everywhere.

---

## 3. Worker changes — `src/routes/connections.ts`

### 3.1 Node type
- Add `'intel_report'` to `VALID_TYPES`.
- `loadNode('intel_report', id)`: `SELECT ... FROM intel_reports WHERE id=? AND
  status='disseminated'`. Returns a `GNode` with `label = report_number + ' — ' + title`
  and a `meta` payload `{ grade: 'B2', threat_level, handling_code, confidence }` for
  client styling. Returns null (node absent) if not disseminated.

### 3.2 Edges — `findConnections` (both directions)
- **From an intel_report node:** `SELECT entity_type, entity_id, role FROM
  intel_report_links WHERE report_id=?` → edges to person/vehicle/location/incident/call/…
  (relationship = `role`, e.g. `subject`, `mentioned`).
- **To an intel_report node:** when expanding a person/vehicle/incident/call/etc., also
  `SELECT report_id, role FROM intel_report_links l JOIN intel_reports r ON r.id=l.report_id
  WHERE l.entity_type=? AND l.entity_id=? AND r.status='disseminated'` → edges to the linked
  disseminated intel. (Junction is symmetric; both directions traced so expansion works from
  either side.)

### 3.3 Search
- `/connections/search` adds a branch: disseminated intel_reports matched by
  `report_number`/`title` (sanitized), returned as `{ id, type: 'intel_report', label }`.

### 3.4 Path-finding
- No code change needed — once `intel_report` is a node with edges, `findShortestPath`
  traverses it automatically (an intel product can be a connecting hop between two persons).

### 3.5 Timeline endpoint — new `GET /connections/timeline`
- Query: `nodes=person:1,incident:5,call:9,...` (the current graph's node set, capped, e.g.
  ≤ 60 nodes).
- Builds a merged `TimelineEvent[]` by querying per-type events for the given ids
  (calls, incidents, citations, field_interviews, warrants, arrests — reuse the same queries
  the dossier handler uses) **plus a new `intel` kind**: disseminated intel_reports among the
  nodes → `{ kind: 'intel', id, date: disseminated_at, title: report_number+title, subtitle:
  grade+threat, status: 'DISSEMINATED' }`.
- Sorted via `mergeTimeline` (already in `intelDossier.ts`: date-desc, null-dates last).
- `operational` gated.

### 3.6 Pure logic — new `src/utils/connectionsTimeline.ts` (vitest-tested)
- `parseNodeRefs(param: string): {type, id}[]` — parse `person:1,incident:5` safely.
- `intelTimelineEvents(rows): TimelineEvent[]` — map disseminated-intel rows → events.
- `mergeTimeline` is reused from `intelDossier.ts`.
- Tests in `tests/connectionsTimeline.test.ts`.

---

## 4. Client changes — `client/src/pages/ConnectionsPage.tsx`

### 4.1 Intel nodes
- Add `intel_report` to the node-type color map + the type-filter toggle list.
- Render intel nodes distinctly: a node color reserved for intel + a small **grade badge**
  (`B2`) and a **threat-colored ring** (low gray / medium gold / high amber / critical red),
  using the `meta` from `loadNode`.
- Node detail/click panel: sanitized summary line (report_number — title · grade · threat ·
  handling) + a link to `/intel/reports/:id`. Never shows raw fields (the API doesn't send
  them).
- Search dropdown surfaces intel results (already wired via `/search`).

### 4.2 Timeline panel
- A **collapsible timeline side panel** opened by a "TIMELINE" toggle button (the graph
  stays visible alongside it). When open, calls `GET /connections/timeline?nodes=<current
  node set>` and renders a chronological list: each row `date · kind chip · title · subtitle`,
  color-coded by kind, **intel events highlighted** with the grade badge.
- Clicking a timeline row centers/selects that node in the graph (reuse the existing
  focus-node logic).
- Empty/error states surface a message (consistent with Wave 1's error-surfacing).

### 4.3 Investigations
- Intel nodes already serialize through the generic `seed_nodes`/`pinned_layout`/
  `annotations` JSON — verify they round-trip (save → reload restores intel node positions +
  notes). No API change.

### 4.4 Dossier mini-graph — `ConnectionsGraphPanel.tsx`
- Make the person mini-graph intel-aware too: linked disseminated intel appears as nodes
  (same styling), so opening a dossier shows the intel about that person at a glance.

---

## 5. Consolidation / IA — `client/src/App.tsx`, Sidebar

- Add route alias `/intel/workbench` rendering `ConnectionsPage` (so the workbench has an
  Intel-section home), keeping `/connections` working.
- Add **Intelligence → Intel Workbench** sidebar entry → `/intel/workbench`.
- Retire the redundant old graph page: `/forensics` → `<Navigate to="/connections" replace />`;
  remove its nav entry. **Do NOT touch `ForensicLabPage` / `/forensic-lab`** — distinct
  evidence/chain-of-custody domain.
- Bump `CACHE_NAME` v918 → v919.

---

## 6. Testing

- `tests/connectionsTimeline.test.ts` — `parseNodeRefs` (valid/garbage/cap), `intelTimelineEvents`
  (disseminated-only, field mapping), merged ordering.
- Extend `client/src/pages/__tests__/ConnectionsPage.test.tsx` and
  `client/src/components/__tests__/ConnectionsGraphPanel.test.tsx` for intel-node rendering +
  the timeline toggle (smoke-level; force-graph canvas isn't deeply unit-testable in jsdom —
  assert data wiring, not pixels).
- Worker typecheck + client typecheck + client vitest + client build all green (CI:
  `pr-tests.yml`).

---

## 7. Delivery

- Feature branch `claude/intel-wave2-workbench` (off `origin/main`) → `gh pr create`.
- **No migration** — nothing to apply to live D1.
- Post-merge: verify in a real browser — open the Intel Workbench, search a person who has
  a disseminated intel product linked, confirm the intel node appears with its grade/threat,
  the timeline shows the intel event, and an investigation round-trips with the intel node.
- SW bump shipped with the client build.

---

## 8. Out of scope (later waves / untouched)

- AI-suggested links / auto-clustering — **Wave 3**.
- New collection sources — **Wave 4**.
- `ForensicLabPage` evidence/custody — untouched (not redundant).
- New investigation schema fields (current generic JSON suffices).
- Backfilling intel into FTS beyond Wave 1 (already incremental on disseminate).

---

## 9. Open implementation notes

- Confirm exact `GNode`/`GEdge` shapes + `VALID_TYPES` location + the node-color map symbol
  in `connections.ts` / `ConnectionsPage.tsx` at plan time (Explore put `VALID_TYPES` ~line 62,
  `loadNode` ~105, `findConnections` ~185, `buildGraph` ~441, `/graph` ~574, investigations
  ~685; verify against `origin/main`).
- Confirm the dossier per-type event queries to reuse for the timeline (the `/dossier/person/:id`
  handler in `intel.ts` already assembles them via `mergeTimeline`).
- Cap timeline node set (≤ ~60) to stay within the Worker subrequest budget.
