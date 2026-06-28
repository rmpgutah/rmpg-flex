# OVERWATCH CRM Enhancement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Horizontal sweep upgrade across all OVERWATCH CRM sections — visible improvements everywhere with deep treatment on proposals, contract renewals, and invoice lifecycle.

**Architecture:** Existing Express routes extended with new endpoints; React tabs receive new sub-sections using current apiFetch/useToast/panel-inset patterns; proposal PDF uses the shared pdfGenerator.ts helpers already used by invoices. No new libraries.

**Tech Stack:** React 18 + TypeScript, Express 4, better-sqlite3, jsPDF + shared pdfGenerator/pdfTokens utilities, Tailwind dark theme.

---

## Pre-flight checks

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/loving-meninsky"
git status
cd client && npx tsc --noEmit && cd ..
cd server && npx tsc --noEmit && cd ..
```

---

## Task 1: DB Migrations

**Files:**
- Modify: `server/src/models/database.ts` — end of `migrateSchema()` function

Add the following at the END of the `migrateSchema()` function (before its closing brace), following the same `addCol` + try/catch `db.exec` pattern already used throughout:

**Step 1: Locate the end of migrateSchema()**

Find the last `addCol` or `db.exec` block in `migrateSchema()`. The function ends at the closing `}` of `function migrateSchema(): void`.

**Step 2: Add new column migrations and tables**

```typescript
  // ── OVERWATCH CRM ENHANCEMENTS ─────────────────────────

  // Properties — risk level
  addCol('properties', 'risk_level', "TEXT DEFAULT 'low'");

  // Proposals — stage timestamp tracking
  addCol('crm_proposals', 'stage_entered_at', 'TEXT');

  // Tasks — track auto-created tasks
  addCol('crm_tasks', 'auto_created_by', 'TEXT');

  // Invoices — recurring billing
  addCol('invoices', 'is_recurring', 'INTEGER DEFAULT 0');
  addCol('invoices', 'recurrence_interval', 'TEXT');
  addCol('invoices', 'recurrence_anchor', 'TEXT');

  // Proposal version history table
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS crm_proposal_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        proposal_id INTEGER NOT NULL REFERENCES crm_proposals(id) ON DELETE CASCADE,
        version_num INTEGER NOT NULL DEFAULT 1,
        snapshot TEXT NOT NULL,
        edited_by INTEGER,
        edited_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_cpv_proposal ON crm_proposal_versions(proposal_id);
    `);
  } catch { /* already exists */ }

  // Payment recording table
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS crm_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        amount REAL NOT NULL,
        paid_at TEXT NOT NULL,
        method TEXT,
        reference TEXT,
        recorded_by INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_crm_payments_invoice ON crm_payments(invoice_id);
    `);
  } catch { /* already exists */ }
```

**Step 3: Verify server starts**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/loving-meninsky/server"
npx tsc --noEmit
```

Expected: No errors.

**Step 4: Commit**

```bash
git add server/src/models/database.ts
git commit -m "feat(crm): add DB migrations for OVERWATCH enhancements"
```

---

## Task 2: New Server Endpoints

**Files:**
- Modify: `server/src/routes/crm.ts`
- Modify: `server/src/routes/crmProposals.ts`

### 2a — Revenue trend endpoint (crm.ts)

Add after the existing `GET /reports/metrics` route:

```typescript
// GET /crm/reports/revenue-trend?months=6
router.get('/reports/revenue-trend', requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const months = Math.min(Number(req.query.months) || 6, 24);
    const rows = db.prepare(`
      WITH RECURSIVE months(m) AS (
        SELECT date('now','start of month','-' || (? - 1) || ' months')
        UNION ALL
        SELECT date(m, '+1 month') FROM months WHERE m < date('now','start of month')
      )
      SELECT
        strftime('%Y-%m', m) AS month,
        COALESCE(SUM(CASE WHEN strftime('%Y-%m', i.issue_date) = strftime('%Y-%m', m) THEN i.total ELSE 0 END), 0) AS invoiced,
        COALESCE(SUM(CASE WHEN strftime('%Y-%m', i.paid_date) = strftime('%Y-%m', m) AND i.status = 'paid' THEN i.total ELSE 0 END), 0) AS paid
      FROM months
      LEFT JOIN invoices i ON strftime('%Y-%m', i.issue_date) = strftime('%Y-%m', m)
        AND i.status NOT IN ('void','cancelled')
      GROUP BY strftime('%Y-%m', m)
      ORDER BY month
    `).all(months);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

### 2b — Client incidents endpoint (crm.ts)

```typescript
// GET /crm/clients/:id/incidents?limit=20
router.get('/clients/:id/incidents', validateParamId, requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const rows = db.prepare(`
      SELECT c.id, c.call_number, c.incident_type, c.status, c.disposition,
             c.location_address, c.created_at, p.name AS property_name
      FROM calls_for_service c
      JOIN properties p ON p.id = c.property_id
      WHERE p.client_id = ?
      ORDER BY c.created_at DESC
      LIMIT ?
    `).all(req.params.id, limit);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

### 2c — Property incident counts (crm.ts)

```typescript
// GET /crm/properties/incident-counts
router.get('/properties/incident-counts', requireRole('admin', 'manager', 'contract_manager'), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT property_id, COUNT(*) AS count_30d
      FROM calls_for_service
      WHERE created_at >= datetime('now', '-30 days')
        AND property_id IS NOT NULL
      GROUP BY property_id
    `).all();
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

### 2d — Proposal send endpoint (crmProposals.ts)

Add after `PUT /proposals/:id/stage`:

```typescript
// POST /crm/proposals/:id/send
router.post('/proposals/:id/send', validateParamId, requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const proposal = db.prepare('SELECT * FROM crm_proposals WHERE id = ?').get(id) as any;
    if (!proposal) { res.status(404).json({ error: 'Proposal not found' }); return; }

    const now = localNow();
    const stageMap: Record<string, string> = proposal.stage_entered_at
      ? JSON.parse(proposal.stage_entered_at) : {};
    if (!stageMap['sent']) stageMap['sent'] = now;

    db.prepare(`
      UPDATE crm_proposals SET stage = 'sent', sent_at = ?, stage_entered_at = ?, updated_at = ? WHERE id = ?
    `).run(now, JSON.stringify(stageMap), now, id);

    if (proposal.client_id) {
      db.prepare(`
        INSERT INTO crm_activity (client_id, activity_type, subject, details, created_by, created_at)
        VALUES (?, 'email', ?, ?, ?, ?)
      `).run(proposal.client_id, `Proposal sent: ${proposal.proposal_number}`,
        `Proposal "${proposal.title}" marked as sent`, (req as any).user?.id || null, now);
    }

    auditLog(req, 'UPDATE', 'crm_proposals', id, null, { stage: 'sent' });
    res.json({ success: true });
  } catch (err: any) {
    console.error('Proposal send error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

### 2e — Proposal version snapshot on PUT (crmProposals.ts)

In the existing `PUT /proposals/:id` handler, BEFORE the UPDATE statement, insert:

```typescript
    // Snapshot current state as version
    const versionCount = (db.prepare('SELECT COUNT(*) AS c FROM crm_proposal_versions WHERE proposal_id = ?').get(id) as any)?.c || 0;
    db.prepare(`
      INSERT INTO crm_proposal_versions (proposal_id, version_num, snapshot, edited_by, edited_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, versionCount + 1, JSON.stringify(existing), (req as any).user?.id || null, localNow());
```

### 2f — Proposal versions list endpoint (crmProposals.ts)

```typescript
// GET /crm/proposals/:id/versions
router.get('/proposals/:id/versions', validateParamId, requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT v.*, u.full_name AS edited_by_name
      FROM crm_proposal_versions v
      LEFT JOIN users u ON u.id = v.edited_by
      WHERE v.proposal_id = ?
      ORDER BY v.version_num DESC LIMIT 20
    `).all(req.params.id);
    res.json(rows);
  } catch { res.status(500).json({ error: 'Internal server error' }); }
});
```

### 2g — Recurring invoices due (crm.ts)

```typescript
// GET /crm/invoices/due-recurring
router.get('/invoices/due-recurring', requireRole('admin', 'manager', 'contract_manager'), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT i.*, c.name AS client_name
      FROM invoices i JOIN clients c ON c.id = i.client_id
      WHERE i.is_recurring = 1 AND i.status = 'paid' AND i.recurrence_interval IS NOT NULL
        AND (
          (i.recurrence_interval = 'monthly' AND i.period_end < date('now'))
          OR (i.recurrence_interval = 'quarterly' AND i.period_end < date('now', '-2 months'))
          OR (i.recurrence_interval = 'annually' AND i.period_end < date('now', '-11 months'))
        )
      ORDER BY i.period_end DESC LIMIT 50
    `).all();
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

### 2h — Payment recording (crm.ts)

```typescript
// POST /crm/invoices/:id/payments
router.post('/invoices/:id/payments', validateParamId, requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const { amount, paid_at, method, reference } = req.body;
    if (!amount || !paid_at) { res.status(400).json({ error: 'amount and paid_at required' }); return; }

    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as any;
    if (!invoice) { res.status(404).json({ error: 'Invoice not found' }); return; }

    const now = localNow();
    db.prepare(`
      INSERT INTO crm_payments (invoice_id, amount, paid_at, method, reference, recorded_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, Number(amount), paid_at, method || null, reference || null, (req as any).user?.id || null, now);

    const { total_paid } = db.prepare('SELECT SUM(amount) AS total_paid FROM crm_payments WHERE invoice_id = ?').get(id) as any;
    const newBalance = Math.max(0, invoice.total - (total_paid || 0));
    const newStatus = newBalance <= 0 ? 'paid' : invoice.status;

    db.prepare(`
      UPDATE invoices SET amount_paid = ?, balance_due = ?, status = ?,
        paid_date = CASE WHEN ? = 'paid' THEN ? ELSE paid_date END, updated_at = ?
      WHERE id = ?
    `).run(total_paid || 0, newBalance, newStatus, newStatus, paid_at, now, id);

    auditLog(req, 'payment_recorded', 'invoices', id, null, { amount, method });
    res.json({ success: true, amount_paid: total_paid, balance_due: newBalance, status: newStatus });
  } catch (err: any) {
    console.error('Payment error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

### 2i — Contract renewal auto-tasks (crm.ts)

```typescript
// POST /crm/check-renewals
router.post('/check-renewals', requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const thresholds = [
      { days: 90, key: 'contract_renewal_90d', label: '90-day renewal notice' },
      { days: 60, key: 'contract_renewal_60d', label: '60-day renewal notice' },
      { days: 30, key: 'contract_renewal_30d', label: '30-day renewal notice' },
    ];

    let created = 0;
    for (const { days, key, label } of thresholds) {
      const clients = db.prepare(`
        SELECT id, name FROM clients
        WHERE status = 'active' AND contract_end IS NOT NULL AND auto_renew = 0
          AND contract_end BETWEEN date('now') AND date('now', '+${days} days')
      `).all() as any[];

      for (const client of clients) {
        const exists = db.prepare(`
          SELECT id FROM crm_tasks
          WHERE client_id = ? AND auto_created_by = ? AND status NOT IN ('completed','cancelled')
        `).get(client.id, key);
        if (!exists) {
          db.prepare(`
            INSERT INTO crm_tasks (client_id, title, task_type, priority, due_date, auto_created_by, created_by, created_at, updated_at)
            VALUES (?, ?, 'contract_renewal', 'high', date('now', '+7 days'), ?, ?, ?, ?)
          `).run(client.id, `${label} — ${client.name}`, key, (req as any).user?.id || null, now, now);
          created++;
        }
      }
    }
    res.json({ created });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

### 2j — Revenue by client (crm.ts, extend existing GET /reports/revenue)

Find the existing `GET /reports/revenue` handler. At the end, before `res.json(...)`, add a `byClient` query and include it in the response:

```typescript
    const byClient = db.prepare(`
      SELECT c.name AS client_name, c.id AS client_id,
        SUM(CASE WHEN strftime('%Y-%m', i.issue_date) = strftime('%Y-%m', 'now') THEN i.total ELSE 0 END) AS mtd,
        SUM(CASE WHEN strftime('%Y', i.issue_date) = strftime('%Y', 'now') THEN i.total ELSE 0 END) AS ytd
      FROM invoices i JOIN clients c ON c.id = i.client_id
      WHERE i.status NOT IN ('void','cancelled','draft')
      GROUP BY c.id ORDER BY ytd DESC LIMIT 10
    `).all();
    // Merge into the existing response: res.json({ ...existingData, byClient });
```

**Step 1: Typecheck server**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/loving-meninsky/server"
npx tsc --noEmit
```

Expected: No errors.

**Step 2: Commit**

```bash
git add server/src/routes/crm.ts server/src/routes/crmProposals.ts
git commit -m "feat(crm): add revenue-trend, incidents, payments, proposal-send, renewal endpoints"
```

---

## Task 3: Dashboard Enhancements

**Files:**
- Modify: `client/src/pages/CrmPage.tsx`

### 3a — Add RevenueTrendRow type and new state

After the existing import block, add:

```typescript
interface RevenueTrendRow { month: string; invoiced: number; paid: number; }
```

In the component body alongside existing state:

```typescript
const [revenueTrend, setRevenueTrend] = useState<RevenueTrendRow[]>([]);
const [upcomingTasks, setUpcomingTasks] = useState<any[]>([]);
const [pipelineValue, setPipelineValue] = useState(0);
```

### 3b — Extend fetchDashboard

Inside `fetchDashboard`, alongside existing fetches, add:

```typescript
const [trendRes, pipelineRes] = await Promise.all([
  apiFetch<RevenueTrendRow[]>('/crm/reports/revenue-trend?months=6').catch(() => []),
  apiFetch<{ stages: any[] }>('/crm/leads/pipeline-summary').catch(() => ({ stages: [] })),
]);
if (Array.isArray(trendRes)) setRevenueTrend(trendRes);
if (pipelineRes?.stages) {
  const val = pipelineRes.stages
    .filter((s: any) => !['lost', 'dismissed', 'won'].includes(s.stage))
    .reduce((sum: number, s: any) => sum + (s.total_value || 0), 0);
  setPipelineValue(val);
}
```

Also fire the renewal check on dashboard load:

```typescript
apiFetch('/crm/check-renewals', { method: 'POST' }).catch(() => {});
```

For upcoming tasks, extend the existing `fetchTasks` or add inline:

```typescript
apiFetch<{ tasks: any[] }>('/crm/tasks?status=pending').then(r => {
  const tasks = (r?.tasks || (Array.isArray(r) ? r : []));
  const week = Date.now() + 7 * 86400000;
  setUpcomingTasks(tasks.filter((t: any) => !t.due_date || new Date(t.due_date).getTime() <= week).slice(0, 8));
}).catch(() => {});
```

### 3c — Add PipelineFunnel component

Add this before `export default function CrmPage()`:

```tsx
function PipelineFunnel({ onStageClick }: { onStageClick: (stage: string) => void }) {
  const [stages, setStages] = useState<any[]>([]);
  useEffect(() => {
    apiFetch<{ stages: any[] }>('/crm/leads/pipeline-summary')
      .then(r => { if (r?.stages) setStages(r.stages.filter((s: any) => !['lost','dismissed'].includes(s.stage))); })
      .catch(() => {});
  }, []);
  const maxCount = Math.max(...stages.map(s => s.count), 1);
  const COLORS: Record<string, string> = { new: '#3b82f6', contacted: '#8b5cf6', qualified: '#d4a017', proposal: '#f59e0b', negotiation: '#f97316', won: '#22c55e' };
  return (
    <div className="flex items-end gap-1 h-14">
      {stages.map((s: any) => (
        <button key={s.stage} onClick={() => onStageClick(s.stage)} className="flex-1 flex flex-col items-center gap-0.5 group">
          <span className="text-[9px] text-rmpg-400 font-mono">{s.count}</span>
          <div className="w-full rounded-sm" style={{ height: `${Math.max((s.count / maxCount) * 40, 4)}px`, backgroundColor: COLORS[s.stage] || '#6b7280', opacity: 0.7 }} />
          <span className="text-[8px] text-rmpg-500 capitalize group-hover:text-white">{s.stage}</span>
        </button>
      ))}
    </div>
  );
}
```

### 3d — Replace renderDashboard body

Replace the full content of `renderDashboard()` with:

```tsx
  function renderDashboard() {
    const maxTrend = Math.max(...revenueTrend.map(r => Math.max(r.invoiced, r.paid)), 1);
    return (
      <div className="flex-1 overflow-y-auto">
        <PanelTitleBar title="OVERWATCH DASHBOARD" icon={LayoutDashboard}>
          <RmpgLogo height={16} iconOnly />
          <button onClick={() => fetchDashboard()} className="toolbar-btn"><RefreshCw className="w-3 h-3" /> Refresh</button>
          <button onClick={() => { setActivityForm({ client_id: '', activity_type: 'note', subject: '', details: '' }); setShowActivityModal(true); }} className="toolbar-btn toolbar-btn-primary">
            <Plus className="w-3 h-3" /> Log Activity
          </button>
        </PanelTitleBar>

        {stats && (
          <div className="p-4 space-y-4">
            {/* 5 Stat Cards */}
            <div className="grid grid-cols-5 gap-3">
              <StatCard icon={Building2} label="Active Clients" value={stats.active_clients} sub={`${stats.total_clients} total`} color="text-brand-400" />
              <StatCard icon={DollarSign} label="Outstanding" value={formatCurrency(stats.outstanding_revenue)} sub={`${stats.overdue_invoices} overdue`} color="text-amber-400" />
              <StatCard icon={TrendingUp} label="Invoiced MTD" value={formatCurrency(stats.total_invoiced_mtd)} sub={`${formatCurrency(stats.total_paid_mtd)} paid`} color="text-green-400" />
              <StatCard icon={CheckSquare} label="Pending Tasks" value={stats.pending_tasks} sub={`${stats.expiring_contracts} contracts expiring`} color="text-blue-400" />
              <StatCard icon={Target} label="Pipeline Value" value={formatCurrency(pipelineValue)} sub="open leads" color="text-purple-400" />
            </div>

            <div className="grid grid-cols-3 gap-4">
              {/* Expiring Contracts */}
              <div className="panel-inset p-3">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-xs font-bold text-white">Expiring Contracts (90d)</span>
                </div>
                {expiringContracts.length === 0
                  ? <p className="text-xs text-rmpg-400">No contracts expiring soon</p>
                  : <div className="space-y-1.5 max-h-40 overflow-y-auto">
                      {expiringContracts.map((c: any) => (
                        <div key={c.id} className="flex items-center justify-between text-xs p-1.5 bg-surface-sunken border border-rmpg-700/30">
                          <div>
                            <span className="text-rmpg-200 font-medium">{c.name}</span>
                            {c.auto_renew ? <span className="text-green-400 text-[9px] ml-1">AUTO</span> : null}
                          </div>
                          <span className="text-amber-400 font-mono">{formatDate(c.contract_end)}</span>
                        </div>
                      ))}
                    </div>
                }
              </div>

              {/* Revenue Trend */}
              <div className="panel-inset p-3">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="w-3.5 h-3.5 text-green-400" />
                  <span className="text-xs font-bold text-white">Revenue (6 mo)</span>
                </div>
                <svg width="100%" height="72" viewBox="0 0 280 72">
                  {revenueTrend.map((row, i) => {
                    const x = revenueTrend.length > 1 ? (i / (revenueTrend.length - 1)) * 260 + 10 : 140;
                    const invH = Math.max((row.invoiced / maxTrend) * 52, 1);
                    const paidH = Math.max((row.paid / maxTrend) * 52, 1);
                    const bw = 20;
                    return (
                      <g key={row.month}>
                        <rect x={x - bw / 2} y={68 - invH} width={bw} height={invH} fill="#1a5a9e" opacity={0.5} />
                        <rect x={x - bw / 2} y={68 - paidH} width={bw / 2} height={paidH} fill="#22c55e" opacity={0.8} />
                        <text x={x} y={72} fontSize={7} fill="#6b7280" textAnchor="middle">{row.month.slice(5)}</text>
                      </g>
                    );
                  })}
                </svg>
                <div className="flex gap-3 text-[9px] text-rmpg-500 mt-1">
                  <span><span className="inline-block w-2 h-2 bg-brand-600/50 mr-1" />Invoiced</span>
                  <span><span className="inline-block w-2 h-2 bg-green-500/80 mr-1" />Paid</span>
                </div>
              </div>

              {/* Upcoming Tasks */}
              <div className="panel-inset p-3">
                <div className="flex items-center gap-2 mb-2">
                  <CheckSquare className="w-3.5 h-3.5 text-blue-400" />
                  <span className="text-xs font-bold text-white">Tasks This Week</span>
                </div>
                {upcomingTasks.length === 0
                  ? <p className="text-xs text-rmpg-400">No tasks due this week</p>
                  : <div className="space-y-1 max-h-40 overflow-y-auto">
                      {upcomingTasks.map((t: any) => (
                        <button key={t.id} onClick={() => setActiveSection('tasks')}
                          className="w-full text-left flex items-center gap-2 text-xs p-1.5 bg-surface-sunken border border-rmpg-700/30 hover:bg-white/5">
                          <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${t.priority === 'urgent' ? 'bg-red-500' : t.priority === 'high' ? 'bg-amber-500' : 'bg-blue-400'}`} />
                          <span className="flex-1 truncate text-rmpg-200">{t.title}</span>
                          {t.due_date && <span className="text-rmpg-400 font-mono shrink-0 text-[10px]">{formatDate(t.due_date)}</span>}
                        </button>
                      ))}
                    </div>
                }
              </div>
            </div>

            {/* Pipeline Funnel */}
            <div className="panel-inset p-3">
              <div className="flex items-center gap-2 mb-3">
                <Target className="w-3.5 h-3.5 text-purple-400" />
                <span className="text-xs font-bold text-white">Lead Pipeline</span>
                <span className="text-[10px] text-rmpg-400 ml-auto">Click stage to filter leads</span>
              </div>
              <PipelineFunnel onStageClick={() => setActiveSection('leads')} />
            </div>
          </div>
        )}
      </div>
    );
  }
```

**Step 1: Typecheck**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/loving-meninsky/client" && npx tsc --noEmit
```

**Step 2: Commit**

```bash
git add client/src/pages/CrmPage.tsx
git commit -m "feat(crm): dashboard command center — pipeline funnel, revenue trend, task widget, pipeline value"
```

---

## Task 4: Leads Tab Enhancements

**Files:**
- Modify: `client/src/components/crm/LeadsTab.tsx`
- Modify: `client/src/pages/CrmPage.tsx`

### 4a — Lead score badge

Locate the lead card/list item render (search for `lead.business_name`). After the name, add:

```tsx
{lead.lead_score != null && lead.lead_score > 0 && (
  <span className={`text-[9px] font-mono px-1 border rounded ${
    lead.lead_score >= 70 ? 'text-green-400 border-green-700/50 bg-green-900/20' :
    lead.lead_score >= 40 ? 'text-amber-400 border-amber-700/50 bg-amber-900/20' :
    'text-rmpg-400 border-rmpg-700/30'
  }`}>{lead.lead_score}</span>
)}
```

### 4b — Stale lead alert

Add a helper at the top of the file (after imports):

```typescript
function isStale(updatedAt: string | null | undefined): boolean {
  if (!updatedAt) return false;
  return (Date.now() - new Date(updatedAt).getTime()) > 14 * 24 * 60 * 60 * 1000;
}
```

In the lead card, after the score badge:

```tsx
{isStale(lead.updated_at) && !['won','lost','dismissed'].includes(lead.pipeline_stage) && (
  <span className="text-[9px] font-mono text-amber-400 border border-amber-700/30 px-1 bg-amber-900/10">
    STALE
  </span>
)}
```

### 4c — Pipeline value total

Near the pipeline header (wherever stage counts are shown), add:

```typescript
const pipelineTotal = leads
  .filter(l => !['lost','dismissed','won'].includes(l.pipeline_stage))
  .reduce((sum, l) => sum + (l.estimated_value || 0), 0);
```

```tsx
{pipelineTotal > 0 && (
  <div className="px-3 py-1.5 text-[10px] font-mono text-purple-400 border-b border-rmpg-700/30 bg-purple-950/10">
    PIPELINE VALUE: {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(pipelineTotal)}
  </div>
)}
```

### 4d — Quick-convert to proposal

Add prop to LeadsTab:

```typescript
interface LeadsTabProps {
  onCreateProposal?: (lead: CrmLead) => void;
}
export default function LeadsTab({ onCreateProposal }: LeadsTabProps) {
```

In the lead detail panel action buttons (find the area with stage-advance or edit buttons):

```tsx
{onCreateProposal && selectedLead && !['won','lost','dismissed'].includes(selectedLead.pipeline_stage) && (
  <button onClick={() => onCreateProposal(selectedLead)}
    className="toolbar-btn-primary text-[10px] flex items-center gap-1">
    <ArrowRight className="w-3 h-3" /> CONVERT TO PROPOSAL
  </button>
)}
```

In CrmPage.tsx, add state and wire prop:

```typescript
const [prefilledLead, setPrefilledLead] = useState<any | null>(null);
```

```tsx
{activeSection === 'leads' && (
  <LeadsTab onCreateProposal={(lead) => {
    setPrefilledLead(lead);
    setActiveSection('proposals');
  }} />
)}
```

Pass `prefillLead={prefilledLead}` to ProposalsTab (wired in Task 8).

**Step 1: Typecheck**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/loving-meninsky/client" && npx tsc --noEmit
```

**Step 2: Commit**

```bash
git add client/src/components/crm/LeadsTab.tsx client/src/pages/CrmPage.tsx
git commit -m "feat(crm): lead score badge, stale alert, pipeline value, quick-convert to proposal"
```

---

## Task 5: Client Section Enhancements

**Files:**
- Modify: `client/src/pages/CrmPage.tsx` — `renderClients()` function

### 5a — Add state for client detail

In component body with other state:

```typescript
const [clientDetailTab, setClientDetailTab] = useState<'activity' | 'incidents'>('activity');
const [clientIncidents, setClientIncidents] = useState<any[]>([]);
```

### 5b — Contract status banner

In the client detail right-panel, after the client name/contact info block, add:

```tsx
{selectedClient && selectedClient.contract_end && (() => {
  const daysLeft = Math.ceil((new Date(selectedClient.contract_end).getTime() - Date.now()) / 86400000);
  const cls = daysLeft < 0
    ? 'bg-red-950/40 border-red-700/40 text-red-300'
    : daysLeft < 30 ? 'bg-red-950/30 border-red-700/30 text-red-300'
    : daysLeft < 90 ? 'bg-amber-950/30 border-amber-700/30 text-amber-300'
    : 'bg-green-950/20 border-green-800/20 text-green-400';
  return (
    <div className={`mx-3 mt-2 px-3 py-1.5 border text-[11px] font-mono flex items-center justify-between ${cls}`}>
      <span>CONTRACT {daysLeft < 0 ? 'EXPIRED' : `EXPIRES IN ${daysLeft}d`}</span>
      <span>{formatDate(selectedClient.contract_end)}{selectedClient.auto_renew ? ' · AUTO-RENEW' : ''}</span>
    </div>
  );
})()}
```

### 5c — Quick-action bar

After the contract banner:

```tsx
<div className="flex gap-1 px-3 py-2 border-b border-rmpg-700/30">
  <button onClick={() => {
    setActivityForm({ client_id: String(selectedClientId), activity_type: 'call', subject: '', details: '' });
    setShowActivityModal(true);
  }} className="toolbar-btn text-[10px] flex items-center gap-1">
    <Phone className="w-3 h-3" /> Log Call
  </button>
  <button onClick={() => {
    setActivityForm({ client_id: String(selectedClientId), activity_type: 'email', subject: '', details: '' });
    setShowActivityModal(true);
  }} className="toolbar-btn text-[10px] flex items-center gap-1">
    <Mail className="w-3 h-3" /> Log Email
  </button>
  <button onClick={() => {
    setTaskForm({ client_id: String(selectedClientId), title: '', task_type: 'follow_up', priority: 'normal', due_date: '', assigned_to: '' });
    setShowTaskModal(true);
  }} className="toolbar-btn text-[10px] flex items-center gap-1">
    <CheckSquare className="w-3 h-3" /> New Task
  </button>
</div>
```

### 5d — Activity / Incidents sub-tab

Replace the plain "Recent Activity" section header in the client detail with a tab bar:

```tsx
<div className="flex border-b border-rmpg-700/30">
  {(['activity', 'incidents'] as const).map(tab => (
    <button key={tab} onClick={() => {
      setClientDetailTab(tab);
      if (tab === 'incidents' && selectedClientId) {
        apiFetch<any[]>(`/crm/clients/${selectedClientId}/incidents`)
          .then(r => Array.isArray(r) && setClientIncidents(r)).catch(() => {});
      }
    }} className={`px-3 py-1.5 text-[11px] font-mono ${clientDetailTab === tab ? 'text-white border-b-2 border-brand-500' : 'text-rmpg-400 hover:text-white'}`}>
      {tab.toUpperCase()}
    </button>
  ))}
</div>
```

Render incidents when tab is active (add as a conditional sibling to the existing activity list):

```tsx
{clientDetailTab === 'incidents' && (
  <div className="flex-1 overflow-y-auto p-2 space-y-1">
    {clientIncidents.length === 0
      ? <p className="text-xs text-rmpg-400 p-2">No incidents on record.</p>
      : clientIncidents.map((inc: any) => (
          <div key={inc.id} className="text-[11px] p-2 bg-surface-sunken border border-rmpg-700/20">
            <div className="flex justify-between">
              <span className="font-mono text-white">{inc.call_number || '—'}</span>
              <span className="text-rmpg-400">{formatDate(inc.created_at)}</span>
            </div>
            <div className="text-rmpg-300">{inc.incident_type} · {inc.property_name}</div>
            {inc.disposition && <div className="text-rmpg-400 text-[10px]">{inc.disposition}</div>}
          </div>
        ))
    }
  </div>
)}
```

**Step 1: Typecheck**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/loving-meninsky/client" && npx tsc --noEmit
```

**Step 2: Commit**

```bash
git add client/src/pages/CrmPage.tsx
git commit -m "feat(crm): client contract banner, quick-action bar, CAD incident feed tab"
```

---

## Task 6: Properties Enhancements

**Files:**
- Modify: `client/src/pages/CrmPage.tsx` — `renderProperties()` function
- Modify: `server/src/routes/crm.ts` — properties PUT route to include risk_level

### 6a — Incident count state

In component body:

```typescript
const [propertyIncidentCounts, setPropertyIncidentCounts] = useState<Record<number, number>>({});
```

In the `useEffect` that fires on `activeSection === 'properties'`:

```typescript
apiFetch<{ property_id: number; count_30d: number }[]>('/crm/properties/incident-counts')
  .then(r => {
    if (Array.isArray(r)) {
      const map: Record<number, number> = {};
      r.forEach(row => { map[row.property_id] = row.count_30d; });
      setPropertyIncidentCounts(map);
    }
  }).catch(() => {});
```

### 6b — Incident count chip in property list

Find the property list row render. After the property name/address, add:

```tsx
{(propertyIncidentCounts[p.id] || 0) > 0 && (
  <span className="text-[9px] font-mono text-amber-400 border border-amber-700/30 px-1 ml-1 bg-amber-900/10">
    {propertyIncidentCounts[p.id]} INC
  </span>
)}
```

### 6c — Risk level dot in property list

Before the property name:

```tsx
{(() => {
  const dots: Record<string, string> = { low: 'bg-green-500', medium: 'bg-amber-500', high: 'bg-orange-500', critical: 'bg-red-500' };
  return <span className={`inline-block w-2 h-2 rounded-full shrink-0 mr-1 ${dots[(p as any).risk_level || 'low'] || 'bg-green-500'}`} />;
})()}
```

### 6d — Risk level in property form

In the property edit form, add after existing fields:

```tsx
<div>
  <label className="block text-[10px] text-rmpg-400 mb-1">Risk Level</label>
  <select className="input-dark w-full text-xs"
    value={(propertyForm as any)?.risk_level || 'low'}
    onChange={e => setPropertyForm((f: any) => ({ ...f, risk_level: e.target.value }))}>
    <option value="low">Low</option>
    <option value="medium">Medium</option>
    <option value="high">High</option>
    <option value="critical">Critical</option>
  </select>
</div>
```

### 6e — Add risk_level to server properties PUT

In `server/src/routes/crm.ts`, find the `PUT /properties/:id` route. Add `'risk_level'` to the allowed update fields list.

**Step 1: Typecheck**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/loving-meninsky/client" && npx tsc --noEmit
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/loving-meninsky/server" && npx tsc --noEmit
```

**Step 2: Commit**

```bash
git add client/src/pages/CrmPage.tsx server/src/routes/crm.ts
git commit -m "feat(crm): property incident count chips and risk level field"
```

---

## Task 7: Proposal PDF Generator

**Files:**
- Create: `client/src/utils/proposalPdf.ts`

The invoice PDF at `client/src/utils/invoicePdfGenerator.ts` is the exact model. Follow the same pattern.

```typescript
// client/src/utils/proposalPdf.ts
import jsPDF from 'jspdf';
import {
  addReportHeader, openAutoSection, closeAutoSection,
  addFieldPair, addPageFooter, addWrappedText,
  fetchPdfBranding, setActiveBranding, setActiveFormKey,
  setActiveCaseNumber, setGenerationTimestamp,
  loadPdfAssets,
} from './pdfGenerator';
import {
  getLeftX, getRightColumnX, getHalfFieldWidth, getFullFieldWidth, getLineHeight,
} from './pdfTokens';

export interface ProposalPdfData {
  proposal_number: string;
  title: string;
  client_name?: string;
  client_address?: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  scope_of_work?: string;
  terms?: string;
  monthly_value?: number | null;
  total_value?: number | null;
  billing_frequency?: string | null;
  contract_length_months?: number | null;
  valid_until?: string | null;
  proposed_start?: string | null;
  proposed_end?: string | null;
  description?: string | null;
  notes?: string | null;
  created_by_name?: string;
}

function fmt(n: number | null | undefined): string {
  if (n == null) return '$0.00';
  return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
}

function fmtDate(d?: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export async function generateProposalPdf(data: ProposalPdfData): Promise<jsPDF> {
  const branding = await fetchPdfBranding();
  setActiveBranding(branding);
  await loadPdfAssets();
  setActiveFormKey('proposal');
  setActiveCaseNumber(data.proposal_number);
  setGenerationTimestamp(new Date().toLocaleString());

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  const lx = getLeftX();
  const rx = getRightColumnX(doc);
  const hfw = getHalfFieldWidth(doc);
  const ffw = getFullFieldWidth(doc);
  const lh = getLineHeight();

  let y = addReportHeader(doc, data.proposal_number, 'Service Proposal', 'routine', undefined, { useLogo: true });

  // Proposal Information
  { const sec = openAutoSection(doc, 'Proposal Information', y); y = sec.contentY;
    y = addFieldPair(doc, 'Proposal Number', data.proposal_number, 'Title', data.title, y, lx, rx, hfw);
    y = addFieldPair(doc, 'Prepared By', data.created_by_name || 'RMPG', 'Valid Until', fmtDate(data.valid_until), y, lx, rx, hfw);
    y = closeAutoSection(doc, sec, y) + 4; }

  // Client Information
  { const sec = openAutoSection(doc, 'Client Information', y); y = sec.contentY;
    y = addFieldPair(doc, 'Client', data.client_name || '—', 'Contact', data.contact_name || '—', y, lx, rx, hfw);
    y = addFieldPair(doc, 'Email', data.contact_email || '—', 'Phone', data.contact_phone || '—', y, lx, rx, hfw);
    if (data.client_address) y = addFieldPair(doc, 'Address', data.client_address, '', '', y, lx, rx, ffw);
    y = closeAutoSection(doc, sec, y) + 4; }

  // Service Terms
  { const sec = openAutoSection(doc, 'Service Terms', y); y = sec.contentY;
    y = addFieldPair(doc, 'Monthly Value', fmt(data.monthly_value), 'Total Contract Value', fmt(data.total_value), y, lx, rx, hfw);
    y = addFieldPair(doc, 'Billing', data.billing_frequency || '—', 'Contract Length', data.contract_length_months ? `${data.contract_length_months} months` : '—', y, lx, rx, hfw);
    y = addFieldPair(doc, 'Proposed Start', fmtDate(data.proposed_start), 'Proposed End', fmtDate(data.proposed_end), y, lx, rx, hfw);
    y = closeAutoSection(doc, sec, y) + 4; }

  // Scope of Work
  if (data.scope_of_work) {
    const sec = openAutoSection(doc, 'Scope of Work', y); y = sec.contentY;
    y = addWrappedText(doc, data.scope_of_work, lx, y, ffw, lh);
    y = closeAutoSection(doc, sec, y) + 4;
  }

  // Terms & Conditions
  if (data.terms) {
    const sec = openAutoSection(doc, 'Terms & Conditions', y); y = sec.contentY;
    y = addWrappedText(doc, data.terms, lx, y, ffw, lh);
    y = closeAutoSection(doc, sec, y) + 4;
  }

  // Signature Block
  { const sec = openAutoSection(doc, 'Authorization', y); y = sec.contentY;
    y += 10;
    doc.setDrawColor(100, 100, 100);
    doc.line(lx, y, lx + hfw - 5, y);
    doc.line(rx, y, rx + hfw - 5, y);
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    doc.text('Client Signature / Date', lx, y + 4);
    doc.text('RMPG Authorized Signature / Date', rx, y + 4);
    y += 10;
    y = closeAutoSection(doc, sec, y) + 4; }

  addPageFooter(doc);
  return doc;
}
```

**Step 1: Typecheck**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/loving-meninsky/client" && npx tsc --noEmit
```

**Step 2: Commit**

```bash
git add client/src/utils/proposalPdf.ts
git commit -m "feat(crm): proposal PDF generator using shared pdfGenerator helpers"
```

---

## Task 8: Proposals Tab Enhancements

**Files:**
- Modify: `client/src/components/crm/ProposalsTab.tsx`
- Modify: `client/src/pages/CrmPage.tsx`

### 8a — Add imports

```typescript
import { generateProposalPdf, type ProposalPdfData } from '../../utils/proposalPdf';
```

Add `Send`, `History`, `FileText` to the lucide imports if not already present.

### 8b — Update props interface

```typescript
interface ProposalsTabProps {
  prefillLead?: any | null;
  onPrefillConsumed?: () => void;
}
export default function ProposalsTab({ prefillLead, onPrefillConsumed }: ProposalsTabProps) {
```

Wire in CrmPage.tsx:

```tsx
{activeSection === 'proposals' && (
  <ProposalsTab
    prefillLead={prefilledLead}
    onPrefillConsumed={() => setPrefilledLead(null)}
  />
)}
```

### 8c — Version history state

```typescript
const [versions, setVersions] = useState<any[]>([]);
const [proposalDetailTab, setProposalDetailTab] = useState<'details' | 'history'>('details');
```

### 8d — Pre-fill effect

```typescript
useEffect(() => {
  if (!prefillLead) return;
  setForm((f: any) => ({
    ...f,
    title: `Security Services — ${prefillLead.business_name}`,
    lead_id: String(prefillLead.id),
    client_id: prefillLead.client_id ? String(prefillLead.client_id) : '',
    monthly_value: prefillLead.estimated_value ? String(Math.round(prefillLead.estimated_value / 12)) : '',
    total_value: prefillLead.estimated_value ? String(prefillLead.estimated_value) : '',
  }));
  setShowForm(true);
  onPrefillConsumed?.();
}, [prefillLead]);
```

### 8e — Expiry countdown chip

In proposal detail header area (near the proposal_number display):

```tsx
{selectedProposal?.valid_until && (() => {
  const days = Math.ceil((new Date(selectedProposal.valid_until).getTime() - Date.now()) / 86400000);
  return (
    <span className={`text-[10px] font-mono px-2 py-0.5 border ${
      days < 0 ? 'text-red-400 border-red-700/40 bg-red-900/20' :
      days < 14 ? 'text-amber-400 border-amber-700/40 bg-amber-900/20' :
      'text-rmpg-400 border-rmpg-700/30'
    }`}>
      {days < 0 ? 'EXPIRED' : `Expires in ${days}d`}
    </span>
  );
})()}
```

### 8f — Stage timeline

In the detail panel, between the header and the form/detail content:

```tsx
{selectedProposal && (() => {
  const stageOrder: ProposalStage[] = ['draft', 'sent', 'viewed', 'accepted'];
  const stageMap: Record<string, string> = selectedProposal.stage_entered_at
    ? (() => { try { return JSON.parse(selectedProposal.stage_entered_at); } catch { return {}; } })() : {};
  const curIdx = stageOrder.indexOf(selectedProposal.stage as ProposalStage);
  return (
    <div className="flex items-center gap-0 px-3 py-2 border-b border-rmpg-700/30 overflow-x-auto">
      {stageOrder.map((s, i) => (
        <React.Fragment key={s}>
          <div className="flex flex-col items-center min-w-0 shrink-0">
            <div className={`w-2.5 h-2.5 rounded-full border-2 ${i <= curIdx ? 'bg-brand-500 border-brand-400' : 'bg-transparent border-rmpg-600'}`} />
            <span className={`text-[8px] font-mono mt-0.5 ${i <= curIdx ? 'text-white' : 'text-rmpg-500'}`}>{s}</span>
            {stageMap[s] && <span className="text-[7px] text-rmpg-500">{new Date(stageMap[s]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
          </div>
          {i < stageOrder.length - 1 && <div className={`flex-1 h-px mx-1 ${i < curIdx ? 'bg-brand-600' : 'bg-rmpg-700'}`} style={{ minWidth: 20 }} />}
        </React.Fragment>
      ))}
    </div>
  );
})()}
```

### 8g — Detail/History sub-tab + action buttons

Replace any existing detail header with:

```tsx
<div className="flex items-center border-b border-rmpg-700/30">
  {(['details', 'history'] as const).map(tab => (
    <button key={tab} onClick={() => {
      setProposalDetailTab(tab);
      if (tab === 'history' && selectedProposal) {
        apiFetch<any[]>(`/crm/proposals/${selectedProposal.id}/versions`)
          .then(r => Array.isArray(r) && setVersions(r)).catch(() => {});
      }
    }} className={`px-3 py-1.5 text-[11px] font-mono ${proposalDetailTab === tab ? 'text-white border-b-2 border-brand-500' : 'text-rmpg-400 hover:text-white'}`}>
      {tab.toUpperCase()}
    </button>
  ))}
  <div className="flex items-center gap-1 ml-auto px-2">
    <button
      onClick={async () => {
        if (!selectedProposal) return;
        try {
          const doc = await generateProposalPdf(selectedProposal as ProposalPdfData);
          doc.save(`Proposal-${selectedProposal.proposal_number}.pdf`);
        } catch { toast({ type: 'error', message: 'PDF generation failed' }); }
      }}
      className="toolbar-btn text-[10px] flex items-center gap-1">
      <FileText className="w-3 h-3" /> PDF
    </button>
    <button
      onClick={async () => {
        if (!selectedProposal || selectedProposal.stage !== 'draft') return;
        try {
          await apiFetch(`/crm/proposals/${selectedProposal.id}/send`, { method: 'POST' });
          toast({ type: 'success', message: 'Marked as sent' });
          fetchProposals();
        } catch { toast({ type: 'error', message: 'Failed' }); }
      }}
      disabled={selectedProposal?.stage !== 'draft'}
      className="toolbar-btn-primary text-[10px] flex items-center gap-1">
      <Send className="w-3 h-3" /> Send
    </button>
  </div>
</div>
```

Version history tab content:

```tsx
{proposalDetailTab === 'history' && (
  <div className="flex-1 overflow-y-auto p-3 space-y-2">
    {versions.length === 0
      ? <p className="text-xs text-rmpg-400">No edit history yet.</p>
      : versions.map(v => (
          <div key={v.id} className="panel-inset p-2">
            <div className="flex justify-between text-[10px]">
              <span className="font-mono text-white">v{v.version_num}</span>
              <span className="text-rmpg-400">{v.edited_by_name || 'System'} · {new Date(v.edited_at).toLocaleString()}</span>
            </div>
          </div>
        ))
    }
  </div>
)}
```

**Step 1: Typecheck both**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/loving-meninsky/client" && npx tsc --noEmit
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/loving-meninsky/server" && npx tsc --noEmit
```

**Step 2: Commit**

```bash
git add client/src/components/crm/ProposalsTab.tsx server/src/routes/crmProposals.ts client/src/pages/CrmPage.tsx
git commit -m "feat(crm): proposals — PDF export, send workflow, version history, stage timeline, expiry countdown"
```

---

## Task 9: Invoice Aging + Payments

**Files:**
- Modify: `client/src/pages/CrmPage.tsx` — `renderInvoices()` and component body

### 9a — Add state

```typescript
const [agingFilter, setAgingFilter] = useState<string | null>(null);
const [paymentModal, setPaymentModal] = useState<{ invoiceId: number; balance: number } | null>(null);
const [paymentForm, setPaymentForm] = useState({ amount: '', paid_at: '', method: 'check', reference: '' });
```

### 9b — Aging bucket helper

Add as a module-level function (outside the component):

```typescript
interface AgingBucket { label: string; min: number; max: number; total: number; count: number; }
function computeAgingBuckets(invoices: any[]): AgingBucket[] {
  const buckets: AgingBucket[] = [
    { label: 'Current', min: 0, max: 0, total: 0, count: 0 },
    { label: '1–30d', min: 1, max: 30, total: 0, count: 0 },
    { label: '31–60d', min: 31, max: 60, total: 0, count: 0 },
    { label: '61–90d', min: 61, max: 90, total: 0, count: 0 },
    { label: '90d+', min: 91, max: 99999, total: 0, count: 0 },
  ];
  const now = Date.now();
  for (const inv of invoices) {
    if (['paid','void','cancelled','draft'].includes(inv.status)) continue;
    const due = inv.due_date ? new Date(inv.due_date) : null;
    const days = due ? Math.max(0, Math.ceil((now - due.getTime()) / 86400000)) : 0;
    const b = buckets.find(b => days >= b.min && days <= b.max) || buckets[buckets.length - 1];
    b.total += inv.balance_due || inv.total || 0;
    b.count++;
  }
  return buckets;
}
```

### 9c — Aging bar UI

At the top of `renderInvoices()` JSX content:

```tsx
{(() => {
  const buckets = computeAgingBuckets(invoices);
  return (
    <div className="flex gap-2 p-3 border-b border-rmpg-700/30">
      {buckets.map(b => (
        <button key={b.label}
          onClick={() => setAgingFilter(agingFilter === b.label ? null : b.label)}
          className={`flex-1 panel-inset p-2 text-center transition-colors ${agingFilter === b.label ? 'border-brand-500' : ''}`}>
          <div className="text-[10px] font-mono text-rmpg-400">{b.label}</div>
          <div className={`text-xs font-bold ${b.label !== 'Current' && b.count > 0 ? 'text-red-300' : 'text-white'}`}>
            {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(b.total)}
          </div>
          <div className="text-[9px] text-rmpg-500">{b.count} inv</div>
        </button>
      ))}
    </div>
  );
})()}
```

Filter the invoice list by aging bucket if `agingFilter` is set. Add to the filtered invoice list:

```typescript
const displayInvoices = agingFilter
  ? invoices.filter(inv => {
      if (['paid','void','cancelled','draft'].includes(inv.status)) return false;
      const now = Date.now();
      const due = inv.due_date ? new Date(inv.due_date) : null;
      const days = due ? Math.max(0, Math.ceil((now - due.getTime()) / 86400000)) : 0;
      const buckets = computeAgingBuckets([]);
      const bucketMap: Record<string, [number, number]> = { 'Current': [0,0], '1–30d': [1,30], '31–60d': [31,60], '61–90d': [61,90], '90d+': [91,99999] };
      const [min, max] = bucketMap[agingFilter] || [0, 99999];
      return days >= min && days <= max;
    })
  : invoices;
```

Replace `invoices.map(...)` with `displayInvoices.map(...)` in the list render.

### 9d — Record payment button in invoice rows

In each invoice row (find the actions area), add:

```tsx
{['sent','overdue','partial'].includes(inv.status) && (
  <button onClick={() => {
    setPaymentModal({ invoiceId: inv.id, balance: inv.balance_due || inv.total });
    setPaymentForm({ amount: String((inv.balance_due || inv.total || 0).toFixed(2)), paid_at: new Date().toISOString().slice(0,10), method: 'check', reference: '' });
  }} className="toolbar-btn text-[10px] flex items-center gap-1">
    <DollarSign className="w-3 h-3" /> Record Payment
  </button>
)}
```

### 9e — Payment modal JSX

Add before the closing tag of renderInvoices (or as a portal before the component return closes):

```tsx
{paymentModal && (
  <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={() => setPaymentModal(null)}>
    <div className="panel-raised p-4 w-72 space-y-3 rounded-sm" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
      <div className="text-sm font-bold text-white">Record Payment</div>
      <div>
        <label className="block text-[10px] text-rmpg-400 mb-1">Amount</label>
        <input className="input-dark w-full" type="number" step="0.01"
          value={paymentForm.amount} onChange={e => setPaymentForm(f => ({ ...f, amount: e.target.value }))} />
      </div>
      <div>
        <label className="block text-[10px] text-rmpg-400 mb-1">Date</label>
        <input className="input-dark w-full" type="date"
          value={paymentForm.paid_at} onChange={e => setPaymentForm(f => ({ ...f, paid_at: e.target.value }))} />
      </div>
      <div>
        <label className="block text-[10px] text-rmpg-400 mb-1">Method</label>
        <select className="input-dark w-full text-xs" value={paymentForm.method}
          onChange={e => setPaymentForm(f => ({ ...f, method: e.target.value }))}>
          <option value="check">Check</option>
          <option value="ach">ACH</option>
          <option value="cash">Cash</option>
          <option value="card">Card</option>
        </select>
      </div>
      <div>
        <label className="block text-[10px] text-rmpg-400 mb-1">Reference #</label>
        <input className="input-dark w-full"
          value={paymentForm.reference} onChange={e => setPaymentForm(f => ({ ...f, reference: e.target.value }))} />
      </div>
      <div className="flex gap-2 pt-1">
        <button className="toolbar-btn flex-1 text-xs" onClick={() => setPaymentModal(null)}>Cancel</button>
        <button className="toolbar-btn-primary flex-1 text-xs" onClick={async () => {
          try {
            await apiFetch(`/crm/invoices/${paymentModal.invoiceId}/payments`, {
              method: 'POST',
              body: JSON.stringify({ amount: Number(paymentForm.amount), paid_at: paymentForm.paid_at, method: paymentForm.method, reference: paymentForm.reference || null }),
            });
            toast({ type: 'success', message: 'Payment recorded' });
            setPaymentModal(null);
            fetchInvoices();
          } catch { toast({ type: 'error', message: 'Failed to record payment' }); }
        }}>Save</button>
      </div>
    </div>
  </div>
)}
```

### 9f — Overdue escalation badge

In each overdue invoice row:

```tsx
{inv.status === 'overdue' && inv.due_date && (() => {
  const days = Math.ceil((Date.now() - new Date(inv.due_date).getTime()) / 86400000);
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[9px] font-mono text-red-400 border border-red-700/30 px-1">
        OVERDUE {days}d
      </span>
      {days >= 60 && (
        <button
          onClick={async () => {
            try {
              await Promise.all([
                apiFetch('/crm/activity', { method: 'POST', body: JSON.stringify({ client_id: inv.client_id, activity_type: 'note', subject: `60d overdue escalation — Invoice ${inv.invoice_number}`, details: `Invoice overdue ${days} days. Balance: $${(inv.balance_due || 0).toFixed(2)}` }) }),
                apiFetch('/crm/tasks', { method: 'POST', body: JSON.stringify({ client_id: inv.client_id, title: `Escalate: Invoice ${inv.invoice_number} overdue ${days}d`, task_type: 'billing', priority: 'high', due_date: new Date().toISOString().slice(0,10) }) }),
              ]);
              toast({ type: 'success', message: 'Escalation logged' });
            } catch { toast({ type: 'error', message: 'Failed to escalate' }); }
          }}
          className="text-[9px] font-mono text-amber-400 border border-amber-700/30 px-1 hover:bg-amber-900/20">
          ESCALATE
        </button>
      )}
    </div>
  );
})()}
```

### 9g — Recurring fields in invoice form

Find the invoice create/edit form. Add after existing payment_terms field:

```tsx
<div className="flex items-center gap-2 mt-1">
  <input type="checkbox" id="is_recurring"
    checked={!!(invoiceForm as any)?.is_recurring}
    onChange={e => setInvoiceForm((f: any) => ({ ...f, is_recurring: e.target.checked ? 1 : 0 }))} />
  <label htmlFor="is_recurring" className="text-xs text-rmpg-300 cursor-pointer">Recurring Invoice</label>
</div>
{(invoiceForm as any)?.is_recurring ? (
  <select className="input-dark w-full text-xs mt-1"
    value={(invoiceForm as any)?.recurrence_interval || 'monthly'}
    onChange={e => setInvoiceForm((f: any) => ({ ...f, recurrence_interval: e.target.value }))}>
    <option value="monthly">Monthly</option>
    <option value="quarterly">Quarterly</option>
    <option value="annually">Annually</option>
  </select>
) : null}
```

Also include `is_recurring` and `recurrence_interval` in the invoice POST/PUT request body (find the submit handler).

**Step 1: Typecheck**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/loving-meninsky/client" && npx tsc --noEmit
```

**Step 2: Commit**

```bash
git add client/src/pages/CrmPage.tsx server/src/routes/crm.ts
git commit -m "feat(crm): invoice aging buckets, recurring billing, payment recording, overdue escalation"
```

---

## Task 10: Tasks Enhancements

**Files:**
- Modify: `client/src/pages/CrmPage.tsx` — `renderTasks()` function

### 10a — Due-date grouping helper

Add as a module-level function:

```typescript
const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

function groupTasksByDue(tasks: any[]) {
  const now = Date.now();
  const weekEnd = now + 7 * 86400000;
  const sort = (arr: any[]) => [...arr].sort((a, b) =>
    (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2)
  );
  const active = tasks.filter(t => !['completed','cancelled'].includes(t.status));
  return {
    overdue: sort(active.filter(t => t.due_date && new Date(t.due_date).getTime() < now)),
    thisWeek: sort(active.filter(t => t.due_date && new Date(t.due_date).getTime() >= now && new Date(t.due_date).getTime() <= weekEnd)),
    upcoming: sort(active.filter(t => !t.due_date || new Date(t.due_date).getTime() > weekEnd)),
  };
}
```

### 10b — Replace flat task list with grouped sections

In `renderTasks()`, replace the `tasks.map(...)` list with:

```tsx
{(() => {
  const { overdue, thisWeek, upcoming } = groupTasksByDue(tasks);
  const groups = [
    { key: 'overdue', label: 'OVERDUE', items: overdue, cls: 'text-red-400 border-red-800/30 bg-red-950/10' },
    { key: 'week', label: 'DUE THIS WEEK', items: thisWeek, cls: 'text-amber-400 border-amber-800/30 bg-amber-950/10' },
    { key: 'upcoming', label: 'UPCOMING', items: upcoming, cls: 'text-rmpg-400 border-rmpg-700/30' },
  ];
  return groups.map(g => g.items.length === 0 ? null : (
    <React.Fragment key={g.key}>
      <div className={`px-3 py-1 text-[10px] font-mono border-b ${g.cls} sticky top-0`}>
        {g.label} ({g.items.length})
      </div>
      {g.items.map((t: any) => (
        <div key={t.id} className="flex items-center gap-2 p-2 border-b border-rmpg-700/20 hover:bg-white/3 group">
          <button
            title="Mark complete"
            onClick={async () => {
              await apiFetch(`/crm/tasks/${t.id}`, { method: 'PUT', body: JSON.stringify({ status: 'completed' }) });
              fetchTasks();
            }}
            className="shrink-0 w-4 h-4 border border-rmpg-600 hover:border-green-500 hover:text-green-400 flex items-center justify-center text-transparent hover:text-green-400 transition-colors"
          >
            <CheckSquare className="w-3 h-3" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-white truncate">{t.title}</div>
            <div className="text-[10px] text-rmpg-400">{(t.task_type || '').replace(/_/g,' ')} {t.client_name ? `· ${t.client_name}` : ''}{t.auto_created_by ? ' · AUTO' : ''}</div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className={`text-[9px] font-mono ${t.priority === 'urgent' ? 'text-red-400' : t.priority === 'high' ? 'text-amber-400' : t.priority === 'normal' ? 'text-blue-400' : 'text-rmpg-500'}`}>
              {(t.priority || '').toUpperCase()}
            </span>
            {t.due_date && <span className="text-[9px] font-mono text-rmpg-400">{formatDate(t.due_date)}</span>}
            <button onClick={() => { setEditingTask(t); setShowTaskModal(true); }}
              className="opacity-0 group-hover:opacity-100 toolbar-btn text-[9px] p-0.5">
              <Edit3 className="w-3 h-3" />
            </button>
          </div>
        </div>
      ))}
    </React.Fragment>
  ));
})()}
```

### 10c — Call check-renewals when tasks section is active

In the `useEffect` that watches `activeSection`:

```typescript
if (activeSection === 'tasks') {
  fetchTasks();
  apiFetch('/crm/check-renewals', { method: 'POST' }).catch(() => {});
}
```

**Step 1: Typecheck**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/loving-meninsky/client" && npx tsc --noEmit
```

**Step 2: Commit**

```bash
git add client/src/pages/CrmPage.tsx
git commit -m "feat(crm): tasks due-date grouping, quick-complete, auto contract-renewal tasks"
```

---

## Task 11: Reports Tab Enhancements

**Files:**
- Modify: `client/src/components/crm/ReportsTab.tsx`

### 11a — Add CSV download utility

At top of file (after imports):

```typescript
function downloadCsv(filename: string, rows: any[], headers: string[]) {
  const lines = [
    headers.join(','),
    ...rows.map(r => headers.map(h => {
      const v = r[h] ?? '';
      return typeof v === 'string' && (v.includes(',') || v.includes('"')) ? `"${v.replace(/"/g, '""')}"` : String(v);
    }).join(','))
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}
```

### 11b — YTD/MTD toggle state

```typescript
const [ytdMode, setYtdMode] = useState(false);
```

### 11c — Revenue by client bar chart

In the Revenue section, after the existing monthly chart, add:

```tsx
{revenueData?.byClient && revenueData.byClient.length > 0 && (
  <div className="mt-4">
    <div className="flex items-center justify-between mb-2">
      <span className="text-[10px] font-mono text-rmpg-400">TOP CLIENTS</span>
      <div className="flex items-center gap-2">
        <button onClick={() => setYtdMode(m => !m)}
          className={`text-[10px] font-mono px-2 py-0.5 border ${ytdMode ? 'text-white border-brand-500 bg-brand-900/20' : 'text-rmpg-400 border-rmpg-700/30'}`}>
          {ytdMode ? 'YTD' : 'MTD'}
        </button>
        <button onClick={() => downloadCsv('revenue-by-client.csv', revenueData.byClient, ['client_name','mtd','ytd'])}
          className="toolbar-btn text-[10px]">CSV</button>
      </div>
    </div>
    <div className="space-y-1.5">
      {revenueData.byClient.map((c: any) => {
        const val = ytdMode ? c.ytd : c.mtd;
        const maxVal = Math.max(...revenueData.byClient.map((x: any) => ytdMode ? x.ytd : x.mtd), 1);
        return (
          <div key={c.client_id} className="flex items-center gap-2">
            <span className="text-[10px] text-rmpg-300 w-28 truncate shrink-0">{c.client_name}</span>
            <div className="flex-1 bg-surface-sunken h-4 relative">
              <div className="h-full bg-brand-600/60" style={{ width: `${(val / maxVal) * 100}%` }} />
            </div>
            <span className="text-[10px] font-mono text-white w-20 text-right shrink-0">
              {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val)}
            </span>
          </div>
        );
      })}
    </div>
  </div>
)}
```

### 11d — Pipeline funnel with conversion rates

Find the pipeline section. Replace or enhance the existing stage display with conversion rates between stages:

```tsx
{pipelineData?.stages && (() => {
  const stages = (pipelineData.stages as any[]).filter(s => !['lost','dismissed'].includes(s.stage));
  const maxCount = Math.max(...stages.map(s => s.count), 1);
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-mono text-rmpg-400">PIPELINE STAGES</span>
        <button onClick={() => downloadCsv('pipeline.csv', stages, ['stage','count','total_value'])} className="toolbar-btn text-[10px]">CSV</button>
      </div>
      <div className="space-y-0.5">
        {stages.map((s: any, i: number) => {
          const next = stages[i + 1];
          const convRate = next && s.count > 0 ? Math.round((next.count / s.count) * 100) : null;
          return (
            <div key={s.stage}>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-rmpg-400 w-20 capitalize shrink-0">{s.stage}</span>
                <div className="flex-1 bg-surface-sunken h-5 relative">
                  <div className="h-full flex items-center px-1.5"
                    style={{ width: `${Math.max((s.count / maxCount) * 100, 6)}%`, backgroundColor: STAGE_COLORS[s.stage as PipelineStage] || '#6b7280', opacity: 0.65 }}>
                    <span className="text-[10px] text-white font-mono">{s.count}</span>
                  </div>
                </div>
                <span className="text-[10px] font-mono text-rmpg-400 w-24 text-right shrink-0">
                  {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(s.total_value || 0)}
                </span>
              </div>
              {convRate !== null && (
                <div className="text-[9px] text-rmpg-600 pl-22 py-0.5 text-center">
                  ↓ {convRate}% → {next.stage}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
})()}
```

### 11e — Lead source ROI proper table

Replace the existing leadSourceData display with:

```tsx
{leadSourceData && leadSourceData.length > 0 && (
  <div>
    <div className="flex items-center justify-between mb-2">
      <span className="text-[10px] font-mono text-rmpg-400">LEAD SOURCE ROI</span>
      <button onClick={() => downloadCsv('lead-source-roi.csv', leadSourceData, ['source','total','won','conversion_rate','total_won_value'])} className="toolbar-btn text-[10px]">CSV</button>
    </div>
    <table className="w-full text-[11px] border-collapse">
      <thead>
        <tr className="border-b border-rmpg-700/40">
          <th className="text-left py-1 text-[10px] font-mono text-rmpg-400">Source</th>
          <th className="text-right py-1 text-[10px] font-mono text-rmpg-400">Leads</th>
          <th className="text-right py-1 text-[10px] font-mono text-rmpg-400">Won</th>
          <th className="text-right py-1 text-[10px] font-mono text-rmpg-400">Conv</th>
          <th className="text-right py-1 text-[10px] font-mono text-rmpg-400">Avg Deal</th>
          <th className="text-right py-1 text-[10px] font-mono text-rmpg-400">Won $</th>
        </tr>
      </thead>
      <tbody>
        {leadSourceData.map((row: LeadSourceROI) => (
          <tr key={row.source} className="border-b border-rmpg-700/20 hover:bg-white/3">
            <td className="py-1.5 text-rmpg-200">{SOURCE_LABELS[row.source] || row.source}</td>
            <td className="py-1.5 text-right font-mono text-white">{row.total}</td>
            <td className="py-1.5 text-right font-mono text-green-400">{row.won}</td>
            <td className="py-1.5 text-right font-mono text-white">{Math.round((row.conversion_rate || 0) * 100)}%</td>
            <td className="py-1.5 text-right font-mono text-white">
              {row.won > 0 ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(row.total_won_value / row.won) : '—'}
            </td>
            <td className="py-1.5 text-right font-mono text-green-400">
              {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(row.total_won_value)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)}
```

**Step 1: Full typecheck + build**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/loving-meninsky/client"
npx tsc --noEmit
npx vite build 2>&1 | tail -20
cd "../server" && npx tsc --noEmit
```

Expected: Build completes, both typechecks clean.

**Step 2: Commit**

```bash
git add client/src/components/crm/ReportsTab.tsx
git commit -m "feat(crm): reports — client revenue chart, pipeline funnel with conversion rates, ROI table, CSV export"
```

---

## Final: Deploy

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/loving-meninsky"
bash deploy/deploy.sh 2>&1 | tail -30
curl -sf https://rmpgutah.us/api/health
```

Expected: `{"status":"ok","database":{"status":"ok"}}`
