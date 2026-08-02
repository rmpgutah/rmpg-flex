import { describe, it, expect } from 'vitest';
import { renderDailyReport } from '../src/utils/dailyReport/render';
import type { DailyReportData } from '../src/utils/dailyReport/types';

const emptyData: DailyReportData = {
  date: '2026-07-18',
  generatedAt: '2026-08-01T12:00:00.000Z',
  operations: { calls: [], citations: [] },
  fleet: { trips: [], fuel: [], checks: [], workOrders: [] },
};

const fullData: DailyReportData = {
  ...emptyData,
  operations: {
    calls: [{
      call_number: 'C-1', received_at: '2026-07-18 20:00:00', incident_type: 'ALARM',
      priority: 2, location_address: '123 Main St', disposition: 'CLEARED',
      status: 'CLOSED', unit_call_signs: '1A1', responding_officer: 'Zamora',
    }],
    citations: [],
  },
  fleet: {
    trips: [{ vehicle_label: 'Unit 1', trips: 3, miles: 42.5, duration_s: 5400 }],
    fuel: [], checks: [], workOrders: [],
  },
};

describe('renderDailyReport', () => {
  it('produces a real PDF', async () => {
    const bytes = await renderDailyReport(fullData);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(500);
  });

  it('renders an explicit no-activity line rather than omitting a section', async () => {
    // Distinguishing "quiet day" from "report is broken" is the whole point.
    const empty = await renderDailyReport(emptyData);
    const populated = await renderDailyReport(fullData);
    expect(empty.length).toBeGreaterThan(500);
    expect(populated.length).not.toBe(empty.length);
  });

  it('is deterministic for identical input', async () => {
    const a = await renderDailyReport(fullData);
    const b = await renderDailyReport(fullData);
    expect(a.length).toBe(b.length);
  });

  it('is pure — no bindings, no globals, no throw on minimal input', async () => {
    await expect(renderDailyReport(emptyData)).resolves.toBeInstanceOf(Uint8Array);
  });
});
