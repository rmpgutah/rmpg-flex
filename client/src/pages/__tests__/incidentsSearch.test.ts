import { describe, it, expect } from 'vitest';
import { incidentMatchesSearch } from '../IncidentsPage';

const row = {
  incident_number: 'INC-2026-0001',
  title: 'Report taken',
  location: '100 Main St',
  officer_name: 'J. Smith',
  type: 'traffic_stop',
};

describe('incidentMatchesSearch', () => {
  it('matches the plain-English label the officer sees', () => {
    expect(incidentMatchesSearch(row, 'traffic stop')).toBe(true);
  });
  it('still matches the raw code (additive)', () => {
    expect(incidentMatchesSearch(row, 'traffic_stop')).toBe(true);
  });
  it('still matches the record number', () => {
    expect(incidentMatchesSearch(row, 'inc-2026-0001')).toBe(true);
  });
  it('does not match unrelated text', () => {
    expect(incidentMatchesSearch(row, 'burglary')).toBe(false);
  });
});
