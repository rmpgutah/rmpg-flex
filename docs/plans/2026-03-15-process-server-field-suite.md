# Process Server Field Suite — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a mobile-first Process Server Field Suite with serve queue, service attempt documentation, smart route optimization, affidavit PDF generation, and skip trace integration.

**Architecture:** New `/serve` page with dedicated server route (`/api/process-server`), 4 new database tables, 3 PDF templates, and integration with existing ServeManager, Microbilt, GPS, and upload systems. Mobile-first design using existing component patterns (FormModal, TabBar, PanelTitleBar).

**Tech Stack:** React 18 + TypeScript + Tailwind (dark theme), Express + better-sqlite3, jsPDF, Google Maps Directions API, existing Microbilt/ServeManager clients.

---

### Task 1: Database Schema — 4 New Tables

**Files:**
- Modify: `server/src/models/database.ts` (add tables in `createTables()` function)

**Step 1: Add serve_queue table**

Add inside the `db.exec()` block in `createTables()`:

```sql
CREATE TABLE IF NOT EXISTS serve_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sm_job_id INTEGER,
  officer_id INTEGER REFERENCES users(id),
  serve_date TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  recipient_address TEXT,
  recipient_city TEXT,
  recipient_state TEXT DEFAULT 'UT',
  recipient_zip TEXT,
  recipient_lat REAL,
  recipient_lng REAL,
  document_type TEXT NOT NULL DEFAULT 'summons',
  case_number TEXT,
  court_name TEXT,
  jurisdiction TEXT,
  client_name TEXT,
  attorney_name TEXT,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','rush')),
  time_window TEXT DEFAULT 'anytime' CHECK(time_window IN ('morning','afternoon','evening','anytime')),
  deadline TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_progress','served','failed','skipped','archived')),
  sort_order INTEGER DEFAULT 0,
  service_instructions TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_serve_queue_officer ON serve_queue(officer_id, serve_date);
CREATE INDEX IF NOT EXISTS idx_serve_queue_status ON serve_queue(status);
CREATE INDEX IF NOT EXISTS idx_serve_queue_sm ON serve_queue(sm_job_id);
```

**Step 2: Add serve_attempts table**

```sql
CREATE TABLE IF NOT EXISTS serve_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  serve_queue_id INTEGER NOT NULL REFERENCES serve_queue(id),
  officer_id INTEGER NOT NULL REFERENCES users(id),
  attempt_number INTEGER NOT NULL,
  attempt_type TEXT NOT NULL CHECK(attempt_type IN ('personal','substitute','posting','failed')),
  result TEXT NOT NULL CHECK(result IN ('served','no_answer','refused','wrong_address','moved','other')),
  latitude REAL,
  longitude REAL,
  gps_accuracy REAL,
  address_verified INTEGER DEFAULT 0,
  person_served_name TEXT,
  person_served_relationship TEXT,
  person_served_description TEXT,
  photo_ids TEXT DEFAULT '[]',
  signature_data TEXT,
  notes TEXT,
  attempt_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_serve_attempts_queue ON serve_attempts(serve_queue_id);
CREATE INDEX IF NOT EXISTS idx_serve_attempts_officer ON serve_attempts(officer_id);
```

**Step 3: Add serve_routes table**

```sql
CREATE TABLE IF NOT EXISTS serve_routes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id INTEGER NOT NULL REFERENCES users(id),
  route_date TEXT NOT NULL,
  planned_stops TEXT DEFAULT '[]',
  actual_stops TEXT DEFAULT '[]',
  planned_mileage REAL,
  actual_mileage REAL,
  planned_duration_minutes INTEGER,
  actual_duration_minutes INTEGER,
  fuel_cost REAL,
  start_location TEXT,
  start_lat REAL,
  start_lng REAL,
  start_time TEXT,
  end_time TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_serve_routes_officer ON serve_routes(officer_id, route_date);
```

**Step 4: Add serve_skip_traces table**

```sql
CREATE TABLE IF NOT EXISTS serve_skip_traces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  serve_queue_id INTEGER NOT NULL REFERENCES serve_queue(id),
  officer_id INTEGER NOT NULL REFERENCES users(id),
  search_type TEXT NOT NULL DEFAULT 'byname',
  query_params TEXT,
  lookup_cost REAL DEFAULT 0,
  results_json TEXT,
  addresses_found TEXT DEFAULT '[]',
  address_added_to_route INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_serve_skip_queue ON serve_skip_traces(serve_queue_id);
```

**Step 5: Run TypeScript check**

Run: `cd server && npx tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```
git add server/src/models/database.ts
git commit -m "feat(serve): add 4 database tables for process server field suite"
```

---

### Task 2: Server Route — Process Server API

**Files:**
- Create: `server/src/routes/serve.ts`
- Modify: `server/src/index.ts` (register route)

**Step 1: Create the serve route file**

Create `server/src/routes/serve.ts` with these endpoints:

- `GET /` — List serve queue for officer + date (query params: officer_id, date, status)
- `POST /` — Create serve job (manual or from SM sync)
- `GET /:id` — Get single job with attempts and skip traces joined
- `PUT /:id` — Update serve job fields
- `POST /:id/attempt` — Record service attempt (4-step wizard result). Enforces: posting requires 2+ prior failed. Auto-increments attempt_count. Sets job status to served/failed/in_progress.
- `POST /:id/skip-trace` — Run skip trace via existing Microbilt API. Pre-fills name/address from job. Extracts addresses from results. Saves to serve_skip_traces.
- `GET /routes/:date` — Get route for officer + date
- `POST /routes` — Save/update route (upsert by officer_id + route_date)
- `POST /sync-from-sm` — Import unserved SM jobs into serve_queue
- `GET /stats/summary` — Dashboard stats (total/pending/served/failed/attempts/mileage)
- `PUT /reorder` — Batch update sort_order for drag-and-drop

Follow existing patterns: `authenticateToken`, `requireRole`, `auditLog`, `broadcast`, `localNow()`.

**Step 2: Register route in index.ts**

Add import and `app.use('/api/process-server', serveRoutes)` near other route registrations.

**Step 3: Run TypeScript check**

Run: `cd server && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```
git add server/src/routes/serve.ts server/src/index.ts
git commit -m "feat(serve): add process server API with queue, attempts, routes, skip trace"
```

---

### Task 3: TypeScript Types

**Files:**
- Modify: `client/src/types/index.ts`

**Step 1: Add serve types**

Add these interfaces at the end of the types file:

- `ServeJob` — matches serve_queue table columns + optional `attempts` and `skipTraces` arrays
- `ServeAttempt` — matches serve_attempts table columns. `photo_ids` typed as `string[]`. `attempt_type` and `result` as union literal types.
- `ServeAttemptData` — input type for the attempt wizard (subset of ServeAttempt, all optional except attempt_type and result)
- `ServeRoute` — matches serve_routes table. `planned_stops` and `actual_stops` typed as `ServeRouteStop[]`.
- `ServeRouteStop` — `{ serve_queue_id, lat, lng, address, recipient_name, order, arrived_at?, departed_at?, status? }`
- `ServeSkipTrace` — matches serve_skip_traces table. `addresses_found` typed as `ServeSkipAddress[]`.
- `ServeSkipAddress` — `{ address, city, state, zip, type, last_seen }`

**Step 2: Commit**

```
git add client/src/types/index.ts
git commit -m "feat(serve): add TypeScript types for serve queue, attempts, routes, skip traces"
```

---

### Task 4: ServeJobCard Component

**Files:**
- Create: `client/src/components/serve/ServeJobCard.tsx`

**Step 1: Create the ServeJobCard component**

A card component with:
- Recipient name (bold), address below
- Document type badge, attempt count indicator (progress dots: 0/3, 1/3, 2/3, 3/3)
- Priority badge (rush=red, high=amber, normal=blue, low=gray)
- Time window badge (morning sun icon, afternoon, evening moon, anytime clock)
- Deadline warning if within 48 hours (red pulsing border)
- Status indicator LED (pending=blue, in_progress=amber, served=green, failed=red)
- Action buttons row: Navigate (MapPin icon), Attempt Service (ClipboardCheck icon), Skip Trace (Search icon), Flag Bad Address (AlertTriangle icon)
- Expandable section with click-to-toggle: case details, prior attempts as timeline, attorney/client notes
- Dark theme: `panel-beveled`, border-[#1e3048], bg-[#141e2b]

Props: `job: ServeJob`, callbacks for each action, `isExpanded`, `onToggleExpand`

**Step 2: Commit**

```
git add client/src/components/serve/ServeJobCard.tsx
git commit -m "feat(serve): add ServeJobCard component with actions and expandable details"
```

---

### Task 5: ServeAttemptModal — 4-Step Documentation Wizard

**Files:**
- Create: `client/src/components/serve/ServeAttemptModal.tsx`

**Step 1: Create the 4-step attempt modal**

Modal wizard with step indicator at top (4 circles connected by line, active one highlighted).

**Step 1 — Arrival Confirmation:**
- Auto-captures GPS via `navigator.geolocation.getCurrentPosition({ enableHighAccuracy: true })`
- Shows coordinates + accuracy
- Calculates distance from job address using Haversine formula
- Warning banner if >200m: "You appear to be X meters from the service address" (yellow, with Override button)
- "Confirm Location" button

**Step 2 — Attempt Type:**
- Radio group: Personal Service, Substitute Service, Posting (disabled if attempt_count < 2), Failed Attempt
- For Failed: dropdown — No Answer, Refused, Wrong Address, Moved, Other
- Visual description of each type in small gray text

**Step 3 — Documentation:**
- Camera input: `<input type="file" accept="image/*" capture="environment" multiple>` with drag-drop zone
- Photo thumbnails with remove button (max 5)
- Upload photos via existing `/api/uploads` endpoint, store returned IDs
- For personal/substitute: description fieldset — age range (select), height (text), weight (text), hair color (select), clothing (text)
- For substitute only: "Person Served" fields — name (required), relationship (select: spouse, roommate, coworker, family, other)
- Notes textarea (placeholder: "Observations about the location, people present, etc.")

**Step 4 — Result & Signature:**
- Summary card showing all captured data
- Reuse existing `SignaturePad` component for server signature
- "Submit Attempt" primary button
- After submission: if attempt >= max_attempts and not served, show "Due Diligence Complete" banner with "Generate Affidavit of Non-Service" button

**Step 2: Commit**

```
git add client/src/components/serve/ServeAttemptModal.tsx
git commit -m "feat(serve): add 4-step service attempt documentation wizard"
```

---

### Task 6: ServeRoutePlanner Component

**Files:**
- Create: `client/src/components/serve/ServeRoutePlanner.tsx`

**Step 1: Create the route planner**

Full-screen modal or panel with split layout (responsive — stacked on mobile):

**Left panel — Stop list:**
- Checkbox per stop to include/exclude
- Each row: number, recipient name, address, time window badge, priority badge
- Drag handle for manual reorder
- "Select All" / "Deselect All" buttons
- "Optimize Route" button (primary action)

**Right panel — Map:**
- Google Maps using `loadGoogleMaps()` + `DARK_MAP_STYLE`
- Numbered markers (1, 2, 3...) at each stop location, color-coded by status
- `google.maps.DirectionsRenderer` showing route polyline
- Current location marker (blue dot)
- Info windows on click showing recipient name + address

**Optimization logic:**
1. Get selected stops with lat/lng
2. Sort by time_window priority based on current time of day
3. Call `google.maps.DirectionsService.route()` with `optimizeWaypoints: true` (max 25 waypoints)
4. For >25 stops: cluster by lat/lng quadrants, optimize each cluster, chain clusters nearest-to-nearest
5. Apply returned `waypointOrder` to reorder the stop list
6. Display total distance + duration from directions result

**Stats bar at bottom:**
- Total stops selected
- Estimated mileage + duration from Directions API
- Fuel cost estimate (use `$0.67/mile` IRS rate, configurable)

**Step 2: Commit**

```
git add client/src/components/serve/ServeRoutePlanner.tsx
git commit -m "feat(serve): add smart route planner with Google Maps optimization"
```

---

### Task 7: ServeSkipTracePanel Component

**Files:**
- Create: `client/src/components/serve/ServeSkipTracePanel.tsx`

**Step 1: Create the skip trace panel**

Slide-out panel (right side, 400px wide, dark theme):

**Search section:**
- Pre-filled name input (from job.recipient_name)
- Pre-filled address input (from job.recipient_address)
- "Run Lookup" button with loading spinner
- Cost disclaimer text: "Skip trace lookups may incur charges"

**Results section:**
- Person match cards: name, age, aliases listed
- Address list sorted by recency:
  - Each row: full address, type badge (Current/Previous/Historical), last seen date
  - Green checkmark if matches job address
  - "Add to Route" button per address (calls parent callback)
- Phone numbers section (if available)
- Employment section (if available)
- "No Results" empty state

**Previous lookups accordion:**
- Collapsed by default, shows prior skip traces for this job
- Each entry: date, result count, addresses found

**Step 2: Commit**

```
git add client/src/components/serve/ServeSkipTracePanel.tsx
git commit -m "feat(serve): add skip trace panel with address verification"
```

---

### Task 8: ServePage — Main Component

**Files:**
- Create: `client/src/pages/ServePage.tsx`
- Modify: `client/src/App.tsx` (add route)

**Step 1: Create the ServePage**

Mobile-first page (~800 lines) with tab bar: "Queue" | "Map" | "Stats"

**Header bar:**
- Date picker (defaults to today)
- "Plan Route" button (opens ServeRoutePlanner)
- "Sync from SM" button (imports from ServeManager)
- "Add Job" button (opens create form)

**Queue tab:**
- List of ServeJobCards for selected date, sorted by sort_order
- Filter buttons: All | Pending | Served | Failed
- Empty state: "No jobs for today. Sync from ServeManager or add manually."
- Pull-to-refresh on mobile
- Clicking a card's actions triggers: ServeAttemptModal, ServeSkipTracePanel, or Google Maps navigation

**Map tab:**
- Full-height Google Map with all today's stops as markers
- Color-coded: green=served, yellow=attempted, red=failed/deadline, blue=unvisited
- Route polyline if route is planned
- Click marker to see job card overlay
- "Navigate to Next" button at bottom

**Stats tab:**
- Summary cards: Jobs Remaining, Served Today, Failed, Total Attempts
- Mileage driven today
- Route efficiency (if route planned: actual vs planned)
- Weekly trend mini-chart (serves per day this week)

**State management:**
- Fetch jobs via `apiFetch('/api/process-server?date=YYYY-MM-DD')`
- Fetch stats via `apiFetch('/api/process-server/stats/summary?date=YYYY-MM-DD')`
- WebSocket listener for `serve:created`, `serve:updated`, `serve:attempt` events
- Modal states for: attempt modal, route planner, skip trace panel, add/edit job form

**Step 2: Add route in App.tsx**

Import ServePage and add `<Route path="/serve" element={<ServePage />} />` inside Routes.

**Step 3: Commit**

```
git add client/src/pages/ServePage.tsx client/src/App.tsx
git commit -m "feat(serve): add ServePage with queue, map, and stats tabs"
```

---

### Task 9: PDF Templates — Affidavits and Service Log

**Files:**
- Create: `client/src/utils/servePdfGenerator.ts`

**Step 1: Create 3 PDF templates**

Follow `recordPdfGenerator.ts` patterns, importing helpers from `pdfGenerator.ts`:

**Template 1: `generateAffidavitOfService(data: AffidavitOfServiceData): Promise<jsPDF>`**
- Court header: court name, case number, jurisdiction (bold, centered)
- Title: "AFFIDAVIT OF SERVICE" (18pt, centered)
- Server section using `addFieldPair()`: Full Name, Badge/License #, Company
- Recipient section: Name, Address, Document Type Served
- Service details: Date, Time, Method (Personal/Substitute/Posting), GPS Coordinates
- For substitute: Person Served Name, Relationship, Physical Description
- Photos section: embed up to 3 images per page using `addImageToPage()`, GPS-stamped
- Signature block using `addSignatureBlock()`: Server digital signature + blank notary section
- Footer: "Pursuant to Utah Rules of Civil Procedure, Rule 4(d)" + page numbers via `addPageFooter()`

**Template 2: `generateAffidavitOfNonService(data: AffidavitOfNonServiceData): Promise<jsPDF>`**
- Court header + "AFFIDAVIT OF DUE DILIGENCE / NON-SERVICE"
- Attempt history table using `addTableWithShading()`: columns = #, Date, Time, GPS, Result, Notes
- Photos from each attempt (page break between attempts if needed)
- Skip trace summary: searches performed, alternate addresses tried, results
- Declaration paragraph (static legal text)
- Signature block + notary

**Template 3: `generateServiceLog(data: ServiceLogData): Promise<jsPDF>`**
- Title: "SERVICE LOG REPORT" + date range
- Officer info fields
- Summary stats row: Total Jobs, Served, Failed, Pending, Miles Driven
- Job detail table: Recipient, Address, Doc Type, Attempts, Result, Time Spent
- Group by client/attorney with subtotals
- Route efficiency section if route data available

Define data interfaces at top of file:

```typescript
interface AffidavitOfServiceData {
  courtName: string;
  caseNumber: string;
  jurisdiction: string;
  serverName: string;
  serverBadge: string;
  serverCompany: string;
  recipientName: string;
  recipientAddress: string;
  documentType: string;
  serviceDate: string;
  serviceTime: string;
  serviceMethod: 'personal' | 'substitute' | 'posting';
  gpsLat: number;
  gpsLng: number;
  substituteInfo?: { name: string; relationship: string; description: string };
  photos?: string[]; // base64 or URLs
  signature?: string; // base64 canvas data
}

interface AffidavitOfNonServiceData {
  courtName: string;
  caseNumber: string;
  jurisdiction: string;
  serverName: string;
  serverBadge: string;
  recipientName: string;
  recipientAddress: string;
  documentType: string;
  attempts: Array<{
    number: number;
    date: string;
    time: string;
    gpsLat: number;
    gpsLng: number;
    result: string;
    notes: string;
    photos?: string[];
  }>;
  skipTraces?: Array<{
    date: string;
    searchType: string;
    addressesFound: number;
    addressesTried: string[];
  }>;
  signature?: string;
}

interface ServiceLogData {
  officerName: string;
  officerBadge: string;
  dateRange: { start: string; end: string };
  jobs: Array<{
    recipientName: string;
    address: string;
    documentType: string;
    clientName: string;
    attempts: number;
    result: string;
    timeSpent: number; // minutes
  }>;
  totalMileage: number;
  routeEfficiency?: { planned: number; actual: number };
}
```

**Step 2: Commit**

```
git add client/src/utils/servePdfGenerator.ts
git commit -m "feat(serve): add affidavit of service, non-service, and service log PDFs"
```

---

### Task 10: Navigation Integration

**Files:**
- Modify: `client/src/components/Layout.tsx`
- Modify: `client/src/components/MenuBar.tsx`

**Step 1: Layout.tsx — Add to TOOLBAR_NAV and PAGE_TITLES**

Import `Briefcase` from lucide-react.

Add to `TOOLBAR_NAV` array (in the 'enforce' group):
```typescript
{ path: '/serve', icon: Briefcase, label: 'Serve', group: 'enforce' },
```

Add to `PAGE_TITLES`:
```typescript
'/serve': 'Process Server',
```

**Step 2: MenuBar.tsx — Add menu entries**

Import `Briefcase` from lucide-react.

Add to File > New submenu:
```typescript
{ type: 'action', label: 'Service Job', icon: Briefcase, action: () => navigate('/serve') },
```

Add to View or Operations menu:
```typescript
{ type: 'action', label: 'Process Server', icon: Briefcase, action: () => navigate('/serve') },
```

**Step 3: Commit**

```
git add client/src/components/Layout.tsx client/src/components/MenuBar.tsx
git commit -m "feat(serve): add process server to navigation and menu bar"
```

---

### Task 11: Build Verification and Deploy

**Step 1: Server TypeScript check**

Run: `cd server && npx tsc --noEmit`
Expected: No errors

**Step 2: Client build**

Run: `cd client && npx vite build`
Expected: Build succeeds with no errors

**Step 3: Deploy to production**

Deploy both server and client dist to VPS, restart service, verify health endpoint.

**Step 4: Final commit and push**

```
git add -A
git commit -m "feat: Process Server Field Suite — complete implementation"
git push origin claude/eager-roentgen
```

Then merge into main and push main.

---

## Implementation Order Summary

| Task | Description | Est. Time |
|------|-------------|-----------|
| 1 | Database schema (4 tables) | 5 min |
| 2 | Server route (serve.ts + registration) | 15 min |
| 3 | TypeScript types | 5 min |
| 4 | ServeJobCard component | 10 min |
| 5 | ServeAttemptModal (4-step wizard) | 20 min |
| 6 | ServeRoutePlanner component | 20 min |
| 7 | ServeSkipTracePanel component | 10 min |
| 8 | ServePage main component | 20 min |
| 9 | PDF templates (3 affidavits) | 15 min |
| 10 | Navigation integration | 5 min |
| 11 | Build verification and deploy | 5 min |

**Total estimated: ~2.5 hours**
