import { describe, it, expect } from 'vitest';
import { parseSocrata, type FieldMap } from '../src/utils/warrantSources/parse/socrata';

const BRLA_ROWS = [
  { name: 'SMITH, JOHN Q', dob: '1985-04-12', type: 'FAILURE TO APPEAR', fileno: 'C-12345', doa: '2024-06-01', state: 'LA', add3: 'BATON ROUGE', race: 'B', sex: 'M' },
];
const MAP: FieldMap = { name: 'name', dob: 'dob', charge: 'type', case_no: 'fileno', issued: 'doa', state: 'state', city: 'add3', race: 'race', sex: 'sex' };

describe('parseSocrata', () => {
  it('maps SODA rows to RawWarrantHit via field-map', () => {
    const hits = parseSocrata(BRLA_ROWS, MAP, 'socrata-brla-citycourt');
    expect(hits).toHaveLength(1);
    const h = hits[0];
    expect(h.source_key).toBe('socrata-brla-citycourt');
    expect(h.full_name).toBe('Smith, John Q');
    expect(h.date_of_birth).toBe('1985-04-12');
    expect(h.charge_description).toBe('FAILURE TO APPEAR');
    expect(h.case_number).toBe('C-12345');
    expect(h.issue_date).toBe('2024-06-01');
    expect(h.state).toBe('LA');
    expect(h.warrant_id).toBeTruthy();
  });
  it('derives a stable warrant_id and dedups identical rows', () => {
    const hits = parseSocrata([...BRLA_ROWS, ...BRLA_ROWS], MAP, 'socrata-brla-citycourt');
    expect(new Set(hits.map(h => h.warrant_id)).size).toBe(1);
  });
  it('builds Last, First M full_name from first/last parts when no name field', () => {
    const rows = [{ first: 'Jane', last: 'Doe', wa_chrg: 'THEFT' }];
    const m: FieldMap = { first: 'first', last: 'last', charge: 'wa_chrg' };
    const hits = parseSocrata(rows, m, 'socrata-norfolk-pd');
    expect(hits[0].full_name).toBe('Doe, Jane');
    expect(hits[0].charge_description).toBe('THEFT');
  });
});
