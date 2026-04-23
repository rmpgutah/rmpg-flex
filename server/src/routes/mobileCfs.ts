import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import QRCode from 'qrcode';
import config from '../config';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { auditLog } from '../utils/auditLogger';
import { broadcastDispatchUpdate } from '../utils/websocket';
import { logger } from '../utils/logger';

const router = Router();

// ── Scoped-JWT middleware for /api/mobile/cfs/* ─────────────
// Verifies a mobile-scoped JWT and attaches `req.mobileAuth = { userId, callId }`.
interface MobileAuthPayload {
  userId: number;
  username: string;
  role: string;
  scope: 'pso-mobile';
  callId: number;
  iat?: number;
  exp?: number;
}
declare global {
  namespace Express {
    interface Request {
      mobileAuth?: MobileAuthPayload;
    }
  }
}

function authenticateMobile(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
  if (!token) { res.status(401).json({ error: 'Mobile authentication required' }); return; }
  try {
    const decoded = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] }) as MobileAuthPayload;
    if (decoded.scope !== 'pso-mobile') { res.status(403).json({ error: 'Invalid token scope' }); return; }
    if (!decoded.callId || !decoded.userId) { res.status(403).json({ error: 'Malformed mobile token' }); return; }
    // Confirm path :id matches the scoped call
    const paramId = parseInt(String(req.params.id || ''), 10);
    if (paramId && paramId !== decoded.callId) {
      res.status(403).json({ error: 'Token scoped to a different call' }); return;
    }
    req.mobileAuth = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid mobile token' });
  }
}

function publicUrl(): string {
  return process.env.PUBLIC_APP_URL || 'https://rmpgutah.us';
}

// ─── POST /api/cfs/:id/qr-token ─────────────────────────────
// Create a new single-dispatch QR token + rendered PNG for embedding in the
// printed PSO PDF. Called during PDF generation.
router.post('/cfs/:id/qr-token', authenticateToken, requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (req: Request, res: Response) => {
  try {
    const callId = parseInt(String(req.params.id), 10);
    if (!callId) { res.status(400).json({ error: 'Invalid call id' }); return; }
    const db = getDb();
    const call = db.prepare('SELECT id, incident_type FROM calls_for_service WHERE id = ?').get(callId) as any;
    if (!call) { res.status(404).json({ error: 'Call not found' }); return; }
    if (call.incident_type !== 'pso_client_request') {
      res.status(400).json({ error: 'QR tokens are only issued for PSO Client Request dispatches' });
      return;
    }
    const token = crypto.randomBytes(24).toString('base64url');
    db.prepare(`
      INSERT INTO pso_qr_tokens (call_id, token, scans_used, max_scans, created_by)
      VALUES (?, ?, 0, 5, ?)
    `).run(callId, token, req.user!.userId);
    const url = `${publicUrl()}/m/cfs/${callId}?t=${token}`;
    const qrPngDataUrl = await QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 1, scale: 6 });
    auditLog(req, 'CREATE', 'pso_qr_tokens', callId, null, { call_id: callId });
    res.json({ token, url, qr_png_base64: qrPngDataUrl });
  } catch (err) {
    logger.error({ err }, 'qr-token create failed');
    res.status(500).json({ error: 'Failed to create QR token' });
  }
});

// ─── GET /api/mobile/cfs/:id/challenge ──────────────────────
// Verify token (no scan increment yet) and return minimal call summary so
// the mobile page can show what the officer is about to touch.
router.get('/mobile/cfs/:id/challenge', (req: Request, res: Response) => {
  try {
    const callId = parseInt(String(req.params.id), 10);
    const token = String(req.query.t || '');
    if (!callId || !token) { res.status(400).json({ error: 'Missing call id or token' }); return; }
    const db = getDb();
    const row = db.prepare(`
      SELECT id, call_id, scans_used, max_scans, admin_override, revoked_at
      FROM pso_qr_tokens WHERE token = ? AND call_id = ?
    `).get(token, callId) as any;
    if (!row) { res.status(404).json({ error: 'Unknown QR token' }); return; }
    if (row.revoked_at) { res.status(403).json({ error: 'QR token has been revoked' }); return; }
    if (!row.admin_override && row.scans_used >= row.max_scans) {
      res.status(403).json({ error: 'QR scan limit reached; ask an admin to reissue or override' });
      return;
    }
    const call = db.prepare(`
      SELECT id, call_number, incident_type, location_address AS location, pso_service_type, contract_id, status, priority, created_at
      FROM calls_for_service WHERE id = ?
    `).get(callId) as any;
    if (!call) { res.status(404).json({ error: 'Call not found' }); return; }
    if (call.incident_type !== 'pso_client_request') {
      res.status(400).json({ error: 'Not a PSO Client Request dispatch' });
      return;
    }
    res.json({
      call,
      scans_remaining: row.admin_override ? null : Math.max(0, row.max_scans - row.scans_used),
      admin_override: !!row.admin_override,
    });
  } catch (err) {
    logger.error({ err }, 'mobile challenge failed');
    res.status(500).json({ error: 'Challenge failed' });
  }
});

// ─── POST /api/mobile/cfs/:id/auth ──────────────────────────
// Body: { token, user_id }. Verifies user is active, increments scans_used
// (unless admin_override), issues scoped JWT (30d).
router.post('/mobile/cfs/:id/auth', (req: Request, res: Response) => {
  try {
    const callId = parseInt(String(req.params.id), 10);
    const { token, user_id } = req.body || {};
    const userIdNum = parseInt(String(user_id), 10);
    if (!callId || !token || !userIdNum) { res.status(400).json({ error: 'Missing call id, token, or user_id' }); return; }
    const db = getDb();
    const row = db.prepare(`
      SELECT id, call_id, scans_used, max_scans, admin_override, revoked_at
      FROM pso_qr_tokens WHERE token = ? AND call_id = ?
    `).get(token, callId) as any;
    if (!row) { res.status(404).json({ error: 'Unknown QR token' }); return; }
    if (row.revoked_at) { res.status(403).json({ error: 'QR token has been revoked' }); return; }
    if (!row.admin_override && row.scans_used >= row.max_scans) {
      res.status(403).json({ error: 'QR scan limit reached' }); return;
    }
    // Officers enter their badge_number (e.g. 1572); fall back to users.id or employee_id.
    const badgeStr = String(userIdNum);
    const user = db.prepare(`
      SELECT id, username, role, full_name, status, badge_number
      FROM users
      WHERE badge_number = ? OR employee_id = ? OR id = ?
      LIMIT 1
    `).get(badgeStr, badgeStr, userIdNum) as any;
    if (!user) { res.status(404).json({ error: 'User ID not recognized' }); return; }
    if (user.status && user.status !== 'active') { res.status(403).json({ error: `User is ${user.status}` }); return; }
    // Increment scan count (unless admin override)
    if (!row.admin_override) {
      db.prepare(`
        UPDATE pso_qr_tokens
        SET scans_used = scans_used + 1, last_scanned_at = datetime('now','localtime'), last_scanned_by = ?
        WHERE id = ?
      `).run(userIdNum, row.id);
    } else {
      db.prepare(`
        UPDATE pso_qr_tokens
        SET last_scanned_at = datetime('now','localtime'), last_scanned_by = ?
        WHERE id = ?
      `).run(userIdNum, row.id);
    }
    const scopedToken = jwt.sign(
      {
        userId: user.id,
        username: user.username,
        role: user.role,
        scope: 'pso-mobile',
        callId,
      },
      config.jwt.secret,
      { algorithm: 'HS256', expiresIn: '30d' }
    );
    auditLog(req, 'MOBILE_AUTH', 'pso_qr_tokens', callId, null, { user_id: userIdNum });
    res.json({
      token: scopedToken,
      user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role },
      call_id: callId,
      scans_remaining: row.admin_override ? null : Math.max(0, row.max_scans - (row.scans_used + 1)),
    });
  } catch (err) {
    logger.error({ err }, 'mobile auth failed');
    res.status(500).json({ error: 'Auth failed' });
  }
});

// ─── POST /api/mobile/cfs/:id/status ────────────────────────
router.post('/mobile/cfs/:id/status', authenticateMobile, (req: Request, res: Response) => {
  try {
    const callId = req.mobileAuth!.callId;
    const { status } = req.body || {};
    const allowed = new Set(['dispatched', 'enroute', 'onscene', 'cleared', 'closed']);
    if (!allowed.has(status)) { res.status(400).json({ error: 'Invalid status' }); return; }
    const db = getDb();
    const stampCol: Record<string, string> = {
      dispatched: 'dispatched_at',
      enroute: 'enroute_at',
      onscene: 'onscene_at',
      cleared: 'cleared_at',
      closed: 'closed_at',
    };
    const col = stampCol[status];
    db.prepare(`
      UPDATE calls_for_service
      SET status = ?, ${col} = COALESCE(${col}, datetime('now','localtime')), updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(status, callId);
    const updated = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(callId);
    auditLog(req, 'UPDATE', 'calls_for_service', callId, null, { status, source: 'pso-mobile', user_id: req.mobileAuth!.userId });
    broadcastDispatchUpdate({ action: 'call_updated', call: updated });
    res.json({ success: true, call: updated });
  } catch (err) {
    logger.error({ err }, 'mobile status update failed');
    res.status(500).json({ error: 'Status update failed' });
  }
});

// ─── POST /api/mobile/cfs/:id/narrative ─────────────────────
router.post('/mobile/cfs/:id/narrative', authenticateMobile, (req: Request, res: Response) => {
  try {
    const callId = req.mobileAuth!.callId;
    const { content } = req.body || {};
    if (!content || !String(content).trim()) { res.status(400).json({ error: 'Narrative cannot be empty' }); return; }
    const db = getDb();
    // Append into notes as a new timestamped line (no dedicated notes table for calls).
    const existing = db.prepare('SELECT notes FROM calls_for_service WHERE id = ?').get(callId) as any;
    const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const authorTag = `[PSO MOBILE / ${req.mobileAuth!.username}]`;
    const line = `\n${stamp} ${authorTag}\n${String(content).trim()}`;
    const newNotes = (existing?.notes || '') + line;
    db.prepare('UPDATE calls_for_service SET notes = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?').run(newNotes, callId);
    const updated = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(callId);
    auditLog(req, 'UPDATE', 'calls_for_service', callId, null, { field: 'notes', source: 'pso-mobile', user_id: req.mobileAuth!.userId });
    broadcastDispatchUpdate({ action: 'call_updated', call: updated });
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, 'mobile narrative failed');
    res.status(500).json({ error: 'Narrative update failed' });
  }
});

// ─── POST /api/mobile/cfs/:id/pso ───────────────────────────
// PSO-specific field edits (attempt number, result, served_at, attempted_to,
// service_address). All fields optional — only the ones present are updated.
router.post('/mobile/cfs/:id/pso', authenticateMobile, (req: Request, res: Response) => {
  try {
    const callId = req.mobileAuth!.callId;
    const allowedFields: Array<[string, string]> = [
      ['pso_attempt_number', 'pso_attempt_number'],
      ['pso_result', 'process_service_result'],
      ['process_served_to', 'process_served_to'],
      ['process_served_at', 'process_served_at'],
      ['process_service_address', 'process_served_address'],
      // process_service_notes intentionally NOT mapped here: there's no dedicated
      // column, and overwriting `notes` would clobber the narrative log. The
      // mobile UI routes PSO notes through the Add-Narrative endpoint instead.
    ];
    const sets: string[] = [];
    const vals: any[] = [];
    for (const [key, col] of allowedFields) {
      if (req.body && Object.prototype.hasOwnProperty.call(req.body, key)) {
        sets.push(`${col} = ?`);
        vals.push(req.body[key] ?? null);
      }
    }
    if (sets.length === 0) { res.status(400).json({ error: 'No updatable fields provided' }); return; }
    sets.push('updated_at = datetime(\'now\',\'localtime\')');
    const db = getDb();
    db.prepare(`UPDATE calls_for_service SET ${sets.join(', ')} WHERE id = ?`).run(...vals, callId);
    const updated = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(callId);
    auditLog(req, 'UPDATE', 'calls_for_service', callId, null, { fields: sets, source: 'pso-mobile', user_id: req.mobileAuth!.userId });
    broadcastDispatchUpdate({ action: 'call_updated', call: updated });
    res.json({ success: true, call: updated });
  } catch (err) {
    logger.error({ err }, 'mobile pso edit failed');
    res.status(500).json({ error: 'PSO edit failed' });
  }
});

// ─── POST /api/cfs/:id/qr/override ──────────────────────────
// Admin-only: enable admin_override (unlimited scans) or reset scans_used.
router.post('/cfs/:id/qr/override', authenticateToken, requireRole('admin'), (req: Request, res: Response) => {
  try {
    const callId = parseInt(String(req.params.id), 10);
    const { action } = req.body || {};
    const db = getDb();
    const tok = db.prepare('SELECT id FROM pso_qr_tokens WHERE call_id = ? ORDER BY id DESC LIMIT 1').get(callId) as any;
    if (!tok) { res.status(404).json({ error: 'No QR token for this call' }); return; }
    if (action === 'reset') {
      db.prepare('UPDATE pso_qr_tokens SET scans_used = 0 WHERE id = ?').run(tok.id);
    } else if (action === 'override') {
      db.prepare('UPDATE pso_qr_tokens SET admin_override = 1 WHERE id = ?').run(tok.id);
    } else if (action === 'revoke') {
      db.prepare('UPDATE pso_qr_tokens SET revoked_at = datetime(\'now\',\'localtime\') WHERE id = ?').run(tok.id);
    } else {
      res.status(400).json({ error: 'action must be reset | override | revoke' }); return;
    }
    auditLog(req, 'UPDATE', 'pso_qr_tokens', tok.id, null, { action, call_id: callId });
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, 'qr override failed');
    res.status(500).json({ error: 'Override failed' });
  }
});

export default router;
