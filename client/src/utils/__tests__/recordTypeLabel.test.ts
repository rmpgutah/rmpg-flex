import { describe, it, expect } from 'vitest';
import { recordTypeLabel } from '../recordTypeLabel';

describe('recordTypeLabel', () => {
  it('maps the linkable record types', () => {
    expect(recordTypeLabel('person')).toBe('Person');
    expect(recordTypeLabel('incident')).toBe('Incident');
    expect(recordTypeLabel('warrant')).toBe('Warrant');
    expect(recordTypeLabel('business')).toBe('Business');
  });
  it('maps multi-word / abbreviated types to nice forms', () => {
    expect(recordTypeLabel('field_interview')).toBe('Field Interview');
    expect(recordTypeLabel('trespass_order')).toBe('Trespass Order');
    expect(recordTypeLabel('serve_job')).toBe('Serve Job');
    expect(recordTypeLabel('calls_for_service')).toBe('Call for Service');
    expect(recordTypeLabel('dl')).toBe('Driver License');
  });
  it('humanizes an UNMAPPED code rather than leaking it raw', () => {
    expect(recordTypeLabel('some_new_type')).toBe('Some New Type');
    expect(recordTypeLabel('kebab-case-type')).toBe('Kebab Case Type');
  });
  it('is case-insensitive on input (handles uppercased codes)', () => {
    expect(recordTypeLabel('FIELD_INTERVIEW')).toBe('Field Interview');
    expect(recordTypeLabel('Person')).toBe('Person');
  });
  it('never returns empty/raw for nullish input', () => {
    expect(recordTypeLabel('')).toBe('Record');
    expect(recordTypeLabel(null)).toBe('Record');
    expect(recordTypeLabel(undefined)).toBe('Record');
  });
});
