import { describe, it, expect } from 'vitest';
import {
  wrapText,
  describeFilters,
  fmtTimestamp,
  generateAuditLogPdf,
  type AuditLogEntryForPdf,
} from '../auditLogPdf';

function mkEntry(overrides: Partial<AuditLogEntryForPdf>): AuditLogEntryForPdf {
  return {
    id: 1,
    user_id: 10,
    user_name: 'Officer Smith',
    badge_number: '101',
    user_role: 'officer',
    action: 'warrant_updated',
    entity_type: 'warrant',
    entity_id: '47',
    details: 'Status changed from open to served',
    ip_address: '10.0.0.5',
    created_at: '2026-06-22T14:23:05Z',
    ...overrides,
  };
}

describe('wrapText (audit pdf)', () => {
  it('returns a single empty entry for empty input', () => {
    expect(wrapText('', 20)).toEqual(['']);
  });
  it('keeps short strings as one line', () => {
    expect(wrapText('warrant served', 30)).toEqual(['warrant served']);
  });
  it('wraps at word boundaries', () => {
    expect(wrapText('one two three four', 10)).toEqual(['one two', 'three four']);
  });
  it('preserves explicit newlines as paragraph breaks', () => {
    expect(wrapText('line one\nline two', 50)).toEqual(['line one', 'line two']);
  });
  it('keeps a single oversize word intact (does not slice it)', () => {
    const out = wrapText('SUPERCALIFRAGILISTICEXPIALIDOCIOUS', 10);
    expect(out.length).toBe(1);
    expect(out[0]).toBe('SUPERCALIFRAGILISTICEXPIALIDOCIOUS');
  });
});

describe('describeFilters', () => {
  it('describes an empty filter set as unfiltered', () => {
    expect(describeFilters(undefined)).toMatch(/unfiltered/i);
    expect(describeFilters({})).toMatch(/unfiltered/i);
  });
  it('joins active filters with commas', () => {
    expect(describeFilters({
      action: 'warrant_updated',
      entityType: 'warrant',
      userId: '10',
    })).toBe('action=warrant_updated, type=warrant, user=10');
  });
  it('quotes the search term so it is visually distinct', () => {
    expect(describeFilters({ search: 'served' })).toBe('search="served"');
  });
  it('skips empty fields', () => {
    expect(describeFilters({
      action: 'warrant_updated',
      entityType: '',
      userId: '',
      startDate: '2026-06-01',
    })).toBe('action=warrant_updated, from=2026-06-01');
  });
});

describe('fmtTimestamp', () => {
  it('returns em-dash for empty input', () => {
    expect(fmtTimestamp(null)).toBe('—');
    expect(fmtTimestamp(undefined)).toBe('—');
    expect(fmtTimestamp('')).toBe('—');
  });
  it('formats a UTC timestamp in Mountain Time with the MT suffix', () => {
    // 2026-06-22T14:23:05Z is 2026-06-22 08:23:05 in Denver (MDT, UTC-6).
    const out = fmtTimestamp('2026-06-22T14:23:05Z');
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} MT$/);
    expect(out).toContain('2026-06-22');
    expect(out).toContain(' MT');
  });
});

describe('generateAuditLogPdf', () => {
  it('produces a jsPDF document with at least one page when no entries match', () => {
    const doc = generateAuditLogPdf({ entries: [] });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it('produces a multi-row document for a single entry', () => {
    const doc = generateAuditLogPdf({
      entries: [mkEntry({})],
      filters: { action: 'warrant_updated' },
      totalMatching: 1,
      exportedBy: 'Sgt. Doe',
    });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    // Output bytes should be non-trivial — sanity check the doc actually
    // got serialized rather than crashing silently.
    const bytes = doc.output('arraybuffer');
    expect(bytes.byteLength).toBeGreaterThan(2000);
  });

  it('paginates when given many entries (sanity, no crash)', () => {
    const entries: AuditLogEntryForPdf[] = [];
    for (let i = 0; i < 80; i++) {
      entries.push(mkEntry({ id: i + 1, details: `Entry ${i + 1} detail text` }));
    }
    const doc = generateAuditLogPdf({ entries, totalMatching: 80 });
    // 80 single-line rows should overflow a single landscape page.
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(2);
  });

  it('does not crash when entries omit optional fields', () => {
    const doc = generateAuditLogPdf({
      entries: [{
        id: 1,
        action: 'system_event',
        entity_type: 'system',
        entity_id: '',
        created_at: '2026-06-22T00:00:00Z',
      }],
    });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });
});
