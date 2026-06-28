import { describe, it, expect } from 'vitest';
import { parseRosterText, normalizeBooking, bookingDedupeId } from '../src/utils/jailIngest';

describe('parseRosterText', () => {
  it('parses CSV with a header row (name, dob, booking_date, charges)', () => {
    const text = 'name,dob,booking_date,charges\nJohn Smith,1990-01-02,2026-06-10,Theft; Trespass\nMaria Del Toro,1985-05-05,2026-06-11,DUI';
    const rows = parseRosterText(text, 'csv');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ full_name: 'John Smith', dob: '1990-01-02', booking_date: '2026-06-10', charges: 'Theft; Trespass' });
    expect(rows[1].full_name).toBe('Maria Del Toro');
  });

  it('parses plain lines as "Name - charges"', () => {
    const rows = parseRosterText('John Smith - Theft\nJane Doe - DUI, Assault', 'lines');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ full_name: 'John Smith', charges: 'Theft' });
    expect(rows[1].charges).toBe('DUI, Assault');
  });

  it('skips blank lines and the header in CSV', () => {
    expect(parseRosterText('name,charges\n\nJohn Smith,Theft\n', 'csv')).toHaveLength(1);
  });
});

describe('normalizeBooking', () => {
  it('splits full_name into first/last when not provided', () => {
    const b = normalizeBooking({ source_key: 'ut-x', booking_id: '1', full_name: 'John Q Smith' });
    expect(b.first_name).toBe('John');
    expect(b.last_name).toBe('Smith');
    expect(b.middle_name).toBe('Q');
  });

  it('keeps explicit first/last over the parsed name', () => {
    const b = normalizeBooking({ source_key: 'ut-x', booking_id: '1', full_name: 'ignore me', first_name: 'Ann', last_name: 'Lee' });
    expect(b.first_name).toBe('Ann');
    expect(b.last_name).toBe('Lee');
  });
});

describe('bookingDedupeId', () => {
  it('is stable for the same source + booking id', () => {
    expect(bookingDedupeId('ut-davis', 'B123')).toBe('ut-davis:B123');
  });
  it('synthesizes from name+date when no booking id', () => {
    const id = bookingDedupeId('ut-davis', '', 'John Smith', '2026-06-10');
    expect(id).toBe('ut-davis:john smith:2026-06-10');
  });
});
