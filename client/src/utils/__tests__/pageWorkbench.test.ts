import { describe, it, expect } from 'vitest';
import { intelHitsToCsv, shareSearchUrl } from '../intelHitExport';
import { filterSources, sourceStats, sourcesToCsv, filterIntelReports } from '../intelSourcesFilter';
import { filterByQuery, jobsToCsv, syncItemsToCsv } from '../queueWorkbench';

describe('intelHitExport', () => {
  it('csv-escapes flags and builds a share URL', () => {
    const csv = intelHitsToCsv([
      { type: 'person', id: 1, label: 'Hale, "Jane"', snippet: 'x', flags: ['ACTIVE WARRANT'], score: 90 },
    ]);
    expect(csv).toContain('ACTIVE WARRANT');
    expect(csv).toContain('""Jane""');
    expect(shareSearchUrl('Hale')).toContain('/intel/search?q=Hale');
  });
});

describe('intelSourcesFilter', () => {
  const rows = [
    { id: 1, source_code: 'SRC-2026-001', source_type: 'confidential_informant', display_label: 'CI-A', reliability_grade: 'A', status: 'active', restricted: 1 },
    { id: 2, source_code: 'SRC-2026-002', source_type: 'public', display_label: 'Tip line', reliability_grade: 'C', status: 'inactive', restricted: 0 },
  ];

  it('filters, stats, and omits restricted identity columns from CSV', () => {
    expect(filterSources(rows, { q: 'ci-a', type: '', status: '', grade: '' })).toHaveLength(1);
    const stats = sourceStats(rows);
    expect(stats.total).toBe(2);
    expect(stats.active).toBe(1);
    expect(stats.restricted).toBe(1);
    const csv = sourcesToCsv(rows);
    expect(csv).not.toContain('true_identity');
    expect(csv).toContain('SRC-2026-001');
  });

  it('filters intel products by title or number', () => {
    const reports = [
      { title: 'Gang activity', report_number: 'IR-1', status: 'graded', threat_level: 'high' },
      { title: 'Theft', report_number: 'IR-2', status: 'submitted', threat_level: 'low' },
    ];
    expect(filterIntelReports(reports, 'gang')).toHaveLength(1);
  });
});

describe('queueWorkbench', () => {
  it('filters and serializes print/sync rows', () => {
    expect(filterByQuery([{ name: 'CFS-1.pdf' }], 'cfs', (r) => r.name)).toHaveLength(1);
    expect(jobsToCsv([{ id: '1', name: 'a', status: 'pending' }])).toContain('pending');
    expect(syncItemsToCsv([{ id: '1', method: 'POST', endpoint: '/x', status: 'failed', retry_count: 2, created_at: 't' }])).toContain('POST');
  });
});
