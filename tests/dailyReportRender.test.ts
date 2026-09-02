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
      call_number: 'C-1', received_at: '2026-07-18 20:00:00', created_at: '2026-07-18 20:00:00',
      incident_type: 'ALARM', priority: 2, location_address: '123 Main St', disposition: 'CLEARED',
      status: 'CLOSED', unit_call_signs: '1A1', responding_officer: 'Zamora',
      description: null, notes: null, source: null, dispatch_code: null,
      sector_name: null, zone_name: null, beat_name: null,
      weapons_involved: null, domestic_violence: null, mental_health_crisis: null,
      juvenile_involved: null, felony_in_progress: null, officer_safety_caution: null,
      k9_requested: null, ems_requested: null, response_time_seconds: null,
      onscene_duration_seconds: null, pso_requestor_name: null, pso_service_type: null,
      le_notified: null, le_case_number: null, supervisor_notified: null,
      damage_estimate: null, damage_description: null, action_taken: null,
      caller_relationship: null, caller_name: null, secondary_type: null, scene_safety: null,
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

  it('never draws a line wider than the printable area', async () => {
    // 516pt usable width. A fixed character cap cannot guarantee this —
    // real call rows concatenate to ~168 chars on live data.
    const longData: DailyReportData = {
      ...emptyData,
      operations: {
        calls: [{
          call_number: 'C-9999999999',
          received_at: '2026-07-18 20:00:00',
          created_at: '2026-07-18 20:00:00',
          incident_type: 'SUSPICIOUS CIRCUMSTANCES INVESTIGATION',
          priority: 1,
          location_address: '12345 SOUTH REDWOOD ROAD BUILDING C SUITE 1200, WEST JORDAN, UTAH 84088',
          disposition: 'REPORT TAKEN — REFERRED TO INVESTIGATIONS DIVISION',
          status: 'CLOSED',
          unit_call_signs: '1A1, 1A2, 2B7',
          responding_officer: 'CHRISTOPHER ZAMORA',
          description: null, notes: null, source: null, dispatch_code: null,
          sector_name: null, zone_name: null, beat_name: null,
          weapons_involved: null, domestic_violence: null, mental_health_crisis: null,
          juvenile_involved: null, felony_in_progress: null, officer_safety_caution: null,
          k9_requested: null, ems_requested: null, response_time_seconds: null,
          onscene_duration_seconds: null, pso_requestor_name: null, pso_service_type: null,
          le_notified: null, le_case_number: null, supervisor_notified: null,
          damage_estimate: null, damage_description: null, action_taken: null,
          caller_relationship: null, caller_name: null, secondary_type: null, scene_safety: null,
        }],
        citations: [],
      },
    };
    const bytes = await renderDailyReport(longData);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');

    const { extractText, getDocumentProxy } = await import('unpdf');
    const doc = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(doc, { mergePages: true });
    const joined = Array.isArray(text) ? text.join('\n') : text;
    // The over-long row must have been shortened rather than drawn past the edge.
    expect(joined).toContain('…');
  });

  it('leaves short lines untouched — no gratuitous ellipsis', async () => {
    const bytes = await renderDailyReport(fullData);
    const { extractText, getDocumentProxy } = await import('unpdf');
    const doc = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(doc, { mergePages: true });
    const joined = Array.isArray(text) ? text.join('\n') : text;
    expect(joined).toContain('123 Main St');
    expect(joined).not.toContain('…');
  });

  it('displays Mountain Time (MT), not raw UTC, for all timestamps', async () => {
    // received_at '2026-07-18 20:00:00' is UTC = 14:00 MT (MDT, UTC-6).
    // generatedAt '2026-08-01T12:00:00.000Z' is UTC = 06:00 MT.
    // If the blotter shows '20:00' or '12:00' the UTC-to-MT conversion is broken.
    const bytes = await renderDailyReport(fullData);
    const { extractText, getDocumentProxy } = await import('unpdf');
    const doc = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(doc, { mergePages: true });
    const joined = Array.isArray(text) ? text.join('\n') : text;

    // Must contain the Mountain Time representation.
    expect(joined).toContain('2026-07-18 14:00 MT');
    expect(joined).toContain('2026-08-01 06:00:00 MT');

    // Must NOT contain the raw UTC values.
    expect(joined).not.toContain('20:00:00');
    expect(joined).not.toContain('12:00:00Z');
  });
});
