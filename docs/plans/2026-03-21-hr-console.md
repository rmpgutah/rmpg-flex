# HR Console Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a full HR management console at `/hr` with dashboard, leave/PTO, disciplinary records, and performance reviews.

**Architecture:** New route `server/src/routes/hr.ts` with 4 new SQLite tables. Frontend uses tab-per-file pattern matching Personnel module: shell page + tab components + modal forms. Role-based filtering: officers see own data, managers/admins see org-wide.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Express, better-sqlite3, existing design system (surface colors, panel-beveled, PanelTitleBar)

**Design Doc:** `docs/plans/2026-03-21-hr-console-design.md`

---

### Task 1: Database Tables

**Files:**
- Modify: `server/src/models/database.ts` — add 4 new CREATE TABLE statements after the existing `deployments` table (~line 935)

**Step 1: Add leave_requests table**

Add after the `officer_equipment` / `deployments` tables section:

```sql
CREATE TABLE IF NOT EXISTS leave_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id INTEGER NOT NULL,
  type TEXT NOT NULL DEFAULT 'vacation' CHECK(type IN ('vacation','sick','personal','bereavement','training','unpaid')),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  hours_requested REAL NOT NULL DEFAULT 0,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','denied','cancelled')),
  reviewed_by INTEGER,
  reviewed_at TEXT,
  review_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (officer_id) REFERENCES users(id),
  FOREIGN KEY (reviewed_by) REFERENCES users(id)
);
```

**Step 2: Add leave_balances table**

```sql
CREATE TABLE IF NOT EXISTS leave_balances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id INTEGER NOT NULL,
  year INTEGER NOT NULL,
  vacation_total REAL NOT NULL DEFAULT 80,
  vacation_used REAL NOT NULL DEFAULT 0,
  sick_total REAL NOT NULL DEFAULT 40,
  sick_used REAL NOT NULL DEFAULT 0,
  personal_total REAL NOT NULL DEFAULT 24,
  personal_used REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (officer_id) REFERENCES users(id),
  UNIQUE(officer_id, year)
);
```

**Step 3: Add disciplinary_records table**

```sql
CREATE TABLE IF NOT EXISTS disciplinary_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id INTEGER NOT NULL,
  type TEXT NOT NULL DEFAULT 'verbal_warning' CHECK(type IN ('verbal_warning','written_warning','suspension','termination','commendation','counseling')),
  severity TEXT NOT NULL DEFAULT 'minor' CHECK(severity IN ('minor','moderate','major','critical')),
  incident_date TEXT NOT NULL,
  description TEXT NOT NULL,
  action_taken TEXT,
  follow_up_date TEXT,
  follow_up_notes TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed','appealed')),
  issued_by INTEGER NOT NULL,
  witness TEXT,
  attachments TEXT DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (officer_id) REFERENCES users(id),
  FOREIGN KEY (issued_by) REFERENCES users(id)
);
```

**Step 4: Add performance_reviews table**

```sql
CREATE TABLE IF NOT EXISTS performance_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id INTEGER NOT NULL,
  reviewer_id INTEGER NOT NULL,
  review_period_start TEXT NOT NULL,
  review_period_end TEXT NOT NULL,
  review_date TEXT,
  type TEXT NOT NULL DEFAULT 'annual' CHECK(type IN ('annual','probationary','quarterly','improvement_plan')),
  overall_rating INTEGER CHECK(overall_rating BETWEEN 1 AND 5),
  categories TEXT DEFAULT '{}',
  strengths TEXT,
  areas_for_improvement TEXT,
  goals TEXT,
  officer_comments TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','acknowledged','completed')),
  acknowledged_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (officer_id) REFERENCES users(id),
  FOREIGN KEY (reviewer_id) REFERENCES users(id)
);
```

**Step 5: Commit**

```bash
git add server/src/models/database.ts
git commit -m "feat(hr): add database tables for leave, disciplinary, and reviews"
```

---

### Task 2: TypeScript Types

**Files:**
- Modify: `client/src/types/index.ts` — add HR types after existing personnel types (~line 982)

**Step 1: Add all HR types**

```typescript
// ─── HR Console Types ─────────────────────────────────────────

export type LeaveType = 'vacation' | 'sick' | 'personal' | 'bereavement' | 'training' | 'unpaid';
export type LeaveStatus = 'pending' | 'approved' | 'denied' | 'cancelled';

export interface LeaveRequest {
  id: number;
  officer_id: number;
  officer_name?: string;
  type: LeaveType;
  start_date: string;
  end_date: string;
  hours_requested: number;
  reason: string;
  status: LeaveStatus;
  reviewed_by: number | null;
  reviewer_name?: string;
  reviewed_at: string | null;
  review_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeaveBalance {
  id: number;
  officer_id: number;
  officer_name?: string;
  year: number;
  vacation_total: number;
  vacation_used: number;
  sick_total: number;
  sick_used: number;
  personal_total: number;
  personal_used: number;
}

export type DisciplinaryType = 'verbal_warning' | 'written_warning' | 'suspension' | 'termination' | 'commendation' | 'counseling';
export type DisciplinarySeverity = 'minor' | 'moderate' | 'major' | 'critical';
export type DisciplinaryStatus = 'open' | 'closed' | 'appealed';

export interface DisciplinaryRecord {
  id: number;
  officer_id: number;
  officer_name?: string;
  type: DisciplinaryType;
  severity: DisciplinarySeverity;
  incident_date: string;
  description: string;
  action_taken: string | null;
  follow_up_date: string | null;
  follow_up_notes: string | null;
  status: DisciplinaryStatus;
  issued_by: number;
  issuer_name?: string;
  witness: string | null;
  attachments: string[];
  created_at: string;
  updated_at: string;
}

export type ReviewType = 'annual' | 'probationary' | 'quarterly' | 'improvement_plan';
export type ReviewStatus = 'draft' | 'submitted' | 'acknowledged' | 'completed';

export interface PerformanceReview {
  id: number;
  officer_id: number;
  officer_name?: string;
  reviewer_id: number;
  reviewer_name?: string;
  review_period_start: string;
  review_period_end: string;
  review_date: string | null;
  type: ReviewType;
  overall_rating: number | null;
  categories: Record<string, number>;
  strengths: string | null;
  areas_for_improvement: string | null;
  goals: string | null;
  officer_comments: string | null;
  status: ReviewStatus;
  acknowledged_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface HRDashboardData {
  headcount: { active: number; new_hires_30d: number; terminations_30d: number; on_leave_today: number };
  compliance: { training_pct: number; credential_pct: number; overdue_count: number };
  pending_leave: number;
  pending_reviews: number;
  recent_activity: Array<{ id: number; type: string; description: string; officer_name: string; created_at: string }>;
}
```

**Step 2: Commit**

```bash
git add client/src/types/index.ts
git commit -m "feat(hr): add TypeScript types for HR console"
```

---

### Task 3: Backend API Routes

**Files:**
- Create: `server/src/routes/hr.ts`
- Modify: `server/src/index.ts` — register route (~line 105 for import, ~line 396 for app.use)

**Step 1: Create `server/src/routes/hr.ts`**

Full route file implementing all endpoints from design doc:
- `GET /api/hr/dashboard` — aggregated dashboard metrics
- `GET /api/hr/leave` — list leave requests (filtered by officer/status/date)
- `POST /api/hr/leave` — submit leave request
- `PUT /api/hr/leave/:id` — update own pending request
- `POST /api/hr/leave/:id/approve` — approve (manager+)
- `POST /api/hr/leave/:id/deny` — deny (manager+)
- `DELETE /api/hr/leave/:id` — cancel own pending request
- `GET /api/hr/leave/balances` — get balances
- `PUT /api/hr/leave/balances/:id` — override balance (admin)
- `GET /api/hr/disciplinary` — list records
- `GET /api/hr/disciplinary/:officerId/timeline` — officer timeline
- `POST /api/hr/disciplinary` — create (admin/manager)
- `PUT /api/hr/disciplinary/:id` — update (admin/manager)
- `DELETE /api/hr/disciplinary/:id` — delete (admin)
- `GET /api/hr/reviews` — list reviews
- `POST /api/hr/reviews` — create (manager+)
- `PUT /api/hr/reviews/:id` — update (manager+)
- `POST /api/hr/reviews/:id/acknowledge` — officer acknowledges
- `DELETE /api/hr/reviews/:id` — delete draft (admin)

Pattern: follows `server/src/routes/personnel.ts` structure using `getDb()`, `authenticateToken`, `requireRole`, `auditLog`, `localNow()`.

Role-based filtering on GET endpoints:
- Admin/manager: see all records
- Supervisor: see own team (officers they supervise)
- Officer/dispatcher: see only own records

**Step 2: Register route in `server/src/index.ts`**

Add import (~line 105):
```typescript
import hrRoutes from './routes/hr';
```

Add mount (~line 396, after personnel):
```typescript
app.use('/api/hr', hrRoutes);
```

**Step 3: Commit**

```bash
git add server/src/routes/hr.ts server/src/index.ts
git commit -m "feat(hr): add backend API routes for HR console"
```

---

### Task 4: Frontend — HR Page Shell + Constants

**Files:**
- Create: `client/src/pages/hr/HRPage.tsx`
- Create: `client/src/pages/hr/utils/hrConstants.ts`

**Step 1: Create constants file**

`client/src/pages/hr/utils/hrConstants.ts` — tab definitions, color maps for leave types, severity colors, rating labels, review categories.

**Step 2: Create HRPage shell**

`client/src/pages/hr/HRPage.tsx` — ~200 line shell component:
- Uses `usePersistedTab` for tab state
- Imports and renders 4 tab components (Dashboard, Leave, Disciplinary, Reviews)
- Tab bar matching Personnel page pattern
- Role-aware: shows different content based on user role
- Uses `PanelTitleBar` header with `UserCog` icon

**Step 3: Commit**

```bash
git add client/src/pages/hr/
git commit -m "feat(hr): add HR page shell and constants"
```

---

### Task 5: Frontend — Dashboard Tab

**Files:**
- Create: `client/src/pages/hr/tabs/HRDashboardTab.tsx`

**Step 1: Build dashboard tab**

Manager/admin view:
- 4 headcount metric cards (active, new hires, terminations, on leave)
- Compliance ring/progress indicators
- Pending approvals badge (clickable)
- Recent activity feed

Officer self-service view:
- PTO balance cards with progress bars
- Next review info
- Expiring credentials
- "Request Time Off" quick action button

Fetches from `GET /api/hr/dashboard`.

**Step 2: Commit**

```bash
git add client/src/pages/hr/tabs/HRDashboardTab.tsx
git commit -m "feat(hr): add dashboard tab with metrics and self-service view"
```

---

### Task 6: Frontend — Leave Tab + Modal

**Files:**
- Create: `client/src/pages/hr/tabs/LeaveTab.tsx`
- Create: `client/src/pages/hr/modals/LeaveRequestModal.tsx`

**Step 1: Build leave request modal**

Form with: leave type dropdown, date range picker, hours (auto-calculated from dates), reason textarea. Shows current balance for selected type.

**Step 2: Build leave tab**

Officer view: balance cards, request form trigger, request history table.
Manager view: pending approvals with approve/deny, team calendar, balance table.

Filter controls: officer picker (manager+), status, type, date range.

**Step 3: Commit**

```bash
git add client/src/pages/hr/tabs/LeaveTab.tsx client/src/pages/hr/modals/LeaveRequestModal.tsx
git commit -m "feat(hr): add leave/PTO tab with request and approval workflow"
```

---

### Task 7: Frontend — Disciplinary Tab + Modal

**Files:**
- Create: `client/src/pages/hr/tabs/DisciplinaryTab.tsx`
- Create: `client/src/pages/hr/modals/DisciplinaryFormModal.tsx`

**Step 1: Build disciplinary form modal**

Officer picker, type dropdown, severity, incident date, description, action taken, follow-up date, witness field. Commendation type gets gold/positive styling.

**Step 2: Build disciplinary tab**

Record list with severity color bands and type icons.
Filter by officer, type, severity, status, date range.
Timeline view toggle per officer.
Commendations section with separate visual treatment.

Officer self-view: read-only list of own records, commendations highlighted, no issuer/witness shown.

**Step 3: Commit**

```bash
git add client/src/pages/hr/tabs/DisciplinaryTab.tsx client/src/pages/hr/modals/DisciplinaryFormModal.tsx
git commit -m "feat(hr): add disciplinary records tab with timeline view"
```

---

### Task 8: Frontend — Reviews Tab + Modal

**Files:**
- Create: `client/src/pages/hr/tabs/ReviewsTab.tsx`
- Create: `client/src/pages/hr/modals/ReviewFormModal.tsx`

**Step 1: Build review form modal**

Officer picker, review period (start/end dates), type dropdown, category ratings (1-5 star picker per category), narrative fields (strengths, areas for improvement, goals). Categories from `hrConstants.ts`.

**Step 2: Build reviews tab**

Manager view: review list with rating badges, create button, overdue/upcoming indicators.
Officer view: completed reviews (read-only), acknowledge button, rating trend chart.

**Step 3: Commit**

```bash
git add client/src/pages/hr/tabs/ReviewsTab.tsx client/src/pages/hr/modals/ReviewFormModal.tsx
git commit -m "feat(hr): add performance reviews tab with star ratings"
```

---

### Task 9: Navigation Integration

**Files:**
- Modify: `client/src/App.tsx` — add route (~line 207)
- Modify: `client/src/components/Layout.tsx` — add toolbar entry (~line 163) and page title (~line 117)
- Modify: `client/src/components/mobile/MobileDrawer.tsx` — add to Personnel section (~line 122)

**Step 1: Add route in App.tsx**

Add lazy import at top:
```typescript
const HRPage = lazy(() => import('./pages/hr/HRPage'));
```

Add route after `/personnel` (~line 171):
```tsx
<Route path="/hr" element={<HRPage />} />
```

**Step 2: Add to Layout.tsx toolbar**

Add to Personnel children (~line 164):
```typescript
{ path: '/hr', icon: UserCog, label: 'HR Console' },
```

Add to page titles (~line 117):
```typescript
'/hr': 'HR Console',
```

**Step 3: Add to MobileDrawer.tsx**

Add to Personnel section (~line 122):
```typescript
{ path: '/hr', icon: ClipboardCheck, label: 'HR Console' },
```

Import `ClipboardCheck` from lucide-react if not already imported.

**Step 4: Commit**

```bash
git add client/src/App.tsx client/src/components/Layout.tsx client/src/components/mobile/MobileDrawer.tsx
git commit -m "feat(hr): add navigation entries for HR console"
```

---

### Task 10: Build, Deploy, Verify

**Step 1: Build client**

```bash
cd client && npx vite build
```

Expected: `✓ built in ~8s` with no TypeScript errors.

**Step 2: Deploy**

```bash
cd .. && bash deploy/deploy.sh
```

Expected: `>>> All done! Server is live at https://rmpgutah.us`

**Step 3: Verify health**

```bash
ssh root@194.113.64.90 "curl -sf https://rmpgutah.us/api/health"
```

Expected: `{"status":"ok",...}`

**Step 4: Verify tables created**

```bash
ssh root@194.113.64.90 "cd /opt/rmpg-flex/server && node -e \"const db=require('better-sqlite3')('data/rmpg-flex.db'); console.log(db.prepare(\\\"SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'leave%' OR name LIKE 'disciplinary%' OR name LIKE 'performance%'\\\").all());\""
```

Expected: 4 tables listed.

**Step 5: Commit verification**

```bash
git commit --allow-empty -m "chore(hr): verified HR console deployed and operational"
```
