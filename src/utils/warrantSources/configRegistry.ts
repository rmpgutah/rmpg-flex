import type { D1Database } from '@cloudflare/workers-types';
import type { WarrantSourceAdapter, RawWarrantHit, SourceKind, WarrantCategory, ChunkResult } from './types';
import { query } from '../db';
import { parseSocrata, type FieldMap } from './parse/socrata';
import { parseArcgis } from './parse/arcgis';
import { buildArcgisKeysetUrl, buildSocrataOffsetUrl, maxObjectId, arcgisHasMore, ARCGIS_SERVER_PAGE, CHUNK_TARGET } from './paging';

interface SourceRow {
  source_key: string; family: string; display_name: string; state: string | null;
  jurisdiction: string | null; base_url: string | null; resource_id: string | null;
  field_map: string | null; mode: string; format: string; kind: string;
  enabled: number; priority: number;
}

function safeMap(json: string | null): FieldMap { try { return json ? JSON.parse(json) : {}; } catch { return {}; } }

/** Build a full-list adapter from a config row for a config-driven family. Returns null for families not handled here (pdf/p2c land in later PRs). */
function makeAdapter(row: SourceRow): WarrantSourceAdapter | null {
  const map = safeMap(row.field_map);
  const meta = {
    key: row.source_key, display_name: row.display_name, state: row.state ?? 'US',
    county: row.jurisdiction, source_url: row.base_url ?? '', kind: (row.format as SourceKind),
    priority: ((row.priority as 1 | 2 | 3 | 4) || 3), family: row.family, category: (row.kind as WarrantCategory),
  };
  if (row.family === 'socrata') {
    return { meta, mode: 'full-list', async fetchChunk(cursor: string | null): Promise<ChunkResult> {
      const offset = cursor ? Number(cursor) : 0;
      try {
        const url = buildSocrataOffsetUrl(row.base_url ?? '', row.resource_id ?? '', offset, CHUNK_TARGET);
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) return { hits: [], nextCursor: cursor, done: false };  // error → retry same page, no sweep
        const rows = (await res.json()) as Record<string, unknown>[];
        return {
          hits: parseSocrata(rows, map, row.source_key),
          nextCursor: String(offset + CHUNK_TARGET),
          done: rows.length < CHUNK_TARGET,   // raw row count, NOT deduped hits
        };
      } catch {
        return { hits: [], nextCursor: cursor, done: false };
      }
    } };
  }
  if (row.family === 'arcgis') {
    return { meta, mode: 'full-list', async fetchChunk(cursor: string | null): Promise<ChunkResult> {
      const startOid = cursor ? Number(cursor) : 0;
      const hits: RawWarrantHit[] = [];
      let lastOid = startOid;
      try {
        // Loop ≤2000-row keyset pages until we cross the soft budget at a page
        // boundary, or the roster is exhausted (short page). A failed page mid-loop
        // returns what we have with done=false so the leg retries from lastOid.
        while (hits.length < CHUNK_TARGET) {
          const url = buildArcgisKeysetUrl(row.base_url ?? '', lastOid, ARCGIS_SERVER_PAGE);
          const res = await fetch(url, { headers: { Accept: 'application/json' } });
          if (!res.ok) return { hits, nextCursor: String(lastOid), done: false };
          const body = (await res.json()) as { features?: { attributes?: Record<string, unknown> }[]; exceededTransferLimit?: boolean };
          const features = body.features ?? [];
          if (features.length === 0) return { hits, nextCursor: String(lastOid), done: true };
          hits.push(...parseArcgis(body, map, row.source_key));
          const prevOid = lastOid;
          lastOid = maxObjectId(features, lastOid);
          // Defensive: a non-empty page that fails to advance the cursor (features
          // with missing/NaN OBJECTID) would otherwise re-fetch the same window
          // forever and hit the Worker CPU limit. Break instead — done:false (via
          // the post-loop return) leaves the cursor put so the leg retries next tick.
          if (lastOid <= prevOid) break;
          if (!arcgisHasMore(body, ARCGIS_SERVER_PAGE)) return { hits, nextCursor: String(lastOid), done: true };
        }
        return { hits, nextCursor: String(lastOid), done: false };
      } catch {
        return { hits, nextCursor: String(lastOid), done: false };
      }
    } };
  }
  return null;
}

/** Adapters built from enabled national_warrant_sources rows (config-driven families). */
export async function getConfigAdapters(db: D1Database): Promise<WarrantSourceAdapter[]> {
  let rows: SourceRow[] = [];
  try { rows = await query<SourceRow>(db, 'SELECT * FROM national_warrant_sources WHERE enabled = 1'); } catch { return []; }
  return rows.map(makeAdapter).filter((a): a is WarrantSourceAdapter => a !== null);
}
