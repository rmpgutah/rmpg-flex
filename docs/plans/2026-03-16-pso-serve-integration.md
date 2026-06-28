# PSO Dispatch ↔ Process Server Integration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Link PSO dispatch calls (process_service type) with the Process Server serve queue so dispatches flow into the serve queue, and serve attempts sync back to close dispatch calls automatically.

**Architecture:** Foreign key `call_id` on `serve_queue` links to `calls_for_service(id)`. "Send to Serve Queue" button creates a serve_queue entry from dispatch data. Serve attempt completion syncs result back and auto-closes the dispatch call with a mapped disposition.

**Tech Stack:** Express + SQLite (better-sqlite3), React + TypeScript + Tailwind CSS

---

### Task 1: Add `call_id` column to serve_queue table

**Files:**
- Modify: `server/src/models/database.ts:4721-4753`

**Step 1: Add column + index to CREATE TABLE and migration**

In `server/src/models/database.ts`, add `call_id` to the `serve_queue` CREATE TABLE statement and add a safe ALTER TABLE migration after the CREATE block.

In the `serve_queue` CREATE TABLE (line ~4722), add after `sm_job_id INTEGER,`:
```sql
call_id INTEGER REFERENCES calls_for_service(id),
```

After the `CREATE INDEX IF NOT EXISTS idx_serve_queue_sm` line (~4753), add:
```sql
CREATE INDEX IF NOT EXISTS idx_serve_queue_call ON serve_queue(call_id);
```

Also add a safe ALTER TABLE migration (SQLite ALTER is additive-only, so wrap in try/catch). Find the section after all CREATE TABLE statements where other ALTER TABLE migrations exist, and add:
```typescript
try { db.exec("ALTER TABLE serve_queue ADD COLUMN call_id INTEGER REFERENCES calls_for_service(id)"); } catch {}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_serve_queue_call ON serve_queue(call_id)"); } catch {}
```

**Step 2: Verify server starts cleanly**

Run: `cd server && npx tsx src/index.ts` (Ctrl+C after startup)
Expected: No errors about serve_queue schema

**Step 3: Commit**

```
git add server/src/models/database.ts
git commit -m "feat(serve): add call_id FK column to serve_queue for dispatch integration"
```

---

### Task 2: Add "Send to Serve Queue" API endpoint

**Files:**
- Modify: `server/src/routes/dispatch/callActions.ts` (add endpoint at end of file, before `export default router`)

**Step 1: Add the endpoint**

Add before the `export default router;` line in `callActions.ts`:

```typescript
// POST /calls/:id/send-to-serve — Create serve queue entry from PSO dispatch call
router.post('/calls/:id/send-to-serve', validateParamId, requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    if (call.incident_type !== 'pso_client_request') {
      res.status(400).json({ error: 'Only PSO client request calls can be sent to the serve queue' });
      return;
    }

    if (!call.process_served_to) {
      res.status(400).json({ error: 'Call must have a process service recipient (process_served_to) before sending to serve queue' });
      return;
    }

    // Block duplicate — check if already linked
    const existing = db.prepare('SELECT id FROM serve_queue WHERE call_id = ?').get(call.id) as any;
    if (existing) {
      res.status(409).json({ error: 'This call already has a linked serve queue entry', serve_queue_id: existing.id });
      return;
    }

    const now = localNow();
    const id = crypto.randomUUID();

    // Parse address into components if possible (simple comma split)
    const addrParts = (call.process_served_address || '').split(',').map((s: string) => s.trim());
    const recipientAddress = addrParts[0] || call.process_served_address || call.location_address || '';
    const recipientCity = addrParts[1] || '';
    const recipientState = addrParts[2] || 'UT';
    const recipientZip = addrParts[3] || '';

    // Try to get assigned officer
    let officerId: number | null = null;
    try {
      const unitIds = JSON.parse(call.assigned_unit_ids || '[]');
      if (Array.isArray(unitIds) && unitIds.length > 0) {
        const unit = db.prepare('SELECT officer_id FROM units WHERE id = ?').get(unitIds[0]) as any;
        if (unit?.officer_id) officerId = unit.officer_id;
      }
    } catch {}

    // Map document type
    const docTypeMap: Record<string, string> = {
      subpoena: 'subpoena', summons: 'summons', complaint: 'complaint',
      eviction: 'eviction', restraining_order: 'restraining_order',
      writ: 'writ', order: 'order', notice: 'notice', petition: 'petition',
    };
    const documentType = docTypeMap[call.process_service_type] || call.process_service_type || 'civil';

    db.prepare(`
      INSERT INTO serve_queue (
        id, call_id, officer_id, serve_date, recipient_name,
        recipient_address, recipient_city, recipient_state, recipient_zip,
        recipient_lat, recipient_lng, document_type, case_number,
        client_name, priority, max_attempts, service_instructions, notes,
        status, attempt_count, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, 999, ?, ?)
    `).run(
      id, call.id, officerId,
      localToday(),
      call.process_served_to,
      recipientAddress, recipientCity, recipientState, recipientZip,
      call.latitude || null, call.longitude || null,
      documentType, call.case_number || '',
      call.pso_requestor_name || '', call.priority || 'normal',
      3, '', `From dispatch ${call.call_number}`,
      now, now,
    );

    const job = db.prepare('SELECT * FROM serve_queue WHERE id = ?').get(id);

    auditLog(req, 'CREATE', 'serve_queue', String(id), `Sent dispatch call ${call.call_number} to serve queue for ${call.process_served_to}`);
    broadcast('serve', 'serve_created', job);

    // Also update the call's activity log
    try {
      const activities = JSON.parse(call.activity_log || '[]');
      activities.push({
        action: 'sent_to_serve_queue',
        timestamp: now,
        user_id: req.user!.userId,
        details: `Sent to serve queue (ID: ${id})`,
      });
      db.prepare('UPDATE calls_for_service SET activity_log = ? WHERE id = ?').run(JSON.stringify(activities), call.id);
    } catch {}

    broadcastDispatchUpdate({ action: 'call_updated', call: db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(call.id) });

    res.status(201).json(job);
  } catch (err: any) {
    console.error('[DISPATCH] Send to serve error:', err);
    res.status(500).json({ error: 'Failed to send to serve queue' });
  }
});
```

Also add the missing import if not already present. Check that `crypto` is imported at the top of callActions.ts. If not, add:
```typescript
import crypto from 'crypto';
```

And ensure `localToday` is imported from `../../utils/timeUtils`. Check existing imports — `localNow` is already imported, add `localToday` to that import if missing.

**Step 2: Add serve-link lookup endpoint**

Add right after the send-to-serve endpoint:

```typescript
// GET /calls/:id/serve-link — Get linked serve queue entry for a call
router.get('/calls/:id/serve-link', validateParamId, requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const job = db.prepare('SELECT * FROM serve_queue WHERE call_id = ?').get(req.params.id) as any;
    if (!job) {
      res.json(null);
      return;
    }

    const attempts = db.prepare(
      'SELECT * FROM serve_attempts WHERE serve_queue_id = ? ORDER BY attempt_number ASC'
    ).all(job.id);

    res.json({ ...job, attempts });
  } catch (err: any) {
    console.error('[DISPATCH] Serve link error:', err);
    res.status(500).json({ error: 'Failed to fetch serve link' });
  }
});
```

**Step 3: Commit**

```
git add server/src/routes/dispatch/callActions.ts
git commit -m "feat(dispatch): add send-to-serve and serve-link API endpoints"
```

---

### Task 3: Sync serve attempts back to dispatch calls

**Files:**
- Modify: `server/src/routes/serve.ts:424-498` (the `POST /:id/attempt` handler)

**Step 1: Add dispatch sync logic after serve attempt recording**

In `serve.ts`, after the `broadcast('serve', 'serve_attempt', ...)` line (~491) and before the `res.status(201).json(...)` line, add the dispatch sync-back logic:

```typescript
    // Sync back to linked dispatch call
    const updatedJobForSync = db.prepare('SELECT * FROM serve_queue WHERE id = ?').get(req.params.id) as any;
    if (updatedJobForSync?.call_id) {
      const linkedCall = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(updatedJobForSync.call_id) as any;
      if (linkedCall) {
        // Map serve result to dispatch disposition
        const dispositionMap: Record<string, Record<string, string>> = {
          served: { personal: 'Served - Personal', substitute: 'Served - Substitute', posting: 'Served - Posting' },
        };

        const updates: string[] = ['process_attempts = ?'];
        const values: any[] = [attemptNumber];

        updates.push('process_service_result = ?');
        values.push(result || 'no_answer');

        if (result === 'served' || result === 'posted') {
          // Auto-close the dispatch call
          const attemptMethod = method || 'personal';
          const disposition = dispositionMap['served']?.[attemptMethod] || 'Served';

          updates.push('process_served_at = ?');
          values.push(now);

          if (req.body.person_served_name) {
            updates.push('process_served_to = ?');
            values.push(req.body.person_served_name);
          }

          updates.push('status = ?', 'closed_at = ?', 'disposition = ?');
          values.push('closed', now, disposition);
        }

        values.push(linkedCall.id);
        db.prepare(`UPDATE calls_for_service SET ${updates.join(', ')} WHERE id = ?`).run(...values);

        // Broadcast dispatch update
        const updatedCall = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(linkedCall.id);
        broadcastDispatchUpdate({ action: 'call_updated', call: updatedCall });

        // Activity log
        try {
          const activities = JSON.parse(linkedCall.activity_log || '[]');
          activities.push({
            action: 'process_served_via_serve_queue',
            timestamp: now,
            user_id: req.user!.userId,
            details: `Serve attempt #${attemptNumber}: ${result}${result === 'served' ? ` (${method || 'personal'})` : ''}`,
          });
          db.prepare('UPDATE calls_for_service SET activity_log = ? WHERE id = ?').run(JSON.stringify(activities), linkedCall.id);
        } catch {}
      }
    }
```

Also update the import at the top of `serve.ts`. It currently imports `broadcast` from `'../utils/websocket'`. Change to:
```typescript
import { broadcast, broadcastDispatchUpdate } from '../utils/websocket';
```

**Step 2: Commit**

```
git add server/src/routes/serve.ts
git commit -m "feat(serve): sync attempt results back to linked dispatch calls"
```

---

### Task 4: Add "Send to Serve Queue" button to DispatchPage PSO panel

**Files:**
- Modify: `client/src/pages/dispatch/DispatchPage.tsx` (PSO Details section, ~line 2022-2165)

**Step 1: Add state and fetch for serve link**

Find the state declarations near the top of the DispatchPage component. Add:

```typescript
const [serveLink, setServeLink] = useState<any>(null);
const [sendingToServe, setSendingToServe] = useState(false);
```

Add a fetch for the serve link when a PSO call is selected. Find where `selectedCall` changes are handled (the useEffect that loads call details). Add after existing fetches in that effect:

```typescript
// Fetch serve queue link for PSO calls
if (mapped.incident_type === 'pso_client_request') {
  apiFetch(`/dispatch/calls/${mapped.id}/serve-link`).then(data => {
    setServeLink(data);
  }).catch(() => setServeLink(null));
} else {
  setServeLink(null);
}
```

**Step 2: Add the button and status indicator to PSO panel**

In the PSO Details section (around line 2039, after the `pso_authorization` line and before the Visit History section), add:

```tsx
{/* Serve Queue Integration */}
{selectedCall.process_served_to && (
  <div className="mt-2 pt-2 border-t border-rmpg-600">
    {serveLink ? (
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{
            background: serveLink.status === 'served' ? '#22c55e' : serveLink.status === 'failed' ? '#ef4444' : '#f59e0b'
          }} />
          <span className="text-[10px] font-bold text-rmpg-300 uppercase">Serve Queue</span>
          <span className="text-[10px] font-mono text-cyan-400">
            {serveLink.attempt_count}/{serveLink.max_attempts} attempts
          </span>
          <span className="text-[10px] font-mono px-1 rounded" style={{
            background: serveLink.status === 'served' ? '#22c55e20' : serveLink.status === 'failed' ? '#dc262620' : '#f59e0b20',
            color: serveLink.status === 'served' ? '#4ade80' : serveLink.status === 'failed' ? '#f87171' : '#fbbf24',
          }}>
            {serveLink.status?.toUpperCase()}
          </span>
        </div>
        <button
          className="text-[10px] text-blue-400 hover:text-blue-300 underline"
          onClick={() => window.open('/serve', '_blank')}
        >
          View in Process Server
        </button>
      </div>
    ) : (
      <button
        className="w-full py-2 px-3 text-xs font-semibold rounded flex items-center justify-center gap-2 transition-colors"
        style={{
          background: sendingToServe ? '#374151' : '#7c3aed20',
          border: '1px solid #7c3aed50',
          color: sendingToServe ? '#9ca3af' : '#a78bfa',
        }}
        disabled={sendingToServe}
        onClick={async () => {
          setSendingToServe(true);
          try {
            const result = await apiFetch(`/dispatch/calls/${selectedCall.id}/send-to-serve`, {
              method: 'POST',
              body: JSON.stringify({}),
            });
            if (result) {
              setServeLink(result);
              addToast('Sent to Serve Queue', 'success');
            }
          } catch (err: any) {
            addToast(`Failed: ${err?.message || 'Unknown error'}`, 'error');
          } finally {
            setSendingToServe(false);
          }
        }}
      >
        <Briefcase style={{ width: 14, height: 14 }} />
        {sendingToServe ? 'Sending...' : 'Send to Serve Queue'}
      </button>
    )}
  </div>
)}
```

Make sure `Briefcase` is imported from `lucide-react` at the top of the file.

**Step 3: Add to call actions menu (desktop)**

Find the call actions dropdown/menu in the desktop view. Near the "Schedule Return Visit" button, add:

```tsx
{selectedCall.incident_type === 'pso_client_request' && selectedCall.process_served_to && !serveLink && (
  <button
    className="w-full text-left px-3 py-2 text-xs hover:bg-rmpg-700/50 flex items-center gap-2"
    onClick={async () => {
      setSendingToServe(true);
      try {
        const result = await apiFetch(`/dispatch/calls/${selectedCall.id}/send-to-serve`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
        if (result) {
          setServeLink(result);
          addToast('Sent to Serve Queue', 'success');
        }
      } catch (err: any) {
        addToast(`Failed: ${err?.message || 'Unknown error'}`, 'error');
      } finally {
        setSendingToServe(false);
      }
    }}
  >
    <Briefcase style={{ width: 12, height: 12, color: '#a78bfa' }} />
    <span className="text-purple-300">Send to Serve Queue</span>
  </button>
)}
```

**Step 4: Reset serveLink when selectedCall changes**

When selectedCall is set to null (call deselected), also clear serveLink:
```typescript
setServeLink(null);
```

**Step 5: Commit**

```
git add client/src/pages/dispatch/DispatchPage.tsx
git commit -m "feat(dispatch): add Send to Serve Queue button in PSO panel and actions menu"
```

---

### Task 5: Add dispatch context to ServeJobCard

**Files:**
- Modify: `client/src/components/serve/ServeJobCard.tsx`
- Modify: `client/src/pages/ServePage.tsx`
- Modify: `client/src/types/index.ts`

**Step 1: Add call_id to ServeJob type**

In `client/src/types/index.ts`, find the `ServeJob` interface and add:
```typescript
call_id: number | null;
```

Also add a linked call type:
```typescript
export interface ServeJobLinkedCall {
  id: number;
  call_number: string;
  status: string;
  priority: string;
  assigned_unit_ids: string;
  pso_requestor_name: string | null;
  contract_id: string | null;
  pso_service_windows: string | null;
}
```

**Step 2: Update ServeJobCard props and render linked call info**

In `ServeJobCard.tsx`, update the interface to accept `linkedCall`:
```typescript
interface ServeJobCardProps {
  job: ServeJob;
  linkedCall?: ServeJobLinkedCall | null;
  // ... existing props unchanged
}
```

Add `linkedCall` to the destructuring. Then, in the expanded details section (inside the `{isExpanded && (` block, ~line 183), add at the TOP before the case/court grid:

```tsx
{/* Linked Dispatch Call */}
{linkedCall && (
  <div className="p-2 rounded border mb-2" style={{ background: '#1a5a9e10', borderColor: '#1a5a9e30' }}>
    <div className="flex items-center justify-between mb-1">
      <span className="text-[10px] font-bold text-blue-300 uppercase">Dispatch Link</span>
      <button
        className="text-[10px] text-blue-400 hover:text-blue-300 underline"
        onClick={(e) => { e.stopPropagation(); window.open(`/dispatch?call=${linkedCall.call_number}`, '_blank'); }}
      >
        {linkedCall.call_number}
      </button>
    </div>
    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-rmpg-300">
      <div><span className="text-rmpg-400">Status:</span> <span className="font-mono">{linkedCall.status?.toUpperCase()}</span></div>
      <div><span className="text-rmpg-400">Priority:</span> <span className="font-mono">{linkedCall.priority?.toUpperCase()}</span></div>
      {linkedCall.pso_requestor_name && (
        <div><span className="text-rmpg-400">Requestor:</span> {linkedCall.pso_requestor_name}</div>
      )}
      {linkedCall.contract_id && (
        <div><span className="text-rmpg-400">Contract:</span> <span className="font-mono text-cyan-400">{linkedCall.contract_id}</span></div>
      )}
    </div>
    {/* PSO Compliance mini-indicator */}
    {linkedCall.pso_service_windows && (() => {
      try {
        const w = JSON.parse(linkedCall.pso_service_windows);
        const met = [w.early_morning, w.daytime, w.evening, w.weekend].filter(Boolean).length;
        return (
          <div className="mt-1 flex items-center gap-1 text-[9px]">
            <span className="text-rmpg-400">Compliance:</span>
            <span className="font-mono" style={{ color: met === 4 ? '#4ade80' : '#fbbf24' }}>{met}/4 windows</span>
          </div>
        );
      } catch { return null; }
    })()}
  </div>
)}
```

**Step 3: Fetch linked call data in ServePage**

In `ServePage.tsx`, after fetching jobs, fetch linked call data for jobs that have `call_id`. Add state:

```typescript
const [linkedCalls, setLinkedCalls] = useState<Record<number, any>>({});
```

After the `refreshJobs` function loads jobs, add a follow-up fetch:

```typescript
// Fetch linked dispatch calls for jobs that have call_id
const jobsWithCalls = fetchedJobs.filter((j: any) => j.call_id);
if (jobsWithCalls.length > 0) {
  const callMap: Record<number, any> = {};
  await Promise.all(
    jobsWithCalls.map(async (j: any) => {
      try {
        const call = await apiFetch(`/dispatch/calls/${j.call_id}`);
        if (call) callMap[j.id] = call;
      } catch {}
    })
  );
  setLinkedCalls(callMap);
}
```

Pass to ServeJobCard:
```tsx
<ServeJobCard
  job={job}
  linkedCall={linkedCalls[job.id] || null}
  // ... existing props
/>
```

**Step 4: Commit**

```
git add client/src/types/index.ts client/src/components/serve/ServeJobCard.tsx client/src/pages/ServePage.tsx
git commit -m "feat(serve): show linked dispatch call context on ServeJobCard"
```

---

### Task 6: Update serve_queue GET endpoint to include linked call

**Files:**
- Modify: `server/src/routes/serve.ts` (GET /:id endpoint)

**Step 1: Update GET /:id to include linked call data**

In the `GET /:id` handler (~line 348), after fetching the job and before `res.json(...)`, add:

```typescript
let linkedCall = null;
if (job.call_id) {
  linkedCall = db.prepare(`
    SELECT id, call_number, status, priority, assigned_unit_ids,
           pso_requestor_name, contract_id, pso_service_windows,
           pso_attempt_number, disposition
    FROM calls_for_service WHERE id = ?
  `).get(job.call_id);
}

res.json({ ...job, attempts, skipTraces, linkedCall });
```

Replace the existing `res.json({ ...job, attempts, skipTraces });` line.

The `call_id` column is already included in `SELECT *` for the list endpoint, so the GET / endpoint automatically returns it.

**Step 2: Commit**

```
git add server/src/routes/serve.ts
git commit -m "feat(serve): include linked dispatch call data in serve job detail endpoint"
```

---

### Task 7: Build and smoke test

**Files:** None (testing only)

**Step 1: Build the client**

Run: `cd client && npx vite build`
Expected: Build succeeds with no TypeScript errors

**Step 2: Start the dev server**

Run: `npm run dev`
Expected: Both client and server start cleanly

**Step 3: End-to-end smoke test**

1. Create a PSO dispatch call with process_service type, fill in recipient name + address
2. Open the PSO details panel - verify "Send to Serve Queue" button appears
3. Click "Send to Serve Queue" - verify success toast, button changes to status indicator
4. Open /serve page - verify new job appears with dispatch link badge
5. Expand the job card - verify dispatch context panel shows (call number, status, requestor, compliance)
6. Record a successful serve attempt - verify dispatch call auto-closes with "Served - Personal" disposition
7. Back in dispatch - verify call shows closed status with serve disposition

**Step 4: Final commit**

```
git add -A
git commit -m "feat: PSO dispatch / Process Server integration complete"
```
