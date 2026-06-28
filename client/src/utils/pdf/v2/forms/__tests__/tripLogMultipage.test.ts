import { describe, it, expect } from 'vitest';
import { renderPdfV2 } from '../../engine/renderer';
import { tripLogSchema, type TripLogData, type TripLogRow } from '../tripLog';
import { assertPdfSnapshot } from '../../__tests__/snapshotHelpers';

// Regression guard for the multi-page PS-211 trip log. A 108-row log spills
// across 3 pages; a "draw on the current page" bug in the table primitive used
// to paint each completed page's grid onto the NEXT page (page 1 borderless,
// page 2 half-gridded, a full-height phantom box bleeding through the TOTALS
// block on the last page) and never repeated the column header on continuation
// pages. See engine/primitives.ts `table()` + layout.ts `pageBreakIfNeeded`.

function buildRows(): TripLogRow[] {
  const days = ['06', '07', '08', '09', '10', '11', '12', '13', '14'];
  const rows: TripLogRow[] = [];
  let n = 0;
  while (rows.length < 108) {
    const day = days[Math.min(Math.floor(rows.length / 12), days.length - 1)];
    const hh = String(8 + (n % 14)).padStart(2, '0');
    const mm = String((n * 7) % 60).padStart(2, '0');
    const endM = String((n * 7 + 5) % 60).padStart(2, '0');
    const withMileage = rows.length === 38 || rows.length === 39; // a couple ranged rows
    rows.push({
      type: 'PATROL',
      call_id: null,
      call_number: null,
      start: `2026-06-${day} ${hh}:${mm}:00`,
      end: `2026-06-${day} ${hh}:${endM}:00`,
      distance_mi: Number(((n * 1.3) % 35).toFixed(1)),
      duration_min: (n * 3) % 92,
      mileage_from: withMileage ? 92799.3 : null,
      mileage_to: withMileage ? 92814.8 : null,
      max_mph: (n * 5) % 90,
      harsh: { a: n % 50, b: (n * 2) % 75, c: (n * 3) % 148 },
    });
    n++;
  }
  return rows;
}

const SAMPLE: TripLogData = {
  meta: {
    officer_id: 19,
    officer_name: 'Christopher Zamora',
    unit_id: 19,
    unit_call_sign: 'D19',
    period: { from: '2026-06-07', to: '2026-06-14' },
    generated_at: '2026-06-14T18:30:00Z',
    trips_logged: 108,
  },
  anchor: { current_mileage: 92799.3, offset_miles: -456.9 },
  rows: buildRows(),
  totals: { distance_mi: 318.1, duration_min: 794, harsh: { a: 517, b: 543, c: 532 } },
};

describe('trip_log (FORM PS-211) — multi-page', () => {
  it('renders to stable bytes (3-page baseline)', async () => {
    await assertPdfSnapshot(tripLogSchema, SAMPLE, 'trip_log.multipage');
  });

  it('repeats the column header band on every page and keeps TOTALS off the grid', async () => {
    // coreFontsOnly keeps stream text ASCII so we can grep it.
    const doc = await renderPdfV2(tripLogSchema, SAMPLE, {
      generatedAt: new Date('2026-06-14T00:00:00Z'),
      coreFontsOnly: true,
    });
    const pages = doc.getNumberOfPages();
    expect(pages).toBe(3);

    const buf = new Uint8Array(doc.output('arraybuffer') as ArrayBuffer);
    let text = '';
    for (const b of buf) text += String.fromCharCode(b);

    // "MILEAGE" appears only in the table's column header (cells are numeric),
    // so one occurrence per page proves the header repeats on continuation pages.
    const headerHits = text.split('MILEAGE').length - 1;
    expect(headerHits).toBe(pages);

    // The TOTALS labeled block must still render on the final page.
    expect(text).toContain('TOTAL DISTANCE');
    expect(text).toContain('ANCHOR OFFSET');
  });
});
