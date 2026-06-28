import { describe, it, expect } from 'vitest';
import { parseNodeRefs, buildTimelineEvent } from '../src/utils/connectionsTimeline';

describe('parseNodeRefs', () => {
  it('parses type:id pairs', () => {
    expect(parseNodeRefs('person:1,incident:5')).toEqual([
      { type: 'person', id: 1 }, { type: 'incident', id: 5 },
    ]);
  });
  it('drops garbage, non-numeric, and non-positive ids', () => {
    expect(parseNodeRefs('person:0,bad,vehicle:x,call:9')).toEqual([
      { type: 'call', id: 9 },
    ]);
  });
  it('dedups and caps', () => {
    expect(parseNodeRefs('person:1,person:1')).toEqual([{ type: 'person', id: 1 }]);
    expect(parseNodeRefs(Array.from({ length: 100 }, (_, i) => `person:${i + 1}`).join(','), 60).length).toBe(60);
  });
  it('handles empty/undefined', () => {
    expect(parseNodeRefs('')).toEqual([]);
  });
});

describe('buildTimelineEvent', () => {
  it('maps an intel_report row to a sanitized intel event', () => {
    const ev = buildTimelineEvent('intel_report', {
      id: 3, report_number: 'INT-2026-0003', title: 'Surveillance',
      disseminated_at: '2026-06-13T07:51:35Z', source_reliability: 'B',
      info_credibility: 2, threat_level: 'high',
    });
    expect(ev).toMatchObject({ kind: 'intel', id: 3, date: '2026-06-13T07:51:35Z', status: 'DISSEMINATED' });
    expect(ev!.title).toContain('INT-2026-0003');
    expect(ev!.subtitle).toContain('B2');
    expect(ev!.subtitle).toContain('high');
  });
  it('maps an incident row using occurred_date', () => {
    const ev = buildTimelineEvent('incident', { id: 5, incident_number: 'I-1', incident_type: 'Theft', occurred_date: '2026-01-02', status: 'closed', location_address: 'Main St' });
    expect(ev).toMatchObject({ kind: 'incident', id: 5, date: '2026-01-02' });
    expect(ev!.title).toContain('Theft');
  });
  it('returns null for an undated/unknown type', () => {
    expect(buildTimelineEvent('person', { id: 1 })).toBeNull();
  });
});
