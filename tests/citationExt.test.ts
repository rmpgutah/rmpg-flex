// ============================================================
// citationExt — Uniform Citation overflow-column helpers
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  CITATION_EXT_COLUMNS,
  extractCitationExt,
  isCitationExtColumn,
  redactCitationExt,
} from '../src/utils/citationExt';

describe('isCitationExtColumn', () => {
  it('claims the official-form fields', () => {
    for (const col of ['ori', 'birth_place', 'person_height', 'mile_post', 'docket_number']) {
      expect(isCitationExtColumn(col)).toBe(true);
    }
  });

  it('does not claim columns that live on `citations`', () => {
    // A base column captured by the ext writer would be written to the
    // overflow table and then shadowed on read — a silent data split.
    for (const col of ['person_name', 'violation_date', 'fine_amount', 'court_name', 'notes']) {
      expect(isCitationExtColumn(col)).toBe(false);
    }
  });

  it('stays well under D1 SQLITE_MAX_COLUMN once citation_id/timestamps are added', () => {
    expect(CITATION_EXT_COLUMNS.length + 3).toBeLessThan(100);
  });
});

describe('extractCitationExt', () => {
  it('returns null when the body carries no overflow fields', () => {
    expect(extractCitationExt({ person_name: 'Doe, John', fine_amount: 120 })).toBeNull();
  });

  it('picks out only the overflow fields', () => {
    const out = extractCitationExt({
      person_name: 'Doe, John', ori: 'UT0123456', person_height: '511',
    });
    expect(out).toEqual({ ori: 'UT0123456', person_height: '511' });
  });

  it('coerces booleans to 0/1 and keeps unanswered as null', () => {
    // The form prints YES [] NO [] — an unanswered question leaves both
    // empty. Coercing '' to 0 would print an explicit "NO" nobody stated.
    const out = extractCitationExt({
      cdl_presented: true, motorcycle_endorsed: false, picture_id: '', interstate: null,
    })!;
    expect(out.cdl_presented).toBe(1);
    expect(out.motorcycle_endorsed).toBe(0);
    expect(out.picture_id).toBeNull();
    expect(out.interstate).toBeNull();
  });

  it('accepts yes/no and 1/0 strings from a form control', () => {
    const out = extractCitationExt({ cdl_presented: 'yes', military: 'no', interstate: '1' })!;
    expect(out.cdl_presented).toBe(1);
    expect(out.military).toBe(0);
    expect(out.interstate).toBe(1);
  });

  it('coerces numerics and rejects garbage rather than writing NaN', () => {
    const out = extractCitationExt({ fine_imposed: '250.50', jail_days: 'abc' })!;
    expect(out.fine_imposed).toBe(250.5);
    expect(out.jail_days).toBeNull();
  });

  it('ignores undefined so a PATCH never blanks an untouched field', () => {
    expect(extractCitationExt({ ori: undefined, person_eyes: 'BRO' })).toEqual({ person_eyes: 'BRO' });
  });
});

describe('redactCitationExt', () => {
  it('returns the full SSN to roles that issue or supervise citations', () => {
    for (const role of ['admin', 'manager', 'supervisor', 'officer']) {
      expect(redactCitationExt({ ssn: '250995610' }, role).ssn).toBe('250995610');
    }
  });

  it('masks the SSN for every other authenticated reader', () => {
    for (const role of ['dispatcher', 'client_viewer', 'contract_manager', undefined]) {
      expect(redactCitationExt({ ssn: '250995610' }, role).ssn).toBe('***-**-5610');
    }
  });

  it('leaves a record without an SSN untouched', () => {
    const row = { ori: 'UT0123456' };
    expect(redactCitationExt(row, 'dispatcher')).toBe(row);
  });

  it('does not invent digits when the stored value has none', () => {
    expect(redactCitationExt({ ssn: 'N/A' }, 'dispatcher').ssn).toBeNull();
  });
});
