import type { D1Database } from '@cloudflare/workers-types';

const OFAC_CSV_URL = 'https://sanctionslistservice.ofac.treas.gov/api/publicationpreview/exports/consolidated.csv';

// CSV format (relevant columns — exact indices vary; use header row to find them):
// col 0: ent_num (unique row ID — use as source_row_id)
// col 1: SDN_Name (full name)
// col 2: SDN_Type ("individual", "entity", "vessel")
// col 3: Program (sanctions program code)
// col 14: Remarks (free-text, often includes DOB)
//
// The CSV also has alt-name rows interleaved; filter: col 2 must match 'individual'
// DOB extraction: look for "DOB" in remarks column, extract YYYY or DD Mon YYYY patterns

export interface OfacSyncResult {
  downloaded: boolean;
  rowsProcessed: number;
  individualsFound: number;
  rowsUpserted: number;
  error?: string;
}

export async function syncOfacSdn(db: D1Database): Promise<OfacSyncResult> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30_000); // 30s timeout
    const res = await fetch(OFAC_CSV_URL, { signal: ctrl.signal });
    clearTimeout(timer);

    if (!res.ok) {
      return { downloaded: false, rowsProcessed: 0, individualsFound: 0, rowsUpserted: 0,
               error: `HTTP ${res.status}` };
    }

    const text = await res.text();
    const lines = text.split('\n');
    if (lines.length < 2) {
      return { downloaded: true, rowsProcessed: 0, individualsFound: 0, rowsUpserted: 0,
               error: 'CSV too short' };
    }

    // Parse header to find column indices
    const headers = parseCSVLine(lines[0]);
    const colIdx = (name: string) => headers.findIndex(h => h.toLowerCase().includes(name.toLowerCase()));

    const idxEntNum  = colIdx('ent_num');
    const idxName    = colIdx('sdn_name');
    const idxType    = colIdx('sdn_type');
    const idxProgram = colIdx('program');
    const idxRemarks = colIdx('remarks');

    // Collect individual rows
    type SdnRow = { source_row_id: string; sdn_name: string; sdn_type: string;
                    program: string | null; dob: string | null; remarks: string | null };
    const individuals: SdnRow[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const cols = parseCSVLine(line);
      const sdnType = (cols[idxType] ?? '').trim().toLowerCase();
      if (sdnType !== 'individual') continue;

      const rawName = (cols[idxName] ?? '').trim();
      if (!rawName) continue;

      const remarks = idxRemarks >= 0 ? (cols[idxRemarks] ?? '').trim() : null;
      const dob = extractDob(remarks ?? '');

      individuals.push({
        source_row_id: (cols[idxEntNum] ?? `row_${i}`).trim(),
        sdn_name:      rawName,
        sdn_type:      'individual',
        program:       idxProgram >= 0 ? ((cols[idxProgram] ?? '').trim() || null) : null,
        dob,
        remarks:       remarks || null,
      });
    }

    // Upsert in chunks of 10 rows (10 × 6 params = 60 ≤ 100-param D1 limit)
    const CHUNK = 10;
    let rowsUpserted = 0;
    for (let i = 0; i < individuals.length; i += CHUNK) {
      const chunk = individuals.slice(i, i + CHUNK);
      const params: (string | null)[] = [];
      for (const r of chunk) {
        params.push(r.source_row_id, r.sdn_name, r.sdn_type, r.program, r.dob, r.remarks);
      }
      await db.prepare(
        `INSERT OR REPLACE INTO ofac_sdn
           (source_row_id, sdn_name, sdn_type, program, dob, remarks, last_refreshed)
         VALUES ${chunk.map(() => "(?,?,?,?,?,?,datetime('now'))").join(',')}`,
      ).bind(...params).run();
      rowsUpserted += chunk.length;
    }

    return {
      downloaded: true,
      rowsProcessed: lines.length - 1,
      individualsFound: individuals.length,
      rowsUpserted,
    };
  } catch (err) {
    return { downloaded: false, rowsProcessed: 0, individualsFound: 0, rowsUpserted: 0,
             error: err instanceof Error ? err.message : 'unknown' };
  }
}

// Parse a single CSV line, handling quoted fields with embedded commas
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === ',' && !inQuotes) {
      result.push(field); field = '';
    } else {
      field += ch;
    }
  }
  result.push(field);
  return result;
}

// Extract DOB from OFAC remarks text like "DOB 01 Jan 1970" or "DOB 1970"
function extractDob(remarks: string): string | null {
  // Full date: "DOB DD Mon YYYY" → YYYY-MM-DD
  const fullMatch = remarks.match(/DOB\s+(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})/i);
  if (fullMatch) {
    const months: Record<string, string> = {
      jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
      jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12',
    };
    const m = months[fullMatch[2].toLowerCase()];
    return `${fullMatch[3]}-${m}-${fullMatch[1].padStart(2,'0')}`;
  }
  // Year only: "DOB 1970"
  const yearMatch = remarks.match(/DOB\s+(\d{4})/i);
  if (yearMatch) return yearMatch[1];
  return null;
}
