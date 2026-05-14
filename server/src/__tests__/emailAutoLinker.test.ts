import { describe, it, expect } from 'vitest';
import { extractEntityReferences } from '../utils/emailAutoLinker';

describe('extractEntityReferences', () => {
  it('extracts Case # reference', () => {
    const refs = extractEntityReferences('Re: Case #2026-CS-1234', 'see attached');
    expect(refs).toContainEqual(expect.objectContaining({ type: 'case', id: '2026-CS-1234' }));
  });
  it('extracts Incident #', () => {
    const refs = extractEntityReferences('', 'Please review Incident #26-0017 before court');
    expect(refs).toContainEqual(expect.objectContaining({ type: 'incident', id: '26-0017' }));
  });
  it('extracts FI-YY-NNNNN', () => {
    const refs = extractEntityReferences('FI-26-00123 followup', '');
    expect(refs).toContainEqual(expect.objectContaining({ type: 'field_interview', id: 'FI-26-00123' }));
  });
  it('dedupes identical references from subject + body', () => {
    const refs = extractEntityReferences('Case #2026-CS-1234', 'Case #2026-CS-1234 is ready');
    const caseRefs = refs.filter(r => r.type === 'case');
    expect(caseRefs.length).toBe(1);
  });
  it('returns empty for no matches', () => {
    expect(extractEntityReferences('hello', 'world')).toEqual([]);
  });
});
