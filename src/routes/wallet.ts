// ============================================================
// RMPG Flex — Officer Wallet ID (digital badge / ID pass)
// ------------------------------------------------------------
// An internal, QR-verifiable digital officer ID. Each officer gets one
// credential (wallet_credentials.wallet_id, lazily issued on first view). The
// "My ID" page shows their badge + a rotating QR (a short-lived signed token —
// src/utils/walletToken.ts). An authenticated RMPG user scans it on the verify
// page; POST /verify validates the token signature + expiry, then checks LIVE
// status (credential active AND officer active — src/utils/walletValidity.ts) so
// revoking a credential or deactivating an officer instantly invalidates the
// badge. No external wallet/cert dependencies. Spec:
// docs/superpowers/specs/2026-06-12-officer-wallet-id-design.md
//
// Mounted at /api/wallet (auth required). The proxy must route /api/wallet to
// env.API (rewrite) — a rule was added to proxy API_ROUTES; without it a new
// rewrite route falls through to legacy and 404s.
// ============================================================
import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { signWalletToken, verifyWalletToken } from '../utils/walletToken';
import { walletValidity } from '../utils/walletValidity';
import { recordAudit } from '../utils/auditLog';

const wallet = new Hono<Env>();

const ADMIN_ROLES = ['admin', 'manager'] as const;

interface CredentialRow {
  wallet_id: string;
  user_id: number;
  status: string;
  issued_at: string;
  revoked_at: string | null;
}

// The officer fields shown on the badge / returned by verify. profile_image is
// the uploaded base64 photo (preferred); avatar_url is the fallback.
const OFFICER_SELECT =
  'id, full_name, badge_number, rank, department, employee_id, status, hire_date, avatar_url, profile_image';

function badgeFromOfficer(o: any) {
  return {
    user_id: o.id,
    full_name: o.full_name,
    badge_number: o.badge_number ?? null,
    rank: o.rank ?? null,
    department: o.department ?? null,
    employee_id: o.employee_id ?? null,
    hire_date: o.hire_date ?? null,
    photo: o.profile_image || o.avatar_url || null,
    officer_status: o.status,
  };
}

// Return this officer's credential, issuing one on first use.
async function getOrCreateCredential(db: any, userId: number): Promise<CredentialRow> {
  const existing = await queryFirst<CredentialRow>(
    db, 'SELECT wallet_id, user_id, status, issued_at, revoked_at FROM wallet_credentials WHERE user_id = ?', userId,
  );
  if (existing) return existing;
  const walletId = crypto.randomUUID();
  // user_id is UNIQUE. On an officer's first wallet view two concurrent requests
  // (two tabs / a fast double-load) both pass the `existing` check; without
  // ON CONFLICT the race loser's INSERT throws a UNIQUE violation that 500s the
  // My-ID page. DO NOTHING + re-read makes issuance idempotent.
  await execute(
    db,
    `INSERT INTO wallet_credentials (wallet_id, user_id, status) VALUES (?, ?, 'active')
     ON CONFLICT(user_id) DO NOTHING`,
    walletId, userId,
  );
  const row = await queryFirst<CredentialRow>(
    db, 'SELECT wallet_id, user_id, status, issued_at, revoked_at FROM wallet_credentials WHERE user_id = ?', userId,
  );
  if (!row) throw new Error('wallet credential issuance failed');
  return row;
}

async function auditCredential(c: any, actorUserId: number, action: string, walletId: string, details: unknown): Promise<void> {
  await recordAudit(c, { action, entityType: 'officer_credential', entityId: walletId, details: JSON.stringify(details ?? {}), actorId: actorUserId });
}

// GET /api/wallet/me — my badge + wallet_id + a fresh rotating QR token.
wallet.get('/me', async (c) => {
  const db = getDb(c.env);
  const userId = c.get('userId') as number | undefined;
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const cred = await getOrCreateCredential(db, userId);
  const officer = await queryFirst<any>(db, `SELECT ${OFFICER_SELECT} FROM users WHERE id = ?`, userId);
  if (!officer) return c.json({ error: 'Officer not found' }, 404);
  const token = await signWalletToken(cred.wallet_id, c.env.JWT_SECRET);
  return c.json({
    wallet_id: cred.wallet_id,
    credential_status: cred.status,
    qr_token: token,
    badge: badgeFromOfficer(officer),
  });
});

// GET /api/wallet/qr-token — just a fresh rotating token (the My-ID page polls
// this every ~30s). Issues a credential if somehow absent.
wallet.get('/qr-token', async (c) => {
  const db = getDb(c.env);
  const userId = c.get('userId') as number | undefined;
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const cred = await getOrCreateCredential(db, userId);
  const token = await signWalletToken(cred.wallet_id, c.env.JWT_SECRET);
  return c.json({ qr_token: token });
});

// POST /api/wallet/verify — authenticated scan. Body { token }. Stable shape:
// { valid, reason, officer? } so the scanner renders cleanly for every outcome.
wallet.post('/verify', async (c) => {
  const body = await c.req.json<{ token?: string }>().catch(() => ({} as { token?: string }));
  const token = body.token;
  if (!token) return c.json({ valid: false, reason: 'missing_token' });

  const parsed = await verifyWalletToken(token, c.env.JWT_SECRET);
  if (!parsed.valid) return c.json({ valid: false, reason: parsed.reason });

  const db = getDb(c.env);
  const row = await queryFirst<any>(
    db,
    `SELECT cr.status AS cred_status, ${OFFICER_SELECT.split(', ').map((f) => 'u.' + f).join(', ')}
       FROM wallet_credentials cr JOIN users u ON u.id = cr.user_id
      WHERE cr.wallet_id = ?`,
    parsed.walletId,
  );
  if (!row) return c.json({ valid: false, reason: 'not_found' });

  const v = walletValidity(row.cred_status, row.status);
  return c.json({ valid: v.valid, reason: v.reason, officer: badgeFromOfficer(row) });
});

// GET /api/wallet/admin/list — roster of issued credentials + status.
wallet.get('/admin/list', requireRole(...ADMIN_ROLES), async (c) => {
  const db = getDb(c.env);
  const rows = await query<any>(
    db,
    `SELECT cr.wallet_id, cr.status, cr.issued_at, cr.revoked_at, cr.revoked_by,
            u.id AS user_id, u.full_name, u.badge_number, u.rank, u.department, u.status AS officer_status
       FROM wallet_credentials cr JOIN users u ON u.id = cr.user_id
      ORDER BY u.full_name`,
  );
  return c.json({ credentials: rows });
});

// POST /api/wallet/:walletId/revoke — admin/manager, audited.
wallet.post('/:walletId/revoke', requireRole(...ADMIN_ROLES), async (c) => {
  const db = getDb(c.env);
  const walletId = c.req.param('walletId');
  if (!walletId) return c.json({ error: 'wallet_id required' }, 400);
  const actor = c.get('userId') as number | undefined;
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);
  const cred = await queryFirst<CredentialRow>(db, 'SELECT wallet_id, user_id, status, issued_at, revoked_at FROM wallet_credentials WHERE wallet_id = ?', walletId);
  if (!cred) return c.json({ error: 'Credential not found' }, 404);
  await execute(
    db, `UPDATE wallet_credentials SET status = 'revoked', revoked_at = datetime('now'), revoked_by = ? WHERE wallet_id = ?`, actor, walletId,
  );
  await auditCredential(c, actor, 'wallet_revoke', walletId, { user_id: cred.user_id });
  return c.json({ wallet_id: walletId, status: 'revoked' });
});

// POST /api/wallet/:walletId/reinstate — admin/manager, audited.
wallet.post('/:walletId/reinstate', requireRole(...ADMIN_ROLES), async (c) => {
  const db = getDb(c.env);
  const walletId = c.req.param('walletId');
  if (!walletId) return c.json({ error: 'wallet_id required' }, 400);
  const actor = c.get('userId') as number | undefined;
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);
  const cred = await queryFirst<CredentialRow>(db, 'SELECT wallet_id, user_id, status, issued_at, revoked_at FROM wallet_credentials WHERE wallet_id = ?', walletId);
  if (!cred) return c.json({ error: 'Credential not found' }, 404);
  await execute(
    db, `UPDATE wallet_credentials SET status = 'active', revoked_at = NULL, revoked_by = NULL WHERE wallet_id = ?`, walletId,
  );
  await auditCredential(c, actor, 'wallet_reinstate', walletId, { user_id: cred.user_id });
  return c.json({ wallet_id: walletId, status: 'active' });
});

export default wallet;
