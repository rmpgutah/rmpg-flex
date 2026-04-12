# Radio Console & Panic Alarm Enhancement — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a full police radio console (left sidebar with multi-channel, scanner, encryption, S-meter, unit paging, PTT, emergency override, transmission log) and overhaul the panic alarm system (dedicated table, server-side ack, audio recording, tiered escalation).

**Architecture:** Hybrid approach — build on existing voiceChannel.ts state machine, PanicButton.tsx, and websocket.ts infrastructure. Extract panic from aggregates.ts into dedicated panic.ts route. New radio console as collapsible left sidebar in Layout.tsx. Audio quality upgrades inserted into existing edgeTTS.ts filter chain.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Express 5, better-sqlite3, Web Audio API (AudioWorklet), WebSocket (ws), Edge TTS, Vitest + Supertest

**Design doc:** `docs/plans/2026-04-12-radio-panic-enhancement-design.md`

---

## Phase 1: Database & Server Foundation

### Task 1: Create `panic_alerts` Table

**Files:**
- Modify: `server/src/models/database.ts` (add table creation after line ~1349, in `createTables()`)
- Test: `server/tests/integration/panic.test.ts` (new)

**Step 1: Write the failing test**

Create `server/tests/integration/panic.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, createAuthToken } from '../helpers/testApp';
import { createTestDb, closeTestDb } from '../helpers/testDb';
import request from 'supertest';

let app: any;
let db: any;
let adminToken: string;
let officerToken: string;

describe('Panic Alerts API', () => {
  beforeAll(async () => {
    const testSetup = await createTestDb();
    db = testSetup.db;
    app = createTestApp(db);
    adminToken = createAuthToken({ id: 1, username: 'admin', role: 'admin', badge_number: 'A001' });
    officerToken = createAuthToken({ id: 2, username: 'officer1', role: 'officer', badge_number: 'O101' });
  });

  afterAll(() => closeTestDb(db));

  describe('POST /api/dispatch/panic', () => {
    it('creates a panic alert with dedicated table entry', async () => {
      const res = await request(app)
        .post('/api/dispatch/panic')
        .set('Authorization', `Bearer ${officerToken}`)
        .send({ latitude: 40.7608, longitude: -111.8910, message: 'Test panic' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.panic_id).toBeDefined();
      expect(res.body.call_id).toBeDefined();

      // Verify panic_alerts table entry
      const panic = db.prepare('SELECT * FROM panic_alerts WHERE id = ?').get(res.body.panic_id);
      expect(panic).toBeDefined();
      expect(panic.status).toBe('active');
      expect(panic.trigger_method).toBe('ui_button');
      expect(panic.escalation_level).toBe(0);
    });
  });

  describe('POST /api/dispatch/panic/:id/acknowledge', () => {
    it('records server-side acknowledgment', async () => {
      // Create a panic first
      const createRes = await request(app)
        .post('/api/dispatch/panic')
        .set('Authorization', `Bearer ${officerToken}`)
        .send({ latitude: 40.76, longitude: -111.89 });

      const panicId = createRes.body.panic_id;

      const res = await request(app)
        .post(`/api/dispatch/panic/${panicId}/acknowledge`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const panic = db.prepare('SELECT * FROM panic_alerts WHERE id = ?').get(panicId);
      expect(panic.status).toBe('acknowledged');
      expect(panic.acknowledged_by).toBe(1);
      expect(panic.acknowledged_at).toBeDefined();
    });
  });

  describe('POST /api/dispatch/panic/:id/resolve', () => {
    it('marks panic resolved with notes', async () => {
      const createRes = await request(app)
        .post('/api/dispatch/panic')
        .set('Authorization', `Bearer ${officerToken}`)
        .send({});
      const panicId = createRes.body.panic_id;

      // Acknowledge first
      await request(app)
        .post(`/api/dispatch/panic/${panicId}/acknowledge`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      const res = await request(app)
        .post(`/api/dispatch/panic/${panicId}/resolve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ resolution_notes: 'Officer safe, situation resolved' });

      expect(res.status).toBe(200);
      const panic = db.prepare('SELECT * FROM panic_alerts WHERE id = ?').get(panicId);
      expect(panic.status).toBe('resolved');
      expect(panic.resolution_notes).toBe('Officer safe, situation resolved');
    });
  });

  describe('POST /api/dispatch/panic/:id/cancel', () => {
    it('allows triggering officer to cancel within 30s', async () => {
      const createRes = await request(app)
        .post('/api/dispatch/panic')
        .set('Authorization', `Bearer ${officerToken}`)
        .send({});
      const panicId = createRes.body.panic_id;

      const res = await request(app)
        .post(`/api/dispatch/panic/${panicId}/cancel`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({});

      expect(res.status).toBe(200);
      const panic = db.prepare('SELECT * FROM panic_alerts WHERE id = ?').get(panicId);
      expect(panic.status).toBe('cancelled');
    });

    it('rejects cancel from non-triggering officer', async () => {
      const createRes = await request(app)
        .post('/api/dispatch/panic')
        .set('Authorization', `Bearer ${officerToken}`)
        .send({});
      const panicId = createRes.body.panic_id;

      const res = await request(app)
        .post(`/api/dispatch/panic/${panicId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/dispatch/panic/:id/false-alarm', () => {
    it('requires supervisor role and notes', async () => {
      const createRes = await request(app)
        .post('/api/dispatch/panic')
        .set('Authorization', `Bearer ${officerToken}`)
        .send({});
      const panicId = createRes.body.panic_id;

      // Officer cannot mark false alarm
      const resFail = await request(app)
        .post(`/api/dispatch/panic/${panicId}/false-alarm`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({ resolution_notes: 'Accidental activation' });
      expect(resFail.status).toBe(403);

      // Admin can
      const res = await request(app)
        .post(`/api/dispatch/panic/${panicId}/false-alarm`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ resolution_notes: 'Accidental activation during training' });
      expect(res.status).toBe(200);
      const panic = db.prepare('SELECT * FROM panic_alerts WHERE id = ?').get(panicId);
      expect(panic.status).toBe('false_alarm');
    });
  });

  describe('GET /api/dispatch/panic/active', () => {
    it('returns only active panics', async () => {
      const res = await request(app)
        .get('/api/dispatch/panic/active')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      res.body.forEach((p: any) => {
        expect(['active', 'acknowledged']).toContain(p.status);
      });
    });
  });

  describe('GET /api/dispatch/panic/history', () => {
    it('returns historical panics with pagination', async () => {
      const res = await request(app)
        .get('/api/dispatch/panic/history?limit=10&offset=0')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.total).toBeDefined();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/integration/panic.test.ts`
Expected: FAIL — `panic_alerts` table doesn't exist, `/dispatch/panic/:id/acknowledge` route doesn't exist

**Step 3: Add `panic_alerts` table to database.ts**

In `server/src/models/database.ts`, inside `createTables()` (after the last existing table around line 1349), add:

```typescript
  db.prepare(`CREATE TABLE IF NOT EXISTS panic_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    call_id INTEGER,
    trigger_method TEXT NOT NULL DEFAULT 'ui_button',
    message TEXT,
    latitude REAL,
    longitude REAL,
    location_address TEXT,
    audio_file_id TEXT,
    audio_duration_seconds INTEGER,
    status TEXT NOT NULL DEFAULT 'active',
    escalation_level INTEGER DEFAULT 0,
    acknowledged_at TEXT,
    acknowledged_by INTEGER,
    resolved_at TEXT,
    resolved_by INTEGER,
    resolution_notes TEXT,
    responder_unit_ids TEXT DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (call_id) REFERENCES calls_for_service(id),
    FOREIGN KEY (acknowledged_by) REFERENCES users(id),
    FOREIGN KEY (resolved_by) REFERENCES users(id)
  )`).run();
```

Also add `system_config` seed entries for panic settings (in the seed section):

```typescript
  // Panic alarm configuration defaults
  const panicConfigs = [
    { key: 'panic_audio_duration_seconds', value: '60', category: 'panic' },
    { key: 'panic_escalation_1_seconds', value: '30', category: 'panic' },
    { key: 'panic_escalation_2_seconds', value: '60', category: 'panic' },
    { key: 'panic_escalation_3_seconds', value: '90', category: 'panic' },
    { key: 'emergency_talkgroup_timeout_minutes', value: '30', category: 'radio' },
    { key: 'radio_encryption_default', value: 'secure', category: 'radio' },
  ];
  const insertConfig = db.prepare('INSERT OR IGNORE INTO system_config (config_key, config_value, category) VALUES (?, ?, ?)');
  for (const c of panicConfigs) {
    insertConfig.run(c.key, c.value, c.category);
  }
```

**Step 4: Run database initialization test to verify table exists**

Run: `cd server && npx vitest run tests/integration/panic.test.ts --reporter=verbose 2>&1 | head -30`
Expected: Table creation succeeds, tests may still fail on missing routes

**Step 5: Commit**

```bash
git add server/src/models/database.ts server/tests/integration/panic.test.ts
git commit -m "feat(db): add panic_alerts table and config defaults"
```

---

### Task 2: Extract Panic Route from aggregates.ts

**Files:**
- Create: `server/src/routes/dispatch/panic.ts`
- Modify: `server/src/routes/dispatch/aggregates.ts` (remove lines 645-828)
- Modify: `server/src/routes/dispatch/index.ts` (mount panic router)

**Step 1: Create `server/src/routes/dispatch/panic.ts`**

Extract the existing panic handler from `aggregates.ts:645-828` into a new file. Add the new endpoints: acknowledge, resolve, cancel, false-alarm, active, history.

The file should follow the standard route pattern:
```typescript
import { Router, Request, Response } from 'express';
import { getDb } from '../../models/database';
import { authenticateToken, requireRole } from '../../middleware/auth';
import { auditLog } from '../../utils/auditLogger';
import { broadcastPanic, broadcastDispatchUpdate, broadcastUnitUpdate } from '../../utils/websocket';

const router = Router();
router.use(authenticateToken);

// POST /panic — trigger a panic alert (moved from aggregates.ts)
// [Copy existing logic from aggregates.ts:645-828]
// ADDITION: Also insert into panic_alerts table
// ADDITION: Return panic_id in response

// POST /panic/:id/acknowledge — server-side acknowledgment
router.post('/panic/:id/acknowledge', async (req: Request, res: Response) => {
  const db = getDb();
  const panicId = parseInt(req.params.id);
  const userId = (req as any).user.id;
  const now = new Date().toLocaleString('en-US', { timeZone: 'America/Denver' });

  const panic = db.prepare('SELECT * FROM panic_alerts WHERE id = ?').get(panicId) as any;
  if (!panic) return res.status(404).json({ error: 'Panic alert not found' });
  if (panic.status !== 'active') return res.status(400).json({ error: 'Panic already ' + panic.status });

  db.prepare('UPDATE panic_alerts SET status = ?, acknowledged_at = ?, acknowledged_by = ? WHERE id = ?')
    .run('acknowledged', now, userId, panicId);

  auditLog(req, 'ACKNOWLEDGE', 'panic_alerts', panicId, { status: 'active' }, { status: 'acknowledged', acknowledged_by: userId });

  // Cancel escalation timer (in-memory — see Task 5)
  cancelEscalationTimer(panicId);

  // Broadcast acknowledgment to all clients
  broadcastPanic({ type: 'panic_acknowledged', data: { panic_id: panicId, acknowledged_by: userId, acknowledged_at: now } });

  res.json({ success: true });
});

// POST /panic/:id/resolve — mark resolved
router.post('/panic/:id/resolve', requireRole('admin', 'supervisor', 'manager'), async (req: Request, res: Response) => {
  const db = getDb();
  const panicId = parseInt(req.params.id);
  const userId = (req as any).user.id;
  const { resolution_notes } = req.body;
  const now = new Date().toLocaleString('en-US', { timeZone: 'America/Denver' });

  if (!resolution_notes || resolution_notes.length < 10) {
    return res.status(400).json({ error: 'Resolution notes required (min 10 characters)' });
  }

  const panic = db.prepare('SELECT * FROM panic_alerts WHERE id = ?').get(panicId) as any;
  if (!panic) return res.status(404).json({ error: 'Panic alert not found' });

  db.prepare('UPDATE panic_alerts SET status = ?, resolved_at = ?, resolved_by = ?, resolution_notes = ? WHERE id = ?')
    .run('resolved', now, userId, resolution_notes, panicId);

  auditLog(req, 'RESOLVE', 'panic_alerts', panicId, null, { status: 'resolved', resolved_by: userId });
  cancelEscalationTimer(panicId);
  broadcastPanic({ type: 'panic_resolved', data: { panic_id: panicId, resolved_by: userId } });

  res.json({ success: true });
});

// POST /panic/:id/cancel — officer cancels own panic (within 30s)
router.post('/panic/:id/cancel', async (req: Request, res: Response) => {
  const db = getDb();
  const panicId = parseInt(req.params.id);
  const userId = (req as any).user.id;

  const panic = db.prepare('SELECT * FROM panic_alerts WHERE id = ?').get(panicId) as any;
  if (!panic) return res.status(404).json({ error: 'Panic alert not found' });
  if (panic.user_id !== userId) return res.status(403).json({ error: 'Only triggering officer can cancel' });
  if (panic.status !== 'active') return res.status(400).json({ error: 'Cannot cancel — already ' + panic.status });

  const createdAt = new Date(panic.created_at).getTime();
  const now = Date.now();
  if (now - createdAt > 30000) return res.status(400).json({ error: 'Cancel window expired (30s)' });

  db.prepare('UPDATE panic_alerts SET status = ? WHERE id = ?').run('cancelled', panicId);
  auditLog(req, 'CANCEL', 'panic_alerts', panicId, null, { status: 'cancelled' });
  cancelEscalationTimer(panicId);
  broadcastPanic({ type: 'panic_cancelled', data: { panic_id: panicId } });

  res.json({ success: true });
});

// POST /panic/:id/false-alarm — supervisor marks false alarm
router.post('/panic/:id/false-alarm', requireRole('admin', 'supervisor', 'manager'), async (req: Request, res: Response) => {
  const db = getDb();
  const panicId = parseInt(req.params.id);
  const userId = (req as any).user.id;
  const { resolution_notes } = req.body;

  if (!resolution_notes || resolution_notes.length < 10) {
    return res.status(400).json({ error: 'Notes required (min 10 characters)' });
  }

  const panic = db.prepare('SELECT * FROM panic_alerts WHERE id = ?').get(panicId) as any;
  if (!panic) return res.status(404).json({ error: 'Panic alert not found' });

  db.prepare('UPDATE panic_alerts SET status = ?, resolution_notes = ?, resolved_by = ?, resolved_at = ? WHERE id = ?')
    .run('false_alarm', resolution_notes, userId, new Date().toLocaleString('en-US', { timeZone: 'America/Denver' }), panicId);

  auditLog(req, 'FALSE_ALARM', 'panic_alerts', panicId, null, { status: 'false_alarm' });
  cancelEscalationTimer(panicId);
  broadcastPanic({ type: 'panic_false_alarm', data: { panic_id: panicId } });

  res.json({ success: true });
});

// GET /panic/active — all active panics
router.get('/panic/active', requireRole('admin', 'supervisor', 'manager', 'dispatcher'), async (req: Request, res: Response) => {
  const db = getDb();
  const panics = db.prepare(`
    SELECT pa.*, u.full_name as user_name, u.badge_number, u.role
    FROM panic_alerts pa
    JOIN users u ON pa.user_id = u.id
    WHERE pa.status IN ('active', 'acknowledged')
    ORDER BY pa.created_at DESC
  `).all();
  res.json(panics);
});

// GET /panic/history — historical log with pagination
router.get('/panic/history', requireRole('admin', 'supervisor', 'manager'), async (req: Request, res: Response) => {
  const db = getDb();
  const limit = Math.min(parseInt(req.query.limit as string) || 25, 100);
  const offset = parseInt(req.query.offset as string) || 0;

  const total = (db.prepare('SELECT COUNT(*) as count FROM panic_alerts').get() as any).count;
  const data = db.prepare(`
    SELECT pa.*, u.full_name as user_name, u.badge_number,
           ack.full_name as acknowledged_by_name
    FROM panic_alerts pa
    JOIN users u ON pa.user_id = u.id
    LEFT JOIN users ack ON pa.acknowledged_by = ack.id
    ORDER BY pa.created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);

  res.json({ data, total, limit, offset });
});

// In-memory escalation timer map
const escalationTimers = new Map<number, NodeJS.Timeout[]>();

function cancelEscalationTimer(panicId: number): void {
  const timers = escalationTimers.get(panicId);
  if (timers) {
    timers.forEach(t => clearTimeout(t));
    escalationTimers.delete(panicId);
  }
}

export { cancelEscalationTimer, escalationTimers };
export default router;
```

**Step 2: Remove panic handler from aggregates.ts**

Delete lines 645-828 in `server/src/routes/dispatch/aggregates.ts` (the `router.post('/panic', ...)` handler).

**Step 3: Mount panic router in dispatch/index.ts**

Add to `server/src/routes/dispatch/index.ts`:
```typescript
import panicRouter from './panic';
// After existing router.use() calls:
router.use('/', panicRouter);
```

**Step 4: Run tests**

Run: `cd server && npx vitest run tests/integration/panic.test.ts --reporter=verbose`
Expected: All panic tests PASS

**Step 5: Run route collision check**

Run: `cd server && npm run check:routes`
Expected: 0 duplicates

**Step 6: Commit**

```bash
git add server/src/routes/dispatch/panic.ts server/src/routes/dispatch/aggregates.ts server/src/routes/dispatch/index.ts
git commit -m "feat(panic): extract panic route, add ack/resolve/cancel/false-alarm endpoints"
```

---

### Task 3: Panic Escalation Engine (Server-Side)

**Files:**
- Modify: `server/src/routes/dispatch/panic.ts` (add escalation timer logic)
- Modify: `server/src/utils/websocket.ts` (add new broadcast types)
- Test: `server/tests/integration/panic.test.ts` (add escalation tests)

**Step 1: Write escalation tests**

Add to `server/tests/integration/panic.test.ts`:

```typescript
describe('Panic Escalation', () => {
  it('escalation_level increments correctly', async () => {
    const createRes = await request(app)
      .post('/api/dispatch/panic')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({});
    const panicId = createRes.body.panic_id;

    // Manually update escalation level (simulating timer)
    db.prepare('UPDATE panic_alerts SET escalation_level = 1 WHERE id = ?').run(panicId);
    const panic = db.prepare('SELECT * FROM panic_alerts WHERE id = ?').get(panicId) as any;
    expect(panic.escalation_level).toBe(1);
  });

  it('acknowledgment prevents further escalation', async () => {
    const createRes = await request(app)
      .post('/api/dispatch/panic')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({});
    const panicId = createRes.body.panic_id;

    await request(app)
      .post(`/api/dispatch/panic/${panicId}/acknowledge`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    const panic = db.prepare('SELECT * FROM panic_alerts WHERE id = ?').get(panicId) as any;
    expect(panic.status).toBe('acknowledged');
    // Timer should be cancelled — verified by escalation_level staying at 0
    expect(panic.escalation_level).toBe(0);
  });
});
```

**Step 2: Implement escalation timer in panic.ts**

In the POST `/panic` handler, after creating the panic record and broadcasting, add:

```typescript
function startEscalationTimer(panicId: number, db: any): void {
  const getConfig = (key: string, fallback: number) => {
    const row = db.prepare('SELECT config_value FROM system_config WHERE config_key = ?').get(key) as any;
    return row ? parseInt(row.config_value) : fallback;
  };

  const esc1 = getConfig('panic_escalation_1_seconds', 30) * 1000;
  const esc2 = getConfig('panic_escalation_2_seconds', 60) * 1000;
  const esc3 = getConfig('panic_escalation_3_seconds', 90) * 1000;

  const timers: NodeJS.Timeout[] = [];

  // Level 1: Re-broadcast
  timers.push(setTimeout(() => {
    const panic = db.prepare('SELECT * FROM panic_alerts WHERE id = ?').get(panicId) as any;
    if (!panic || panic.status !== 'active') return;
    db.prepare('UPDATE panic_alerts SET escalation_level = 1 WHERE id = ?').run(panicId);
    broadcastPanic({ type: 'panic_escalated', data: { panic_id: panicId, level: 1 } });
    // Re-broadcast the original alert
    broadcastPanic({ type: 'panic_alert', data: { ...panic, escalation_level: 1 } });
    // Create critical notification
    createNotificationForRoles(db, ['admin', 'supervisor', 'manager', 'dispatcher'],
      'critical', 'PANIC UNACKNOWLEDGED',
      `Panic alert from officer ${panic.user_id} not acknowledged after ${esc1/1000}s`,
      'panic_alerts', panicId);
  }, esc1));

  // Level 2: Auto-dispatch nearest units
  timers.push(setTimeout(() => {
    const panic = db.prepare('SELECT * FROM panic_alerts WHERE id = ?').get(panicId) as any;
    if (!panic || panic.status !== 'active') return;
    db.prepare('UPDATE panic_alerts SET escalation_level = 2 WHERE id = ?').run(panicId);
    autoDispatchNearestUnits(db, panic);
    broadcastPanic({ type: 'panic_escalated', data: { panic_id: panicId, level: 2 } });
  }, esc2));

  // Level 3: Email supervisors
  timers.push(setTimeout(async () => {
    const panic = db.prepare('SELECT * FROM panic_alerts WHERE id = ?').get(panicId) as any;
    if (!panic || panic.status !== 'active') return;
    db.prepare('UPDATE panic_alerts SET escalation_level = 3 WHERE id = ?').run(panicId);
    await emailSupervisors(db, panic);
    broadcastPanic({ type: 'panic_escalated', data: { panic_id: panicId, level: 3 } });
  }, esc3));

  escalationTimers.set(panicId, timers);
}
```

**Step 3: Add auto-dispatch and email helpers**

```typescript
function autoDispatchNearestUnits(db: any, panic: any): void {
  if (!panic.latitude || !panic.longitude) return;

  const availableUnits = db.prepare(`
    SELECT * FROM units
    WHERE status IN ('available', 'on_patrol')
    AND latitude IS NOT NULL AND longitude IS NOT NULL
    ORDER BY (
      (latitude - ?) * (latitude - ?) +
      (longitude - ?) * (longitude - ?)
    ) ASC
    LIMIT 3
  `).all(panic.latitude, panic.latitude, panic.longitude, panic.longitude);

  const unitIds: number[] = [];
  for (const unit of availableUnits) {
    db.prepare('UPDATE units SET status = ?, current_call_id = ? WHERE id = ?')
      .run('dispatched', panic.call_id, unit.id);
    unitIds.push(unit.id);
    broadcastUnitUpdate({ action: 'unit_status', unit: { ...unit, status: 'dispatched' } });
  }

  db.prepare('UPDATE panic_alerts SET responder_unit_ids = ? WHERE id = ?')
    .run(JSON.stringify(unitIds), panic.id);
}

async function emailSupervisors(db: any, panic: any): Promise<void> {
  try {
    const { sendNotificationEmail } = await import('../../utils/emailSender');
    const supervisors = db.prepare(
      "SELECT email, full_name FROM users WHERE role IN ('admin', 'supervisor', 'manager') AND email IS NOT NULL"
    ).all() as any[];

    const user = db.prepare('SELECT full_name, badge_number FROM users WHERE id = ?').get(panic.user_id) as any;

    for (const sup of supervisors) {
      await sendNotificationEmail({
        to: sup.email,
        subject: `EMERGENCY: Unacknowledged Panic Alert — ${user?.full_name || 'Unknown'}`,
        body: `
          <h2 style="color: red;">Panic Alert — Unacknowledged after 90 seconds</h2>
          <p><strong>Officer:</strong> ${user?.full_name} (Badge: ${user?.badge_number})</p>
          <p><strong>Location:</strong> ${panic.location_address || 'Unknown'}</p>
          <p><strong>GPS:</strong> ${panic.latitude}, ${panic.longitude}</p>
          <p><strong>Time:</strong> ${panic.created_at}</p>
          <p><strong>Message:</strong> ${panic.message || 'None'}</p>
          <p>This alert has not been acknowledged. Immediate action required.</p>
        `,
      });
    }
  } catch (err) {
    console.error('Failed to email supervisors for panic escalation:', err);
  }
}
```

**Step 4: Add new broadcast types to websocket.ts**

In `server/src/utils/websocket.ts`, after line 858 (after `broadcastPanicAudio`), add handler cases for the new message types in the WebSocket message handler. The `broadcastPanic` function already broadcasts to all clients, so these new types just need to be recognized client-side.

**Step 5: Run tests**

Run: `cd server && npx vitest run tests/integration/panic.test.ts --reporter=verbose`
Expected: All PASS

**Step 6: Commit**

```bash
git add server/src/routes/dispatch/panic.ts server/src/utils/websocket.ts server/tests/integration/panic.test.ts
git commit -m "feat(panic): add escalation engine with re-broadcast, auto-dispatch, email"
```

---

### Task 4: Server-Side Panic Audio Recording

**Files:**
- Modify: `server/src/utils/websocket.ts` (add audio chunk writing)
- Modify: `server/src/routes/dispatch/panic.ts` (add audio upload/serve endpoints)
- Create: `server/uploads/panic/` directory (handled at runtime)

**Step 1: Add audio chunk handler to WebSocket**

In `server/src/utils/websocket.ts`, within the `panic_audio` message handler, add server-side file writing:

```typescript
// Inside the panic_audio message handler:
import fs from 'fs';
import path from 'path';

const panicAudioDir = path.join(__dirname, '../../uploads/panic');
if (!fs.existsSync(panicAudioDir)) fs.mkdirSync(panicAudioDir, { recursive: true });

// When panic_audio chunk arrives:
if (data.chunk && data.panicId) {
  const filePath = path.join(panicAudioDir, `${data.panicId}_raw.webm`);
  const buffer = Buffer.from(data.audio, 'base64');
  fs.appendFileSync(filePath, buffer);
}

// When panic_audio end signal arrives:
if (data.end && data.panicId) {
  const filePath = path.join(panicAudioDir, `${data.panicId}_raw.webm`);
  if (fs.existsSync(filePath)) {
    const stats = fs.statSync(filePath);
    const db = getDb();
    // Create attachment record
    const fileId = `panic_${data.panicId}_${Date.now()}`;
    db.prepare(`INSERT INTO attachments (file_id, original_name, stored_name, file_path, mime_type, file_size, entity_type, entity_id, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      fileId, `panic_${data.panicId}.webm`, `${data.panicId}_raw.webm`, filePath,
      'audio/webm', stats.size, 'panic_alert', data.panicId, data.userId
    );
    // Link to panic_alerts
    db.prepare('UPDATE panic_alerts SET audio_file_id = ?, audio_duration_seconds = ? WHERE id = ?')
      .run(fileId, data.duration || 60, data.panicId);
  }
}
```

**Step 2: Add audio serve endpoint to panic.ts**

```typescript
// GET /panic/:id/audio — stream recorded audio
router.get('/panic/:id/audio', requireRole('admin', 'supervisor', 'manager'), (req: Request, res: Response) => {
  const db = getDb();
  const panic = db.prepare('SELECT audio_file_id FROM panic_alerts WHERE id = ?').get(parseInt(req.params.id)) as any;
  if (!panic?.audio_file_id) return res.status(404).json({ error: 'No audio recorded' });

  const attachment = db.prepare('SELECT * FROM attachments WHERE file_id = ?').get(panic.audio_file_id) as any;
  if (!attachment || !fs.existsSync(attachment.file_path)) return res.status(404).json({ error: 'Audio file not found' });

  res.setHeader('Content-Type', attachment.mime_type);
  res.setHeader('Content-Length', attachment.file_size);
  fs.createReadStream(attachment.file_path).pipe(res);
});
```

**Step 3: Run tests**

Run: `cd server && npx vitest run tests/integration/panic.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add server/src/utils/websocket.ts server/src/routes/dispatch/panic.ts
git commit -m "feat(panic): add server-side audio recording and streaming"
```

---

## Phase 2: Radio Console Client Components

### Task 5: RadioConsole Container + Layout Integration

**Files:**
- Create: `client/src/components/radio/RadioConsole.tsx`
- Modify: `client/src/components/Layout.tsx` (add sidebar at line ~1417)

**Step 1: Create RadioConsole.tsx skeleton**

Create `client/src/components/radio/RadioConsole.tsx` — the main container with collapsed/expanded states, dark chrome styling, section layout. Start with the outer shell only (no child components yet).

```typescript
import React, { useState, useEffect } from 'react';
import { Radio, ChevronLeft, ChevronRight } from 'lucide-react';

interface RadioConsoleProps {
  className?: string;
}

export default function RadioConsole({ className }: RadioConsoleProps) {
  const [isExpanded, setIsExpanded] = useState(() => {
    return localStorage.getItem('rmpg-radio-panel-open') === 'true';
  });

  useEffect(() => {
    localStorage.setItem('rmpg-radio-panel-open', String(isExpanded));
  }, [isExpanded]);

  // R key toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'r' && !e.ctrlKey && !e.metaKey && !e.altKey &&
          !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        setIsExpanded(prev => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  if (!isExpanded) {
    return (
      <div
        className={`w-[48px] bg-[#0a0a0a] border-r border-[#222222] flex flex-col items-center py-2 cursor-pointer select-none ${className}`}
        onClick={() => setIsExpanded(true)}
      >
        <div className="writing-mode-vertical text-[#d4a017] text-[9px] font-bold tracking-[2px] uppercase mb-2"
          style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}>
          RADIO
        </div>
        {/* TX/RX LED */}
        <div className="w-2 h-2 rounded-full bg-[#444444] mb-2" title="Idle" />
        {/* Mute indicator */}
        <Radio size={14} className="text-[#666666]" />
        <ChevronRight size={12} className="text-[#444444] mt-auto" />
      </div>
    );
  }

  return (
    <div className={`w-[320px] bg-[#0a0a0a] border-r border-[#222222] flex flex-col overflow-y-auto overflow-x-hidden scrollbar-dark ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-gradient-to-b from-[#1a1a1a] to-[#242424] border-b border-[#2e2e2e]">
        <span className="text-[#d4a017] text-[10px] font-bold tracking-[1px] uppercase">RMPG Radio Console</span>
        <button onClick={() => setIsExpanded(false)} className="text-[#666666] hover:text-[#999999]">
          <ChevronLeft size={14} />
        </button>
      </div>

      {/* Sections rendered here — child components added in subsequent tasks */}
      <div className="flex-1 p-2 space-y-2">
        {/* Task 6: EncryptionIndicator */}
        {/* Task 7: ChannelCard + RadioChannelScanner */}
        {/* Task 8: SignalMeter */}
        {/* Task 9: UnitSelector */}
        {/* Task 10: PTTButton */}
        {/* Task 11: EmergencyOverride */}
        {/* Task 12: TransmissionLog */}
        {/* Task 13: QuickCommands */}
        <div className="text-[#444444] text-[10px] text-center py-4">Radio console loading...</div>
      </div>
    </div>
  );
}
```

**Step 2: Integrate into Layout.tsx**

In `client/src/components/Layout.tsx`, at line ~1417 (the flex container):

Change:
```tsx
<div className="flex flex-1 min-h-0 overflow-hidden">
  <main id="main-content" ...>
```

To:
```tsx
<div className="flex flex-1 min-h-0 overflow-hidden">
  <RadioConsole />
  <main id="main-content" ...>
```

Add import at top: `import RadioConsole from './radio/RadioConsole';`

**Step 3: Verify TypeScript compiles**

Run: `cd client && npx tsc --noEmit`
Expected: 0 errors

**Step 4: Commit**

```bash
git add client/src/components/radio/RadioConsole.tsx client/src/components/Layout.tsx
git commit -m "feat(radio): add RadioConsole container with collapsed/expanded states"
```

---

### Task 6: Encryption Indicator Component

**Files:**
- Create: `client/src/components/radio/EncryptionIndicator.tsx`
- Modify: `client/src/components/radio/RadioConsole.tsx` (mount component)

**Step 1: Create EncryptionIndicator.tsx**

```typescript
import React, { useState } from 'react';
import { Lock, Unlock, ShieldAlert } from 'lucide-react';

type EncryptionMode = 'secure' | 'clear' | 'scramble';

interface EncryptionIndicatorProps {
  onModeChange?: (mode: EncryptionMode) => void;
}

export default function EncryptionIndicator({ onModeChange }: EncryptionIndicatorProps) {
  const [mode, setMode] = useState<EncryptionMode>(() => {
    return (localStorage.getItem('rmpg-radio-encryption') as EncryptionMode) || 'secure';
  });

  const handleModeChange = (newMode: EncryptionMode) => {
    setMode(newMode);
    localStorage.setItem('rmpg-radio-encryption', newMode);
    onModeChange?.(newMode);
  };

  const ledColor = mode === 'secure' ? '#22c55e' : mode === 'scramble' ? '#d4a017' : '#dc2626';
  const ledGlow = mode === 'secure' ? 'rgba(34,197,94,0.4)' : mode === 'scramble' ? 'rgba(212,160,23,0.4)' : 'rgba(220,38,38,0.4)';

  return (
    <div className="border border-[#222222] rounded-[2px] p-2 bg-[#0d0d0d]">
      <div className="text-[9px] font-semibold text-[#888888] uppercase tracking-[0.5px] mb-1.5">Encryption</div>
      <div className="flex items-center gap-2 mb-2">
        {/* LED */}
        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: ledColor, boxShadow: `0 0 4px ${ledGlow}` }} />
        {mode === 'secure' ? <Lock size={12} className="text-[#22c55e]" /> :
         mode === 'scramble' ? <ShieldAlert size={12} className="text-[#d4a017]" /> :
         <Unlock size={12} className="text-[#dc2626]" />}
        <span className="text-[11px] font-mono text-[#cccccc]">
          P25 {mode.toUpperCase()}
        </span>
        <span className="text-[10px] font-mono text-[#666666] ml-auto">Key: 0x4A</span>
      </div>
      <div className="flex gap-1">
        {(['secure', 'clear', 'scramble'] as const).map(m => (
          <button
            key={m}
            onClick={() => handleModeChange(m)}
            className={`flex-1 text-[9px] font-semibold uppercase py-0.5 rounded-[2px] border transition-colors ${
              mode === m
                ? 'bg-[#1a1a1a] text-[#d4a017] border-[#d4a017]'
                : 'bg-[#0a0a0a] text-[#666666] border-[#222222] hover:border-[#444444]'
            }`}
          >
            {m}
          </button>
        ))}
      </div>
    </div>
  );
}
```

**Step 2: Mount in RadioConsole.tsx**

Replace the placeholder comment with: `<EncryptionIndicator />`

**Step 3: TypeScript check**

Run: `cd client && npx tsc --noEmit`

**Step 4: Commit**

```bash
git add client/src/components/radio/EncryptionIndicator.tsx client/src/components/radio/RadioConsole.tsx
git commit -m "feat(radio): add P25 encryption indicator with secure/clear/scramble modes"
```

---

### Task 7: Channel Cards + Scanner

**Files:**
- Create: `client/src/components/radio/ChannelCard.tsx`
- Create: `client/src/components/radio/RadioChannelScanner.tsx`
- Create: `client/src/hooks/useRadioConsole.ts`
- Modify: `client/src/components/radio/RadioConsole.tsx`

**Step 1: Create useRadioConsole.ts hook**

Manages channel state, scanner, and active transmissions:

```typescript
import { useState, useEffect, useCallback, useRef } from 'react';

export interface RadioChannel {
  id: string;
  name: string;
  zone: string;
  isActive: boolean;
  activeTransmitter?: string; // unit call sign
  unitsOnline: number;
}

const DEFAULT_CHANNELS: RadioChannel[] = [
  { id: 'ch01', name: 'Dispatch Main', zone: 'Zone 1', isActive: false, unitsOnline: 0 },
  { id: 'ch02', name: 'Tactical', zone: 'Zone 2', isActive: false, unitsOnline: 0 },
  { id: 'ch03', name: 'Supervisors', zone: 'Admin', isActive: false, unitsOnline: 0 },
];

export function useRadioConsole() {
  const [channels, setChannels] = useState<RadioChannel[]>(DEFAULT_CHANNELS);
  const [activeChannelId, setActiveChannelId] = useState('ch01');
  const [isScanning, setIsScanning] = useState(false);
  const [scanIndex, setScanIndex] = useState(0);
  const scanTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Scanner logic
  useEffect(() => {
    if (!isScanning) {
      if (scanTimerRef.current) clearInterval(scanTimerRef.current);
      return;
    }
    scanTimerRef.current = setInterval(() => {
      setScanIndex(prev => {
        const next = (prev + 1) % channels.length;
        // Pause on active channel
        const ch = channels[next];
        if (ch.isActive) {
          // Will resume after 5s silence — handled by channel activity listener
        }
        return next;
      });
    }, 3000);
    return () => { if (scanTimerRef.current) clearInterval(scanTimerRef.current); };
  }, [isScanning, channels]);

  const toggleScan = useCallback(() => setIsScanning(prev => !prev), []);

  return {
    channels,
    setChannels,
    activeChannelId,
    setActiveChannelId,
    isScanning,
    toggleScan,
    scanIndex,
  };
}
```

**Step 2: Create ChannelCard.tsx**

LCD-style channel display with activity bar:

```typescript
import React from 'react';
import type { RadioChannel } from '../../hooks/useRadioConsole';

interface ChannelCardProps {
  channel: RadioChannel;
  isSelected: boolean;
  isScanning: boolean;
  onClick: () => void;
}

export default function ChannelCard({ channel, isSelected, isScanning, onClick }: ChannelCardProps) {
  return (
    <div
      onClick={onClick}
      className={`border rounded-[2px] p-1.5 cursor-pointer transition-colors ${
        isSelected
          ? 'border-[#d4a017] bg-[#050505]'
          : 'border-[#1a1a1a] bg-[#050505] hover:border-[#333333]'
      }`}
    >
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[10px] font-mono" style={{
          color: isSelected ? '#33ff33' : '#1a5a1a',
          textShadow: isSelected ? '0 0 4px rgba(51,255,51,0.3)' : 'none'
        }}>
          {channel.zone} — {channel.name}
        </span>
      </div>
      {/* Activity bar */}
      <div className="flex items-center gap-1.5">
        <div className="flex-1 h-1 bg-[#111111] rounded-[1px] overflow-hidden">
          {channel.isActive && (
            <div className="h-full bg-[#22c55e] animate-pulse" style={{ width: '60%' }} />
          )}
        </div>
        <span className="text-[9px] font-mono text-[#1a5a1a]">
          {channel.isActive ? `RX ▸ ${channel.activeTransmitter || '???'}` : 'IDLE'}
        </span>
      </div>
      <div className="text-[8px] text-[#444444] mt-0.5">
        {channel.unitsOnline} units online
      </div>
    </div>
  );
}
```

**Step 3: Create RadioChannelScanner.tsx**

```typescript
import React from 'react';
import ChannelCard from './ChannelCard';
import type { RadioChannel } from '../../hooks/useRadioConsole';

interface RadioChannelScannerProps {
  channels: RadioChannel[];
  activeChannelId: string;
  isScanning: boolean;
  scanIndex: number;
  onChannelSelect: (id: string) => void;
  onToggleScan: () => void;
}

export default function RadioChannelScanner({
  channels, activeChannelId, isScanning, scanIndex, onChannelSelect, onToggleScan,
}: RadioChannelScannerProps) {
  return (
    <div className="border border-[#222222] rounded-[2px] p-2 bg-[#0d0d0d]">
      <div className="text-[9px] font-semibold text-[#888888] uppercase tracking-[0.5px] mb-1.5">Channels</div>
      <div className="space-y-1 mb-2">
        {channels.map((ch, i) => (
          <ChannelCard
            key={ch.id}
            channel={ch}
            isSelected={ch.id === activeChannelId}
            isScanning={isScanning && scanIndex === i}
            onClick={() => onChannelSelect(ch.id)}
          />
        ))}
      </div>
      <div className="flex gap-1">
        <button
          onClick={onToggleScan}
          className={`flex-1 text-[9px] font-semibold uppercase py-0.5 rounded-[2px] border ${
            isScanning
              ? 'bg-[#1a1a1a] text-[#d4a017] border-[#d4a017]'
              : 'bg-[#0a0a0a] text-[#666666] border-[#222222] hover:border-[#444444]'
          }`}
        >
          {isScanning ? 'SCAN ▸' : 'SCAN'}
        </button>
        <button className="flex-1 text-[9px] font-semibold uppercase py-0.5 rounded-[2px] border bg-[#0a0a0a] text-[#666666] border-[#222222] hover:border-[#444444]">
          +ADD CH
        </button>
      </div>
    </div>
  );
}
```

**Step 4: Mount in RadioConsole.tsx**

Import and render: `<RadioChannelScanner channels={channels} ... />`

**Step 5: TypeScript check**

Run: `cd client && npx tsc --noEmit`

**Step 6: Commit**

```bash
git add client/src/components/radio/ChannelCard.tsx client/src/components/radio/RadioChannelScanner.tsx client/src/hooks/useRadioConsole.ts client/src/components/radio/RadioConsole.tsx
git commit -m "feat(radio): add channel cards, scanner, and console state hook"
```

---

### Task 8: Signal Strength Meter

**Files:**
- Create: `client/src/components/radio/SignalMeter.tsx`
- Create: `client/src/hooks/useSignalStrength.ts`
- Modify: `client/src/components/radio/RadioConsole.tsx`

**Step 1: Create useSignalStrength.ts**

Measures WebSocket ping latency and throughput:

```typescript
import { useState, useEffect, useRef } from 'react';
import { useWebSocket } from '../contexts/WebSocketContext';

export interface SignalStats {
  latencyMs: number;
  signalBars: number;       // 0-12
  throughputUp: number;     // kB/s
  throughputDown: number;   // kB/s
  packetLoss: number;       // 0-100%
  dbm: number;              // simulated dBm
}

export function useSignalStrength(): SignalStats {
  const { ws } = useWebSocket();
  const [stats, setStats] = useState<SignalStats>({
    latencyMs: 0, signalBars: 12, throughputUp: 0, throughputDown: 0, packetLoss: 0, dbm: -20,
  });

  const pingTimes = useRef<number[]>([]);
  const missedPings = useRef(0);
  const totalPings = useRef(0);
  const bytesUp = useRef(0);
  const bytesDown = useRef(0);

  useEffect(() => {
    if (!ws) return;

    const interval = setInterval(() => {
      totalPings.current++;
      const start = performance.now();

      // Send ping
      try {
        ws.send(JSON.stringify({ type: 'ping', ts: start }));
        bytesUp.current += 30;
      } catch {
        missedPings.current++;
      }

      // Calculate stats from rolling window
      const avgLatency = pingTimes.current.length > 0
        ? pingTimes.current.reduce((a, b) => a + b, 0) / pingTimes.current.length
        : 0;

      const bars = avgLatency < 30 ? 12 : avgLatency < 50 ? 10 : avgLatency < 100 ? 8 :
                   avgLatency < 200 ? 6 : avgLatency < 400 ? 4 : avgLatency < 800 ? 2 : 1;

      const dbm = Math.round(-20 - (avgLatency / 10));
      const pl = totalPings.current > 0 ? (missedPings.current / totalPings.current) * 100 : 0;

      setStats({
        latencyMs: Math.round(avgLatency),
        signalBars: bars,
        throughputUp: Math.round(bytesUp.current / 2048 * 10) / 10,
        throughputDown: Math.round(bytesDown.current / 2048 * 10) / 10,
        packetLoss: Math.round(pl * 10) / 10,
        dbm,
      });

      // Reset throughput counters
      bytesUp.current = 0;
      bytesDown.current = 0;
    }, 2000);

    // Listen for pong responses
    const handleMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'pong' && data.ts) {
          const latency = performance.now() - data.ts;
          pingTimes.current.push(latency);
          if (pingTimes.current.length > 10) pingTimes.current.shift();
          bytesDown.current += 30;
        } else {
          bytesDown.current += event.data.length;
        }
      } catch {}
    };

    ws.addEventListener('message', handleMessage);
    return () => {
      clearInterval(interval);
      ws.removeEventListener('message', handleMessage);
    };
  }, [ws]);

  return stats;
}
```

**Step 2: Create SignalMeter.tsx**

S-meter with 12 bars + network stats:

```typescript
import React from 'react';
import type { SignalStats } from '../../hooks/useSignalStrength';

interface SignalMeterProps {
  stats: SignalStats;
}

export default function SignalMeter({ stats }: SignalMeterProps) {
  return (
    <div className="border border-[#222222] rounded-[2px] p-2 bg-[#0d0d0d]">
      <div className="text-[9px] font-semibold text-[#888888] uppercase tracking-[0.5px] mb-1.5">Signal</div>
      {/* S-meter bars */}
      <div className="flex items-center gap-0.5 mb-1">
        <span className="text-[9px] font-mono text-[#666666] mr-1">S</span>
        {Array.from({ length: 12 }, (_, i) => {
          const active = i < stats.signalBars;
          const color = i < 6 ? '#22c55e' : i < 9 ? '#d4a017' : '#dc2626';
          return (
            <div
              key={i}
              className="w-[3px] h-3 rounded-[1px]"
              style={{
                backgroundColor: active ? color : '#1a1a1a',
                boxShadow: active ? `0 0 2px ${color}` : 'none',
              }}
            />
          );
        })}
        <span className="text-[9px] font-mono text-[#666666] ml-1.5">{stats.dbm}dBm</span>
      </div>
      {/* Stats row */}
      <div className="flex items-center gap-2 text-[8px] font-mono text-[#555555]">
        <span>⏱ {stats.latencyMs}ms</span>
        <span>▲{stats.throughputUp}k</span>
        <span>▼{stats.throughputDown}k</span>
        <span>PL {stats.packetLoss}%</span>
      </div>
    </div>
  );
}
```

**Step 3: Mount in RadioConsole.tsx**

**Step 4: TypeScript check + Commit**

```bash
git add client/src/components/radio/SignalMeter.tsx client/src/hooks/useSignalStrength.ts client/src/components/radio/RadioConsole.tsx
git commit -m "feat(radio): add S-meter signal strength indicator with latency/throughput"
```

---

### Task 9: Unit Selector + Radio Check

**Files:**
- Create: `client/src/components/radio/UnitSelector.tsx`
- Create: `client/src/hooks/useRadioCheck.ts`
- Modify: `client/src/components/radio/RadioConsole.tsx`

**Step 1: Create useRadioCheck.ts**

```typescript
import { useState, useCallback } from 'react';
import { useWebSocket } from '../contexts/WebSocketContext';

interface RadioCheckResult {
  unitId: number;
  callSign: string;
  latencyMs: number;
  batteryPercent: number;
  gpsAccuracy: number;
  timestamp: string;
  status: 'pending' | 'ack' | 'timeout';
}

export function useRadioCheck() {
  const { send, subscribe } = useWebSocket();
  const [results, setResults] = useState<RadioCheckResult[]>([]);

  const sendRadioCheck = useCallback((unitId: number, callSign: string) => {
    const sentAt = Date.now();
    setResults(prev => [...prev, {
      unitId, callSign, latencyMs: 0, batteryPercent: 0, gpsAccuracy: 0,
      timestamp: new Date().toISOString(), status: 'pending'
    }]);

    send({ type: 'radio_check', data: { unitId, sentAt } });

    // Timeout after 10 seconds
    const timeout = setTimeout(() => {
      setResults(prev => prev.map(r =>
        r.unitId === unitId && r.status === 'pending' ? { ...r, status: 'timeout' } : r
      ));
    }, 10000);

    // Listen for ack (one-shot)
    const unsub = subscribe('radio_check_ack', (msg: any) => {
      if (msg.data?.unitId === unitId) {
        clearTimeout(timeout);
        setResults(prev => prev.map(r =>
          r.unitId === unitId && r.status === 'pending' ? {
            ...r,
            status: 'ack',
            latencyMs: Date.now() - sentAt,
            batteryPercent: msg.data.battery || 0,
            gpsAccuracy: msg.data.gpsAccuracy || 0,
          } : r
        ));
        unsub();
      }
    });
  }, [send, subscribe]);

  return { sendRadioCheck, results };
}
```

**Step 2: Create UnitSelector.tsx**

Shows online units as chips with LED indicators, dropdown for target selection, PAGE GROUP and RADIO CHECK buttons.

**Step 3: Mount + TypeScript check + Commit**

```bash
git add client/src/components/radio/UnitSelector.tsx client/src/hooks/useRadioCheck.ts client/src/components/radio/RadioConsole.tsx
git commit -m "feat(radio): add unit selector with radio check ping/ack"
```

---

### Task 10: PTT Button Component

**Files:**
- Create: `client/src/components/radio/PTTButton.tsx`
- Modify: `client/src/components/radio/RadioConsole.tsx`

**Step 1: Create PTTButton.tsx**

3D beveled push-to-talk button with LED indicator, volume slider, and V-key binding. Integrates with existing `voiceChannel.ts` state machine via `startListening()` / `stopListening()`.

Key behaviors:
- Mouse down / V key hold → TX mode (red glow, LED on)
- Release → stop TX, return to idle
- Receiving state → green glow (triggered by incoming radio_transmission WS messages)
- Volume slider: 0-100, stored in `rmpg-radio-volume` localStorage

**Step 2: Mount + TypeScript check + Commit**

```bash
git add client/src/components/radio/PTTButton.tsx client/src/components/radio/RadioConsole.tsx
git commit -m "feat(radio): add PTT button with V-key binding and 3D beveled styling"
```

---

### Task 11: Emergency Talkgroup Override

**Files:**
- Create: `client/src/components/radio/EmergencyOverride.tsx`
- Modify: `client/src/components/radio/RadioConsole.tsx`
- Modify: `server/src/utils/websocket.ts` (handle emergency_talkgroup messages)

**Step 1: Create EmergencyOverride.tsx**

RED button with diagonal warning stripes, 2-second hold-to-activate, broadcasts `emergency_talkgroup_active` via WebSocket.

**Step 2: Add server-side handler**

In `websocket.ts`, handle `emergency_talkgroup_active` message — rebroadcast to all clients, log in activity_log, start 30-minute auto-deactivation timer.

**Step 3: Mount + TypeScript check + Commit**

```bash
git add client/src/components/radio/EmergencyOverride.tsx server/src/utils/websocket.ts client/src/components/radio/RadioConsole.tsx
git commit -m "feat(radio): add emergency talkgroup override with 2s hold activation"
```

---

### Task 12: Transmission Log

**Files:**
- Create: `client/src/components/radio/TransmissionLog.tsx`
- Modify: `client/src/components/radio/RadioConsole.tsx`

**Step 1: Create TransmissionLog.tsx**

Scrollable log (100 entries max, newest on top). Color-coded entries: dispatch=gold, units=white, emergency=red, system=amber. Each entry: timestamp + unit + transcription text.

**Step 2: Mount + TypeScript check + Commit**

```bash
git add client/src/components/radio/TransmissionLog.tsx client/src/components/radio/RadioConsole.tsx
git commit -m "feat(radio): add transmission log with color-coded entries"
```

---

### Task 13: Quick Commands + StatusBar Radio Indicator

**Files:**
- Create: `client/src/components/radio/QuickCommands.tsx`
- Create: `client/src/components/StatusBarRadio.tsx`
- Modify: `client/src/components/StatusBar.tsx`
- Modify: `client/src/components/radio/RadioConsole.tsx`

**Step 1: Create QuickCommands.tsx**

7 configurable one-tap buttons that send voice command text through the command execution pipeline.

**Step 2: Create StatusBarRadio.tsx**

Compact indicator for the status bar: mic icon (gray idle, red TX, green RX) + current channel name. Click opens radio panel.

**Step 3: Add to StatusBar.tsx**

Insert `<StatusBarRadio />` before the battery indicator (around line 119).

**Step 4: TypeScript check + Commit**

```bash
git add client/src/components/radio/QuickCommands.tsx client/src/components/StatusBarRadio.tsx client/src/components/StatusBar.tsx client/src/components/radio/RadioConsole.tsx
git commit -m "feat(radio): add quick commands and status bar radio indicator"
```

---

## Phase 3: Command Execution Engine

### Task 14: Voice Command Executor

**Files:**
- Create: `client/src/utils/voiceCommandExecutor.ts`
- Modify: `client/src/utils/voiceChannel.ts` (wire executor to processing state)

**Step 1: Create voiceCommandExecutor.ts**

Maps NLU-parsed commands to actual API calls:

```typescript
import { apiFetch } from '../hooks/useApi';

interface CommandResult {
  success: boolean;
  message: string;
  data?: any;
}

export async function executeVoiceCommand(
  action: string,
  params: Record<string, any>,
  confidence: number,
  userId: number,
): Promise<CommandResult> {
  // Low confidence — ask for confirmation
  if (confidence < 0.7 && confidence >= 0.5) {
    return { success: false, message: `Did you say ${action}? Please confirm.` };
  }
  if (confidence < 0.5) {
    return { success: false, message: "Please repeat, I didn't copy that." };
  }

  switch (action) {
    case 'status_update':
      return await handleStatusUpdate(params, userId);
    case 'acknowledge':
      return await handleAcknowledge(params);
    case 'request_backup':
      return await handleBackupRequest(params);
    case 'request_ems':
      return await handleEmsRequest(params);
    case 'request_k9':
      return await handleK9Request(params);
    case 'run_plate':
      return await handleRunPlate(params);
    case 'run_name':
      return await handleRunName(params);
    case 'next_call':
      return await handleNextCall();
    case 'start_pursuit':
      return await handleStartPursuit(params);
    case 'officer_down':
      return await handleOfficerDown(userId);
    case 'sitrep':
      return await handleSitrep(params);
    case 'code_4':
      return await handleCode4(params);
    case 'create_call':
      return await handleCreateCall(params);
    default:
      return { success: false, message: `Unknown command: ${action}` };
  }
}

async function handleStatusUpdate(params: any, userId: number): Promise<CommandResult> {
  // Find user's unit, update status
  const units = await apiFetch<any[]>('/dispatch/units');
  const myUnit = units.find(u => u.officer_id === userId);
  if (!myUnit) return { success: false, message: "Cannot find your unit assignment" };

  await apiFetch(`/dispatch/units/${myUnit.id}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status: params.status }),
  });
  return { success: true, message: `Copy, ${myUnit.call_sign} now showing ${params.status.replace(/_/g, ' ')}` };
}

async function handleBackupRequest(params: any): Promise<CommandResult> {
  if (!params.call_id) return { success: false, message: "No active call for backup request" };
  await apiFetch(`/dispatch/calls/${params.call_id}/backup`, { method: 'POST' });
  return { success: true, message: "Backup request transmitted" };
}

// ... similar handlers for each command type
```

**Step 2: Wire into voiceChannel.ts**

In the PROCESSING state handler, after NLU parsing returns, call `executeVoiceCommand()` and speak the result.

**Step 3: TypeScript check + Commit**

```bash
git add client/src/utils/voiceCommandExecutor.ts client/src/utils/voiceChannel.ts
git commit -m "feat(radio): add voice command executor wiring NLU to dispatch API"
```

---

### Task 15: New Server Endpoints for Voice Commands

**Files:**
- Modify: `server/src/routes/dispatch/calls.ts` or create new action endpoints
- Test: `server/tests/integration/dispatch.test.ts` (add tests)

**Step 1: Add backup/ems/k9/acknowledge/pursuit endpoints**

These are new POST endpoints on calls:
- `POST /dispatch/calls/:id/backup` — broadcast backup request
- `POST /dispatch/calls/:id/ems` — broadcast EMS request
- `POST /dispatch/calls/:id/k9` — broadcast K9 request
- `POST /dispatch/calls/:id/acknowledge` — log acknowledgment
- `POST /dispatch/calls/:id/pursuit` — initiate pursuit mode

Each follows the standard pattern: validate call exists, update DB, audit log, WebSocket broadcast.

**Step 2: Write tests for each endpoint**

**Step 3: Run tests + route collision check**

Run: `cd server && npx vitest run && npm run check:routes`

**Step 4: Commit**

```bash
git add server/src/routes/dispatch/ server/tests/integration/dispatch.test.ts
git commit -m "feat(dispatch): add backup/ems/k9/ack/pursuit call action endpoints"
```

---

## Phase 4: Audio Quality Upgrades

### Task 16: AudioWorklet Processors

**Files:**
- Create: `client/src/utils/audio/noiseGateProcessor.ts`
- Create: `client/src/utils/audio/bitcrusherProcessor.ts`
- Modify: `client/src/utils/edgeTTS.ts` (insert into filter chain)

**Step 1: Create noiseGateProcessor.ts**

AudioWorklet processor for noise gate: closes below -40dB threshold, 10ms attack, 100ms release.

```typescript
// This file is loaded as an AudioWorklet module
class NoiseGateProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: -40, minValue: -100, maxValue: 0 },
      { name: 'attack', defaultValue: 0.01, minValue: 0.001, maxValue: 0.1 },
      { name: 'release', defaultValue: 0.1, minValue: 0.01, maxValue: 1.0 },
    ];
  }

  private gain = 0;

  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input[0]) return true;

    const threshold = parameters.threshold[0];
    const attack = parameters.attack[0];
    const release = parameters.release[0];

    for (let channel = 0; channel < input.length; channel++) {
      const inputData = input[channel];
      const outputData = output[channel];

      for (let i = 0; i < inputData.length; i++) {
        const amplitude = Math.abs(inputData[i]);
        const db = 20 * Math.log10(amplitude + 1e-10);

        if (db > threshold) {
          this.gain = Math.min(1, this.gain + attack);
        } else {
          this.gain = Math.max(0, this.gain - release);
        }

        outputData[i] = inputData[i] * this.gain;
      }
    }
    return true;
  }
}

registerProcessor('noise-gate-processor', NoiseGateProcessor);
```

**Step 2: Create bitcrusherProcessor.ts**

12-bit quantization for IMBE/AMBE codec artifact simulation.

**Step 3: Insert into edgeTTS.ts audio chain**

Modify the `fetchAndPlay` function in `client/src/utils/edgeTTS.ts` to load the AudioWorklet modules and insert them into the filter chain:

```
Source → Noise Gate → AGC (DynamicsCompressor) → Highpass → Lowpass → Presence → Bitcrusher → Voice Gain → Output
```

**Step 4: TypeScript check + Commit**

```bash
git add client/src/utils/audio/ client/src/utils/edgeTTS.ts
git commit -m "feat(audio): add noise gate and bitcrusher AudioWorklet processors"
```

---

## Phase 5: Client-Side Panic Enhancements

### Task 17: Update PanicButton.tsx for Server-Side Ack

**Files:**
- Modify: `client/src/components/PanicButton.tsx`
- Modify: `client/src/hooks/usePanicAudio.ts`

**Step 1: Update PanicButton acknowledge handler**

Change the ACKNOWLEDGE button from local-only dismissal to `POST /dispatch/panic/:id/acknowledge`. Add handlers for new WS message types: `panic_acknowledged`, `panic_resolved`, `panic_cancelled`, `panic_false_alarm`, `panic_escalated`.

**Step 2: Add cancel button**

Show a "CANCEL" button for the triggering officer (only visible within 30 seconds, only for the officer who triggered).

**Step 3: Add false alarm button**

Show "FALSE ALARM" button for supervisor+ roles (requires notes input).

**Step 4: Update usePanicAudio.ts**

- Change `BROADCAST_DURATION` from 15 to read from `system_config` (default 60)
- Add `panicId` to WebSocket audio chunks for server-side recording
- Send end signal with duration when recording completes

**Step 5: Add haptic feedback**

In the panic trigger function, add: `if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 200]);`

**Step 6: TypeScript check + Commit**

```bash
git add client/src/components/PanicButton.tsx client/src/hooks/usePanicAudio.ts
git commit -m "feat(panic): wire server-side ack, cancel, false-alarm, extended audio recording"
```

---

### Task 18: Update Panic Map Zone

**Files:**
- Modify: `client/src/pages/map/hooks/useMapPanicZone.ts`

**Step 1: Add panic status indicators**

Update the map circles to reflect panic status: active = red pulsing, acknowledged = amber solid, resolved = green fading out. Show acknowledger name and timestamp on the info window.

**Step 2: Commit**

```bash
git add client/src/pages/map/hooks/useMapPanicZone.ts
git commit -m "feat(panic): update map zone with status-aware circle colors"
```

---

## Phase 6: Integration & Testing

### Task 19: Full Integration Test

**Step 1: Run all server tests**

Run: `cd server && npx vitest run`
Expected: All 356+ tests PASS (including new panic tests)

**Step 2: Run route collision check**

Run: `cd server && npm run check:routes`
Expected: 0 duplicates

**Step 3: Run client TypeScript check**

Run: `cd client && npx tsc --noEmit`
Expected: 0 errors

**Step 4: Build client**

Run: `cd client && npx vite build`
Expected: Build succeeds

**Step 5: Commit if any fixes needed**

### Task 20: Bump Version + Service Worker

**Files:**
- Modify: `client/public/sw.js` (bump CACHE_NAME)
- Modify: `server/package.json`, `client/package.json`, `desktop/package.json` (bump version to 5.8.0)

**Step 1: Bump CACHE_NAME**

In `client/public/sw.js`, change `CACHE_NAME` to include today's date.

**Step 2: Bump version strings**

Update version in all three package.json files to `5.8.0`.

**Step 3: Commit**

```bash
git add client/public/sw.js server/package.json client/package.json desktop/package.json
git commit -m "chore: bump to v5.8.0, update service worker cache"
```

---

## Summary

| Phase | Tasks | Focus |
|-------|-------|-------|
| Phase 1 | Tasks 1-4 | Database, server routes, escalation, audio recording |
| Phase 2 | Tasks 5-13 | Radio console UI components (9 components) |
| Phase 3 | Tasks 14-15 | Voice command execution engine |
| Phase 4 | Task 16 | Audio quality (AudioWorklet processors) |
| Phase 5 | Tasks 17-18 | Client panic enhancements |
| Phase 6 | Tasks 19-20 | Integration testing, version bump |

**Total estimated tasks:** 20
**New files:** ~20
**Modified files:** ~15
