// ============================================================
// Subject search route (Task 1.17)
// Unified person + business typeahead for the dispatcher / IR
// Subject picker. Returns a discriminated-union array sorted by
// a relevance score (warrants/SO/exact-match boost the rank).
// ============================================================

import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken } from '../middleware/auth';
import { paramStr } from '../utils/reqHelpers';

const router = Router();
router.use(authenticateToken);

router.get('/search', (req: Request, res: Response) => {
  const q = paramStr(req.query.q as any).trim();
  const typesParam = paramStr(req.query.types as any) || 'person,business';
  const types = new Set(typesParam.split(',').map((t) => t.trim()));
  const limit = Math.min(
    parseInt(paramStr(req.query.limit as any, '20'), 10) || 20,
    50
  );

  if (q.length < 2) { res.json([]); return; }

  const db = getDb();
  const like = `%${q}%`;
  const exact = q;
  const prefix = q.toLowerCase();
  const results: any[] = [];

  if (types.has('person')) {
    try {
      const persons = db.prepare(`
        SELECT p.id, p.first_name, p.last_name, p.dob, p.phone, p.flags, p.dl_number,
               p.is_sex_offender,
               (SELECT COUNT(*) FROM warrants w
                  WHERE w.subject_person_id = p.id AND w.status = 'active') as active_warrant_count
        FROM persons p
        WHERE p.archived_at IS NULL
          AND ((p.first_name || ' ' || p.last_name) LIKE ?
               OR (p.last_name || ', ' || p.first_name) LIKE ?
               OR p.phone = ?
               OR p.dl_number = ?)
        LIMIT ?
      `).all(like, like, exact, exact, limit) as any[];

      for (const p of persons) {
        const flagsStr = String(p.flags || '');
        const isViolent = flagsStr.includes('VIOLENT');
        const badges: any[] = [];
        if (p.active_warrant_count > 0) {
          badges.push({ type: 'warrant', count: p.active_warrant_count, severity: 'critical' });
        }
        if (p.is_sex_offender) {
          badges.push({ type: 'flag', value: 'SEX OFFENDER', severity: 'critical' });
        }
        if (isViolent) {
          badges.push({ type: 'flag', value: 'VIOLENT', severity: 'critical' });
        }

        let score = 50;
        if (p.active_warrant_count > 0) score += 50;
        if (p.is_sex_offender) score += 30;
        if (isViolent) score += 25;
        if ((p.phone && p.phone === exact) || (p.dl_number && p.dl_number === exact)) score += 20;
        if (
          (p.last_name || '').toLowerCase().startsWith(prefix) ||
          (p.first_name || '').toLowerCase().startsWith(prefix)
        ) score += 10;

        results.push({
          type: 'person',
          id: p.id,
          display_name: `${p.last_name || ''}, ${p.first_name || ''}`.toUpperCase(),
          sub_text: `DOB ${p.dob || '?'} \u00b7 ${p.phone || 'no phone'}`,
          badges,
          metadata: { dob: p.dob },
          score,
        });
      }
    } catch (err: any) {
      if (!err?.message?.includes('no such table')) throw err;
    }
  }

  if (types.has('business')) {
    try {
      const businesses = db.prepare(`
        SELECT b.id, b.name, b.dba_name, b.address, b.phone, b.ein,
               (SELECT COUNT(*) FROM call_businesses
                  WHERE business_id = b.id
                    AND created_at > datetime('now','-30 days')) as recent_calls
        FROM businesses b
        WHERE b.archived_at IS NULL
          AND (b.name LIKE ? OR b.dba_name LIKE ? OR b.phone = ? OR b.ein = ? OR b.address LIKE ?)
        LIMIT ?
      `).all(like, like, exact, exact, like, limit) as any[];

      for (const b of businesses) {
        const recentCalls = b.recent_calls || 0;
        const badges: any[] = [];
        if (recentCalls > 5) {
          badges.push({ type: 'incident_count', value: recentCalls, severity: 'warning' });
        }

        let score = 60;
        if ((b.name || '').toLowerCase().startsWith(prefix)) score += 20;
        if ((b.phone && b.phone === exact) || (b.ein && b.ein === exact)) score += 15;
        if (recentCalls > 5) score += 10;

        results.push({
          type: 'business',
          id: b.id,
          display_name: (b.name || '').toUpperCase(),
          sub_text: `${b.address || 'no address'} \u00b7 ${b.phone || 'no phone'}`,
          badges,
          metadata: { dba: b.dba_name, ein: b.ein, recent_calls: recentCalls },
          score,
        });
      }
    } catch (err: any) {
      if (!err?.message?.includes('no such table')) throw err;
    }
  }

  results.sort((a, b) => b.score - a.score || a.display_name.localeCompare(b.display_name));
  res.json(results.slice(0, limit));
});

export default router;
