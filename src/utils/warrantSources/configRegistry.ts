import type { D1Database } from '@cloudflare/workers-types';
import type { WarrantSourceAdapter, RawWarrantHit, SourceKind, WarrantCategory, ChunkResult } from './types';
import { query } from '../db';
import { parseSocrata, type FieldMap } from './parse/socrata';
import { parseArcgis } from './parse/arcgis';
import { buildArcgisKeysetUrl, buildSocrataOffsetUrl, maxObjectId, arcgisHasMore, ARCGIS_SERVER_PAGE, CHUNK_TARGET } from './paging';
import { fetchPdfText } from './pdfText';
import { parseZuercherPdf } from './parse/pdfZuercher';
import { parseTxMuniPdf } from './parse/pdfTxMuni';
import { parseNewtonPdf } from './parse/pdfNewton';
import { parseIncodePdf } from './parse/pdfIncode';
import { parseBonnerXml } from './parse/bonnerXml';
import { parseZuercherCsv } from './parse/zuercherCsv';

type TextParser = (text: string, sourceKey: string, state: string) => RawWarrantHit[];
/** Plain-text (non-PDF, non-JSON) full-list families: fetch the URL as text and parse.
 *  xml-bonner = Bonner County ID structured XML; csv-zuercher = the Zuercher portal
 *  `web_warrant_list.csv` export (reusable across Zuercher-platform sheriffs). */
const TEXT_FAMILIES: Record<string, TextParser> = {
  'xml-bonner': parseBonnerXml,
  'csv-zuercher': parseZuercherCsv,
};

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

type PdfParser = (text: string, sourceKey: string, state: string) => RawWarrantHit[];
/** PDF layout families: each maps to a parser + whether it needs line-preserving
 *  text (mergePages:false). Zuercher reconstructs from the flat stream; the all-caps
 *  TX-muni / column-major Newton / multi-line INCODE layouts need row newlines. */
const PDF_FAMILIES: Record<string, { parse: PdfParser; lines: boolean }> = {
  'pdf-zuercher': { parse: parseZuercherPdf, lines: false },
  'pdf-txmuni': { parse: parseTxMuniPdf, lines: true },
  'pdf-newton': { parse: parseNewtonPdf, lines: true },
  'pdf-incode': { parse: parseIncodePdf, lines: true },
};

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
        if (!res.ok) {
          // error → retry same page, no sweep. Log so a persistently-failing
          // source isn't a silent stall (cursor stuck with errors:0 in the summary).
          console.warn(`[warrantSources.config] ${row.source_key} socrata fetch HTTP ${res.status} at offset ${offset}; retrying next tick`);
          return { hits: [], nextCursor: cursor, done: false };
        }
        const rows = (await res.json()) as Record<string, unknown>[];
        return {
          hits: parseSocrata(rows, map, row.source_key),
          nextCursor: String(offset + CHUNK_TARGET),
          done: rows.length < CHUNK_TARGET,   // raw row count, NOT deduped hits
        };
      } catch (err) {
        console.warn(`[warrantSources.config] ${row.source_key} socrata fetch threw at offset ${offset}:`, err instanceof Error ? err.message : String(err));
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
          if (!res.ok) {
            // keep what we have, retry from lastOid next tick. Log so a
            // persistently-failing source isn't a silent stall.
            console.warn(`[warrantSources.config] ${row.source_key} arcgis fetch HTTP ${res.status} after OBJECTID ${lastOid}; retrying next tick`);
            return { hits, nextCursor: String(lastOid), done: false };
          }
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
      } catch (err) {
        console.warn(`[warrantSources.config] ${row.source_key} arcgis fetch threw after OBJECTID ${lastOid}:`, err instanceof Error ? err.message : String(err));
        return { hits, nextCursor: String(lastOid), done: false };
      }
    } };
  }
  const pdf = PDF_FAMILIES[row.family];
  if (pdf) {
    return { meta, mode: 'full-list', async fetchAll(): Promise<RawWarrantHit[]> {
      const text = await fetchPdfText(row.base_url ?? '', { lines: pdf.lines });
      if (!text) return [];  // URL 404'd / no text layer — degrade gracefully, don't throw
      try { return pdf.parse(text, row.source_key, row.state ?? 'US'); } catch { return []; }
    } };
  }
  const textParser = TEXT_FAMILIES[row.family];
  if (textParser) {
    return { meta, mode: 'full-list', async fetchAll(): Promise<RawWarrantHit[]> {
      try {
        const res = await fetch(row.base_url ?? '', { headers: { 'User-Agent': BROWSER_UA, Accept: '*/*' } });
        if (!res.ok) return [];  // 404/403 — degrade gracefully
        return textParser(await res.text(), row.source_key, row.state ?? 'US');
      } catch { return []; }
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
