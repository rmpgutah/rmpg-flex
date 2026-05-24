// ============================================================
// RMPG Flex — Subject search (Cloudflare Worker)
// ============================================================
// Unified person + business typeahead for the dispatcher and IR
// subject picker. Returns a discriminated-union array sorted by
// relevance score — active warrants, sex-offender flag, and
// violent flag boost the rank to the top so officer-safety
// signals never get buried.
//
// Schema notes (live D1 as of 2026-05-24):
//   - persons:  thin schema — `flags TEXT DEFAULT '[]'` is the
//               single bucket for SEX_OFFENDER / VIOLENT / ACTIVE_WARRANT /
//               etc indicators. Closed PR #581 assumed separate
//               columns; we LIKE-match against `flags` instead.
//   - warrants: denormalized (`subject_name`, `subject_dob`),
//               no FK to persons. Active-warrant counting uses a
//               loose name match against subject_name.
//   - businesses: table doesn't exist yet (Phase 2 / PR-E). The
//               business arm is wrapped in try/catch and degrades
//               to `[]` until that PR lands — preserves the legacy
//               response shape today, lights up automatically when
//               the table exists.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query, queryFirst } from '../../utils/db';

const subjects = new Hono<Env>();

interface Badge {
  type: 'warrant' | 'flag' | 'incident_count';
  value?: string | number;
  count?: number;
  severity?: 'critical' | 'warning' | 'info';
}

interface SubjectResult {
  type: 'person' | 'business';
  id: number;
  display_name: string;
  sub_text: string;
  badges: Badge[];
  metadata: Record<string, unknown>;
  score: number;
}

// GET /api/records/subjects/search?q=<term>&types=person,business&limit=20
subjects.get('/search', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  const typesParam = c.req.query('types') || 'person,business';
  const types = new Set(typesParam.split(',').map((t) => t.trim()));
  const limit = Math.min(parseInt(c.req.query('limit') || '20', 10) || 20, 50);

  if (q.length < 2) return c.json([]);

  const db = getDb(c.env);
  const like = `%${q}%`;
  const exact = q;
  const prefix = q.toLowerCase();
  const results: SubjectResult[] = [];

  if (types.has('person')) {
    try {
      const persons = await query<{
        id: number; first_name: string | null; last_name: string | null;
        dob: string | null; phone: string | null; flags: string | null;
      }>(
        db,
        `SELECT id, first_name, last_name, dob, phone, flags
         FROM persons
         WHERE (first_name || ' ' || last_name) LIKE ?
            OR (last_name || ', ' || first_name) LIKE ?
            OR phone = ?
         LIMIT ?`,
        like, like, exact, limit,
      );

      for (const p of persons) {
        const flagsStr = String(p.flags ?? '');
        const isSexOffender = /SEX[_ ]?OFFENDER/i.test(flagsStr);
        const isViolent = /VIOLENT/i.test(flagsStr);
        const hasActiveWarrantFlag = /ACTIVE[_ ]?WARRANT/i.test(flagsStr);

        // Loose join — live warrants table is denormalized (subject_name).
        // The shape of subject_name is "first last" or sometimes "last, first";
        // we check both. If the schema diverges (e.g. early-migration D1
        // without the table) the try/catch degrades to 0.
        let activeWarrantCount = 0;
        try {
          const fullName = `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim();
          const lastFirst = `${p.last_name ?? ''}, ${p.first_name ?? ''}`.trim();
          if (fullName) {
            const row = await queryFirst<{ count: number }>(
              db,
              `SELECT COUNT(*) as count FROM warrants
               WHERE status = 'active'
                 AND (LOWER(subject_name) = LOWER(?) OR LOWER(subject_name) = LOWER(?))`,
              fullName, lastFirst,
            );
            activeWarrantCount = row?.count ?? 0;
          }
        } catch (err: unknown) {
          // Warrants table absent or column shape differs — degrade silently.
          // Reading the message gracefully tolerates either Error or unknown.
          if (!(err instanceof Error) || !err.message?.includes('no such table')) {
            // Genuinely unexpected — still don't fail the whole search.
          }
        }

        const badges: Badge[] = [];
        if (activeWarrantCount > 0) badges.push({ type: 'warrant', count: activeWarrantCount, severity: 'critical' });
        if (isSexOffender) badges.push({ type: 'flag', value: 'SEX OFFENDER', severity: 'critical' });
        if (isViolent) badges.push({ type: 'flag', value: 'VIOLENT', severity: 'critical' });
        if (hasActiveWarrantFlag && activeWarrantCount === 0) {
          // Flag says warrant exists but the warrants table didn't echo it —
          // surface the flag anyway so the dispatcher sees the indicator.
          badges.push({ type: 'flag', value: 'WARRANT (flag)', severity: 'critical' });
        }

        let score = 50;
        if (activeWarrantCount > 0) score += 50;
        if (isSexOffender) score += 30;
        if (isViolent) score += 25;
        if (p.phone && p.phone === exact) score += 20;
        if (
          (p.last_name ?? '').toLowerCase().startsWith(prefix) ||
          (p.first_name ?? '').toLowerCase().startsWith(prefix)
        ) score += 10;

        results.push({
          type: 'person',
          id: p.id,
          display_name: `${p.last_name ?? ''}, ${p.first_name ?? ''}`.toUpperCase(),
          sub_text: `DOB ${p.dob ?? '?'} · ${p.phone ?? 'no phone'}`,
          badges,
          metadata: { dob: p.dob },
          score,
        });
      }
    } catch (err) {
      // Person search failure shouldn't kill the whole endpoint.
      // Log to console for debugging but return what we have.
      console.error('[subjects.search] persons query failed:', err);
    }
  }

  if (types.has('business')) {
    // businesses table is Phase 2 / PR-E — not in live D1 yet. Defensive
    // try/catch lets this arm light up automatically once the table lands
    // without needing to re-touch this file.
    try {
      const businesses = await query<{
        id: number; name: string | null; dba_name: string | null;
        address: string | null; phone: string | null; ein: string | null;
        recent_calls: number | null;
      }>(
        db,
        `SELECT b.id, b.name, b.dba_name, b.address, b.phone, b.ein,
                (SELECT COUNT(*) FROM call_businesses
                   WHERE business_id = b.id
                     AND created_at > datetime('now','-30 days')) as recent_calls
         FROM businesses b
         WHERE b.name LIKE ? OR b.dba_name LIKE ? OR b.phone = ? OR b.ein = ? OR b.address LIKE ?
         LIMIT ?`,
        like, like, exact, exact, like, limit,
      );

      for (const b of businesses) {
        const recentCalls = b.recent_calls ?? 0;
        const badges: Badge[] = [];
        if (recentCalls > 5) badges.push({ type: 'incident_count', value: recentCalls, severity: 'warning' });

        let score = 60;
        if ((b.name ?? '').toLowerCase().startsWith(prefix)) score += 20;
        if ((b.phone && b.phone === exact) || (b.ein && b.ein === exact)) score += 15;
        if (recentCalls > 5) score += 10;

        results.push({
          type: 'business',
          id: b.id,
          display_name: (b.name ?? '').toUpperCase(),
          sub_text: `${b.address ?? 'no address'} · ${b.phone ?? 'no phone'}`,
          badges,
          metadata: { dba: b.dba_name, ein: b.ein, recent_calls: recentCalls },
          score,
        });
      }
    } catch (err: unknown) {
      // Expected until PR-E lands. Don't log on the common "no such table"
      // case so the worker tail stays clean.
      if (err instanceof Error && !err.message?.includes('no such table')) {
        console.error('[subjects.search] businesses query failed:', err);
      }
    }
  }

  results.sort((a, b) => b.score - a.score || a.display_name.localeCompare(b.display_name));
  return c.json(results.slice(0, limit));
});

export default subjects;
