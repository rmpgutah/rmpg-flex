// Admin CRUD for inbound email rules. Evaluated by the poller on new messages
// (see server/src/utils/emailRuleEngine.ts). Mounted at /api/email/rules.

import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken } from '../middleware/auth';
import { auditLog } from '../utils/auditLogger';
import { localNow } from '../utils/timeUtils';
import { matchesConditions, RuleConditions } from '../utils/emailRuleEngine';

const router = Router();
router.use(authenticateToken);

function canEditRule(rule: any, user: { userId: number; role: string }): boolean {
  // Global rules (owner IS NULL) require admin
  if (rule.owner_user_id === null) {
    return user.role === 'admin' || user.role === 'manager';
  }
  // User-owned rules require the owner
  return rule.owner_user_id === user.userId;
}

router.get('/', (req, res) => {
  const db = getDb();
  res.json(db.prepare(
    'SELECT * FROM email_rules WHERE owner_user_id IS NULL OR owner_user_id = ? ORDER BY priority ASC, id ASC'
  ).all(req.user!.userId));
});

router.post('/', (req: Request, res: Response) => {
  const db = getDb();
  const { name, priority = 100, enabled = 1, conditions, actions, global = false } = req.body || {};
  if (!name || !conditions || !actions) {
    return res.status(400).json({ error: 'name, conditions, actions required' });
  }

  // Only admins can create global rules
  const isAdmin = req.user!.role === 'admin' || req.user!.role === 'manager';
  if (global && !isAdmin) return res.status(403).json({ error: 'Only admins can create global rules' });

  const ownerUserId = global ? null : req.user!.userId;
  const now = localNow();
  const info = db.prepare(
    `INSERT INTO email_rules (name, priority, enabled, conditions_json, actions_json, created_by, created_at, updated_at, owner_user_id)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(name, priority, enabled ? 1 : 0, JSON.stringify(conditions), JSON.stringify(actions), req.user!.userId, now, now, ownerUserId);
  auditLog(req, 'CREATE' as any, 'email_rule' as any, info.lastInsertRowid as number, null, { name, conditions, actions, global });
  res.json({ id: info.lastInsertRowid, global: ownerUserId === null });
});

router.put('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const id = Number(req.params.id);
  const { name, priority, enabled, conditions, actions } = req.body || {};
  const existing = db.prepare('SELECT * FROM email_rules WHERE id = ?').get(id) as any;
  if (!existing) return res.status(404).json({ error: 'not found' });
  if (!canEditRule(existing, req.user!)) return res.status(403).json({ error: 'forbidden' });
  db.prepare(
    `UPDATE email_rules SET name=?, priority=?, enabled=?, conditions_json=?, actions_json=?, updated_at=? WHERE id=?`
  ).run(name, priority, enabled ? 1 : 0, JSON.stringify(conditions), JSON.stringify(actions), localNow(), id);
  auditLog(req, 'UPDATE' as any, 'email_rule' as any, id, existing, { name, conditions, actions });
  res.json({ success: true });
});

router.delete('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM email_rules WHERE id = ?').get(id) as any;
  if (!existing) return res.status(404).json({ error: 'not found' });
  if (!canEditRule(existing, req.user!)) return res.status(403).json({ error: 'forbidden' });
  db.prepare('DELETE FROM email_rules WHERE id = ?').run(id);
  auditLog(req, 'DELETE' as any, 'email_rule' as any, id, existing, null);
  res.json({ success: true });
});

router.post('/test-match', (req: Request, res: Response) => {
  const db = getDb();
  const { conditions, sample_email_id } = req.body || {};
  if (!conditions) return res.status(400).json({ error: 'conditions required' });

  if (sample_email_id) {
    // Verify the sample email belongs to the requesting user
    const email = db.prepare(
      `SELECT ec.from_address, ec.subject, ec.has_attachments, ec.importance, ec.owner_user_id,
         COALESCE((SELECT body_text FROM email_cache_fts WHERE rowid = ec.id), '') as body_text
       FROM email_cache ec WHERE ec.id = ?`
    ).get(Number(sample_email_id)) as any;
    if (!email || email.owner_user_id !== req.user!.userId) return res.status(404).json({ error: 'email not found' });
    return res.json({ matches: matchesConditions(conditions as RuleConditions, email) });
  }

  // No sample: test against the calling user's last 50 inbox messages
  const sample = db.prepare(
    `SELECT ec.id, ec.from_address, ec.subject, ec.has_attachments, ec.importance,
       COALESCE((SELECT body_text FROM email_cache_fts WHERE rowid = ec.id), '') as body_text
     FROM email_cache ec
     WHERE folder_id='inbox' AND owner_user_id = ?
     ORDER BY received_at DESC LIMIT 50`
  ).all(req.user!.userId) as any[];
  const hits = sample.filter(e => matchesConditions(conditions as RuleConditions, e));
  res.json({ matched: hits.length, total: sample.length, sample_ids: hits.slice(0, 10).map(e => e.id) });
});

export default router;
