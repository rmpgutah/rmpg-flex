// ============================================================
// RMPG Flex — IPED (Cloudflare Worker)
// ============================================================
// Read-only surface over the forensic_hash_sets + forensic_hash_entries
// + iped_imports tables. Replaces the proxy stubs that PR #667 used
// to short-circuit /api/iped/{status,hash-sets} while there was no
// rewrite handler.
//
// "IPED" = Indexador e Processador de Evidências Digitais — the open
// source forensic analyzer the lab uses for disk/phone images. Hash
// sets feed IPED's known-file lookup (NSRL for benign system files,
// ProjectVic for CSAM hashes, custom for case-specific known-bad).
// `iped_imports` records each time the legacy worker pulled in results
// from an IPED case (findings, timeline, bookmarks, items).
//
// Out of scope:
//   - Initiating new IPED runs (the analyzer is offline-only)
//   - Streaming hash material to clients (large; detail endpoint
//     caps at 100 entries)
//   - The actual IPED API integration; we only report whether
//     IPED_API_KEY is bound, not whether the service is reachable.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst } from '../utils/db';

// IPED_API_KEY is optional and only consulted by /status to report
// "configured". Declared here (not in src/types.ts) because no other
// route in the rewrite touches it — keeps the shared Bindings type lean.
type IpedEnv = {
  Bindings: Env['Bindings'] & { IPED_API_KEY?: string };
  Variables: Env['Variables'];
};

const iped = new Hono<IpedEnv>();

// GET /status — dashboard polls on mount.
// `configured` is purely "is the binding present?" — the Worker has no
// cheap way to verify the IPED endpoint is alive at request time, and
// pinging it from every status poll would defeat the point.
iped.get('/status', async (c) => {
  try {
    const db = getDb(c.env);
    const last = await queryFirst<{ last_sync: string | null }>(
      db, `SELECT MAX(updated_at) AS last_sync FROM forensic_hash_sets`,
    );
    return c.json({
      configured: !!c.env.IPED_API_KEY,
      last_sync: last?.last_sync ?? null,
    });
  } catch (err) {
    return c.json({
      error: 'Failed to get IPED status',
      code: 'STATUS_ERROR',
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// GET /hash-sets — list of loaded hash sets. Cap at 100 (NSRL +
// ProjectVic + lab-custom is on the order of a dozen entries; a 100
// cap is purely a defensive upper bound). Returns a bare array to
// match the prior stub contract (`[]`) — callers already iterate the
// response directly without a wrapper key.
iped.get('/hash-sets', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT hs.id, hs.name, hs.set_type, hs.description, hs.hash_count,
              hs.source_file, hs.version, hs.imported_by_name,
              hs.created_at, hs.updated_at
         FROM forensic_hash_sets hs
         ORDER BY hs.updated_at DESC, hs.id DESC
         LIMIT 100`,
    );
    return c.json(rows);
  } catch (err) {
    return c.json({
      error: 'Failed to list hash sets',
      code: 'HASH_SETS_LIST_ERROR',
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// GET /hash-sets/:id — detail + first 100 hash entries.
// Hash material is intentionally only on the detail endpoint; never
// on the list. Even at 100 rows the SHA-256 column alone can be 6 KB.
iped.get('/hash-sets/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);

    const set = await queryFirst<Record<string, unknown>>(
      db, `SELECT * FROM forensic_hash_sets WHERE id = ?`, id,
    );
    if (!set) return c.json({ error: 'Hash set not found', code: 'NOT_FOUND' }, 404);

    const entries = await query<Record<string, unknown>>(
      db,
      `SELECT id, hash_value, hash_type, file_name, file_size, category
         FROM forensic_hash_entries
        WHERE hash_set_id = ?
        ORDER BY id
        LIMIT 100`,
      id,
    );
    return c.json({
      data: { ...set, entries, entries_truncated: (set.hash_count as number) > entries.length },
    });
  } catch (err) {
    return c.json({
      error: 'Failed to get hash set',
      code: 'HASH_SET_GET_ERROR',
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// GET /downloads — IPED import history. Name retained for client
// compatibility (the legacy endpoint is `/api/iped/downloads`); the
// underlying table is `iped_imports` since each row represents data
// pulled from IPED into D1, not a binary download.
iped.get('/downloads', async (c) => {
  try {
    const db = getDb(c.env);
    const q = c.req.query.bind(c.req);
    const limit = Math.min(200, Math.max(1, parseInt(q('limit') || '50', 10) || 50));

    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT ii.id, ii.forensic_case_id, ii.import_type, ii.iped_case_id,
              ii.iped_case_name, ii.source_query, ii.item_count, ii.summary,
              ii.imported_by, ii.imported_by_name, ii.created_at,
              fc.lab_number
         FROM iped_imports ii
         LEFT JOIN forensic_cases fc ON ii.forensic_case_id = fc.id
         ORDER BY ii.created_at DESC, ii.id DESC
         LIMIT ?`,
      limit,
    );
    return c.json({ data: rows });
  } catch (err) {
    return c.json({
      error: 'Failed to list IPED imports',
      code: 'DOWNLOADS_LIST_ERROR',
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

export default iped;
