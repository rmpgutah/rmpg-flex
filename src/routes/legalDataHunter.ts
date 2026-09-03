// ============================================================
// RMPG Flex — Legal Data Hunter integration routes
// ============================================================
// Mounted at /api/legal-data-hunter (auth: 'required'). Manual,
// officer-initiated charge validation only — never called from
// warrant ingest/create/update. See
// docs/superpowers/specs/2026-07-17-legal-data-hunter-integration-design.md
//
//   POST /validate   Any authed user except client_viewer. Resolves a
//                     warrant charge string against (in order): the local
//                     utah_statutes table, the legal_charge_validations
//                     cache, then the live Legal Data Hunter API.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, queryFirst, execute } from '../utils/db';
import { configFromEnv, resolveCitation, searchLegislation } from '../utils/legalDataHunter/client';
import { LdhConfigError, LdhError } from '../utils/legalDataHunter/errors';
import { checkAndReserveLdhCall, getLdhUsageToday } from '../utils/legalDataHunter/rateLimit';
import { requireRole } from '../middleware/auth';
import { dbErrorResponse } from '../utils/dbErrors';
import { containsClause, containedByClause } from '../utils/searchText';
import { log } from '../utils/logger';

// LDH hybrid search score below which a hit is not considered a confident match.
const LDH_SEARCH_MATCH_THRESHOLD = 0.6;

const legalDataHunter = new Hono<Env>();

legalDataHunter.use('*', async (c, next) => {
  const user = c.get('user') as { role: string } | undefined;
  if (user?.role === 'client_viewer') return c.json({ error: 'Forbidden' }, 403);
  await next();
});

function normalizeCharge(charge: string): string {
  return charge.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** A charge string that looks like it already embeds a citation
 *  (e.g. "Theft (76-6-404)" or "Utah Code 76-6-404") gets tried
 *  against /v1/resolve first — it's a cheaper, more precise match
 *  than a fuzzy /v1/search. */
function extractCitationLike(charge: string): string | null {
  const match = charge.match(/\b\d{1,4}[A-Za-z]?[-.]\d{1,4}(?:[-.]\d{1,4})?\b/);
  return match ? match[0] : null;
}

async function tryLocalStatute(db: ReturnType<typeof getDb>, charge: string, state?: string) {
  if (state && state.toUpperCase() !== 'UT' && state.toUpperCase() !== 'UTAH') return null;
  const q = charge.trim();
  if (q.length < 3) return null;
  // Real charge text (e.g. "THEFT BY RECEIVING STOLEN PROPERTY - 3RD DEGREE
  // FELONY") is long/formatted while utah_statutes.short_title rows are short
  // ("Theft, generally") — so a naive "does short_title contain the whole
  // charge" query almost never matches. Flip the direction too: does the
  // charge text CONTAIN the statute's short_title? SQLite supports string
  // concatenation with `||`, so we can express both directions in one query
  // (same pattern used by statutes.ts's `/search` endpoint's LIKE matching).
  // Uses instr() rather than LIKE: D1 caps LIKE patterns at 50 chars, and real
  // charge text routinely exceeds that, which made this endpoint return 500 on
  // ordinary input (11 recorded failures). See containsClause in searchText.ts.
  // The third condition is the reverse direction and was doubly affected — its
  // pattern was built from short_title, so long rows broke every caller.
  const title = containsClause('short_title');
  const desc = containsClause('description');
  const reverse = containedByClause('short_title');
  const row = await queryFirst<{ citation: string; short_title: string; source_url: string | null }>(
    db,
    `SELECT citation, short_title, source_url FROM utah_statutes
     WHERE is_active = 1
       AND (
         ${title.sql} OR ${desc.sql}
         OR (LENGTH(short_title) >= 4 AND ${reverse.sql})
       )
     ORDER BY LENGTH(short_title) DESC LIMIT 1`,
    title.bind(q), desc.bind(q), reverse.bind(q),
  );
  return row;
}

legalDataHunter.post('/validate', async (c) => {
  let payload: { charge?: string; state?: string; warrant_id?: number };
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ ok: false, code: 'bad_request', error: 'Invalid JSON body' }, 400);
  }
  const charge = (payload.charge || '').trim();
  if (!charge) {
    return c.json({ ok: false, code: 'bad_request', error: 'charge is required' }, 400);
  }
  const state = payload.state?.trim() || undefined;
  const warrantId = typeof payload.warrant_id === 'number' ? payload.warrant_id : undefined;
  const db = getDb(c.env);
  const normalized = normalizeCharge(charge);

  try {
    // 1. Local statute short-circuit (free, Utah-only).
    const local = await tryLocalStatute(db, charge, state);
    if (local) {
      await execute(db,
        `INSERT INTO legal_charge_validations
           (charge_text, charge_text_normalized, state, warrant_id, source, match_found, matched_title, matched_citation, matched_source_url, raw_response)
         VALUES (?, ?, ?, ?, 'local_statute', 1, ?, ?, ?, ?)
         ON CONFLICT(charge_text_normalized, state) DO UPDATE SET
           warrant_id = excluded.warrant_id, source = excluded.source, match_found = excluded.match_found,
           matched_title = excluded.matched_title, matched_citation = excluded.matched_citation,
           matched_source_url = excluded.matched_source_url, raw_response = excluded.raw_response`,
        charge, normalized, state ?? null, warrantId ?? null,
        local.short_title, local.citation, local.source_url ?? null, JSON.stringify(local),
      );
      return c.json({
        ok: true, source: 'local_statute', match_found: true,
        matched_title: local.short_title, matched_citation: local.citation, matched_source_url: local.source_url,
      });
    }

    // 2. Cache lookup.
    const cached = await queryFirst<{
      source: string; match_found: number; matched_title: string | null;
      matched_citation: string | null; matched_source_url: string | null;
    }>(db,
      `SELECT source, match_found, matched_title, matched_citation, matched_source_url
       FROM legal_charge_validations WHERE charge_text_normalized = ? AND (state IS ? OR state = ?)`,
      normalized, state ?? null, state ?? '',
    );
    if (cached) {
      if (warrantId) {
        await execute(db,
          `UPDATE legal_charge_validations SET warrant_id = ? WHERE charge_text_normalized = ? AND (state IS ? OR state = ?)`,
          warrantId, normalized, state ?? null, state ?? '',
        );
      }
      return c.json({
        ok: true, source: 'cache', match_found: !!cached.match_found,
        matched_title: cached.matched_title, matched_citation: cached.matched_citation, matched_source_url: cached.matched_source_url,
      });
    }

    // 3. Live Legal Data Hunter call, under the rate budget.
    let config;
    try {
      config = configFromEnv(c.env as unknown as Record<string, unknown>);
    } catch (err) {
      if (err instanceof LdhConfigError) return c.json({ ok: false, code: 'not_configured' });
      throw err;
    }

    // Every live LDH call (resolve or search) must pass the self-imposed
    // budget first (8/min, 18/day) — LDH's own limits are 10/min, 20/day,
    // and this route is the only live caller.
    const budget = await checkAndReserveLdhCall(c.env.KV, Date.now());
    if (!budget.allowed) {
      return c.json({ ok: false, code: 'rate_limited', reason: budget.reason });
    }

    const countryHint = state ? 'US' : undefined;
    const citationLike = extractCitationLike(charge);
    let source: 'ldh_resolve' | 'ldh_search';
    let matchFound = false;
    let matchedTitle: string | null = null;
    let matchedCitation: string | null = null;
    let matchedUrl: string | null = null;
    let raw: unknown;

    if (citationLike) {
      source = 'ldh_resolve';
      const resolved = await resolveCitation({ config, reference: citationLike, hintCountry: countryHint, hintType: 'legislation' });
      raw = resolved;
      const doc = resolved.documents[0];
      if (resolved.resolved && doc) {
        matchFound = true;
        matchedTitle = doc.title;
        matchedCitation = doc.source_id;
      }
    } else {
      source = 'ldh_search';
      const searched = await searchLegislation({ config, query: charge, country: countryHint ? [countryHint] : undefined, topK: 3 });
      raw = searched;
      const hit = searched.hits[0];
      if (hit && hit.score >= LDH_SEARCH_MATCH_THRESHOLD) {
        matchFound = true;
        matchedTitle = hit.title;
        matchedCitation = hit.source_id;
        matchedUrl = hit.url ?? null;
      }
    }

    await execute(db,
      `INSERT INTO legal_charge_validations
         (charge_text, charge_text_normalized, state, warrant_id, source, match_found, matched_title, matched_citation, matched_source_url, raw_response)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(charge_text_normalized, state) DO UPDATE SET
         warrant_id = excluded.warrant_id, source = excluded.source, match_found = excluded.match_found,
         matched_title = excluded.matched_title, matched_citation = excluded.matched_citation,
         matched_source_url = excluded.matched_source_url, raw_response = excluded.raw_response`,
      charge, normalized, state ?? null, warrantId ?? null,
      source, matchFound ? 1 : 0, matchedTitle, matchedCitation, matchedUrl, JSON.stringify(raw),
    );

    return c.json({ ok: true, source, match_found: matchFound, matched_title: matchedTitle, matched_citation: matchedCitation, matched_source_url: matchedUrl });
  } catch (err) {
    if (err instanceof LdhError) {
      log.warn('Legal Data Hunter call failed', { name: err.name, message: err.message });
      return c.json({ ok: false, code: 'upstream_error', error: err.message }, 502);
    }
    return dbErrorResponse(c, err, 'Failed to validate charge against Legal Data Hunter');
  }
});

/** Today's live-call count against the self-imposed budget. Admin/manager
 *  only — it's an ops/quota view, not officer-facing. Reads the same KV
 *  counters checkAndReserveLdhCall writes. */
legalDataHunter.get('/usage', requireRole('admin', 'manager'), async (c) => {
  const usage = await getLdhUsageToday(c.env.KV, Date.now());
  return c.json({ ok: true, ...usage });
});

export default legalDataHunter;
