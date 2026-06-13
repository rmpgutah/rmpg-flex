import type { D1Database } from '@cloudflare/workers-types';
import type { WarrantSourceAdapter, RawWarrantHit, SourceKind, WarrantCategory } from './types';
import { query } from '../db';
import { parseSocrata, type FieldMap } from './parse/socrata';
import { parseArcgis } from './parse/arcgis';
import { fetchPdfText } from './pdfText';
import { parseZuercherPdf } from './parse/pdfZuercher';
import { parseTxMuniPdf } from './parse/pdfTxMuni';
import { parseNewtonPdf } from './parse/pdfNewton';

type PdfParser = (text: string, sourceKey: string, state: string) => RawWarrantHit[];
/** PDF layout families: each maps to a parser + whether it needs line-preserving
 *  text (mergePages:false). Zuercher reconstructs from the flat stream; the all-caps
 *  TX-muni / column-major Newton layouts need row newlines. */
const PDF_FAMILIES: Record<string, { parse: PdfParser; lines: boolean }> = {
  'pdf-zuercher': { parse: parseZuercherPdf, lines: false },
  'pdf-txmuni': { parse: parseTxMuniPdf, lines: true },
  'pdf-newton': { parse: parseNewtonPdf, lines: true },
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
    return { meta, mode: 'full-list', async fetchAll(): Promise<RawWarrantHit[]> {
      try {
        const out: RawWarrantHit[] = [];
        const PAGE = 50000;
        for (let offset = 0; offset < 1_000_000; offset += PAGE) {
          // $order=:id gives a stable sort so $offset paging doesn't skip/repeat rows.
          const url = `https://${row.base_url}/resource/${row.resource_id}.json?$limit=${PAGE}&$offset=${offset}&$order=:id`;
          const res = await fetch(url, { headers: { Accept: 'application/json' } });
          if (!res.ok) break;
          const rows = (await res.json()) as Record<string, unknown>[];
          out.push(...parseSocrata(rows, map, row.source_key));
          if (rows.length < PAGE) break;  // last page
        }
        return out;
      } catch { return []; }
    } };
  }
  if (row.family === 'arcgis') {
    return { meta, mode: 'full-list', async fetchAll(_env: { DB: D1Database } & Record<string, unknown>): Promise<RawWarrantHit[]> {
      try {
        const out: RawWarrantHit[] = [];
        for (let offset = 0; offset < 50000; offset += 1000) {
          const url = `${row.base_url}/query?where=1%3D1&outFields=*&f=json&resultOffset=${offset}&resultRecordCount=1000`;
          const res = await fetch(url, { headers: { Accept: 'application/json' } });
          if (!res.ok) break;
          const body = (await res.json()) as { features?: unknown[]; exceededTransferLimit?: boolean };
          out.push(...parseArcgis(body, map, row.source_key));
          if (!body.exceededTransferLimit) break;
        }
        return out;
      } catch { return []; }
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
  return null;
}

/** Adapters built from enabled national_warrant_sources rows (config-driven families). */
export async function getConfigAdapters(db: D1Database): Promise<WarrantSourceAdapter[]> {
  let rows: SourceRow[] = [];
  try { rows = await query<SourceRow>(db, 'SELECT * FROM national_warrant_sources WHERE enabled = 1'); } catch { return []; }
  return rows.map(makeAdapter).filter((a): a is WarrantSourceAdapter => a !== null);
}
