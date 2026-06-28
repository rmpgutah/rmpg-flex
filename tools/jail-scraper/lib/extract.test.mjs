import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDate, splitName, joinCharges, rowToBooking, usableBookings, isReal } from './extract.mjs';

test('isReal rejects sentinels', () => {
  for (const v of ['', 'N/A', 'none', '--', null, undefined]) assert.equal(isReal(v), false);
  assert.equal(isReal('Smith'), true);
});

test('normalizeDate handles M/D/Y, M-D-YY, and ISO', () => {
  assert.equal(normalizeDate('6/10/2026'), '2026-06-10');
  assert.equal(normalizeDate('06-10-26'), '2026-06-10');
  assert.equal(normalizeDate('2026-06-10T12:00'), '2026-06-10');
  assert.equal(normalizeDate('n/a'), null);
});

test('splitName handles "Last, First" and "First Last"', () => {
  const a = splitName('Smith, John Q');
  assert.equal(a.first_name, 'John');
  assert.equal(a.last_name, 'Smith');
  const b = splitName('Maria Del Toro');
  assert.equal(b.first_name, 'Maria');
  assert.equal(b.last_name, 'Toro');
});

test('joinCharges joins arrays and cleans strings', () => {
  assert.equal(joinCharges(['Theft', 'Trespass']), 'Theft; Trespass');
  assert.equal(joinCharges('DUI'), 'DUI');
  assert.equal(joinCharges('none'), null);
});

test('rowToBooking maps a scraped row', () => {
  const b = rowToBooking({ name: 'Doe, Jane', dob: '5/5/1985', bookingDate: '6/11/2026', charges: ['DUI'] }, 'Davis');
  assert.equal(b.last_name, 'Doe');
  assert.equal(b.dob, '1985-05-05');
  assert.equal(b.booking_date, '2026-06-11');
  assert.equal(b.charges, 'DUI');
  assert.equal(b.county, 'Davis');
});

test('usableBookings drops identity-less rows', () => {
  const rows = [{ name: 'John Smith' }, { name: '' }, { charges: 'Theft' }];
  assert.equal(usableBookings(rows, 'Weber').length, 1);
});
