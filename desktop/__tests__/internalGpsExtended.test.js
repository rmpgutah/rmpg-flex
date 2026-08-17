'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseVTG, parseGLL, parseGSV, classifyFixQuality } = require('../internalGps');

// ── VTG ───────────────────────────────────────────────────────
test('parseVTG: extracts speed and heading', () => {
  // $GPVTG,054.7,T,034.4,M,005.5,N,010.2,K,A*27
  const fields = ['$GPVTG', '054.7', 'T', '034.4', 'M', '005.5', 'N', '010.2', 'K', 'A'];
  const r = parseVTG(fields);
  assert.ok(r);
  assert.ok(Math.abs(r.speedMs - 5.5 * 0.514444) < 0.01); // knots → m/s
  assert.ok(Math.abs(r.heading - 54.7) < 0.1);
});

test('parseVTG: returns null when mode is V (no fix)', () => {
  const fields = ['$GPVTG', '', 'T', '', 'M', '', 'N', '', 'K', 'V'];
  assert.equal(parseVTG(fields), null);
});

test('parseVTG: returns null on bad input', () => {
  assert.equal(parseVTG([]), null);
  assert.equal(parseVTG(null), null);
});

// ── GLL ───────────────────────────────────────────────────────
test('parseGLL: extracts lat/lng when status is A', () => {
  // $GPGLL,4916.45,N,12311.12,W,225444,A*31
  const fields = ['$GPGLL', '4916.45', 'N', '12311.12', 'W', '225444', 'A'];
  const r = parseGLL(fields);
  assert.ok(r);
  assert.ok(Math.abs(r.lat - 49.274) < 0.001);
  assert.ok(r.lng < 0); // West
});

test('parseGLL: returns null when status is V', () => {
  const fields = ['$GPGLL', '4916.45', 'N', '12311.12', 'W', '225444', 'V'];
  assert.equal(parseGLL(fields), null);
});

// ── GSV ───────────────────────────────────────────────────────
test('parseGSV: parses satellites in view', () => {
  // $GPGSV,2,1,08,01,40,083,46,02,17,308,41,12,07,344,39,14,22,228,45*75
  const fields = ['$GPGSV', '2', '1', '08', '01', '40', '083', '46', '02', '17', '308', '41', '12', '07', '344', '39', '14', '22', '228', '45'];
  const r = parseGSV(fields);
  assert.ok(r);
  assert.equal(r.satsInView, 8);
  assert.equal(r.sats.length, 4);
  assert.equal(r.sats[0].prn, 1);
  assert.equal(r.sats[0].snr, 46);
});

test('parseGSV: returns null on bad input', () => {
  assert.equal(parseGSV([]), null);
  assert.equal(parseGSV(null), null);
});

// ── Fix quality ───────────────────────────────────────────────
test('classifyFixQuality: excellent when HDOP < 1 and sats >= 8', () => {
  assert.equal(classifyFixQuality(0.8, 10), 'excellent');
});

test('classifyFixQuality: good when HDOP < 2 and sats >= 5', () => {
  assert.equal(classifyFixQuality(1.5, 6), 'good');
});

test('classifyFixQuality: degraded when HDOP < 5', () => {
  assert.equal(classifyFixQuality(3.0, 3), 'degraded');
});

test('classifyFixQuality: poor when HDOP >= 5', () => {
  assert.equal(classifyFixQuality(6.0, 2), 'poor');
});

test('classifyFixQuality: none when no fix data', () => {
  assert.equal(classifyFixQuality(null, null), 'none');
  assert.equal(classifyFixQuality(undefined, 0), 'none');
});

// ── Dead reckoning — projectPosition ─────────────────────────
const { projectPosition } = require('../internalGps');

test('projectPosition: projects north at 10 m/s for 1 second', () => {
  // Starting at (40.0, -111.0), heading 0° (north), speed 10 m/s, 1000 ms
  const r = projectPosition(40.0, -111.0, 0, 10, 1000);
  assert.ok(r.lat > 40.0);          // moved north
  assert.ok(Math.abs(r.lng - (-111.0)) < 0.0001); // no east/west movement
});

test('projectPosition: projects east at 10 m/s for 1 second', () => {
  const r = projectPosition(40.0, -111.0, 90, 10, 1000);
  assert.ok(Math.abs(r.lat - 40.0) < 0.0001);
  assert.ok(r.lng > -111.0);        // moved east
});

test('projectPosition: returns same point when speed is 0', () => {
  const r = projectPosition(40.0, -111.0, 270, 0, 5000);
  assert.ok(Math.abs(r.lat - 40.0) < 0.000001);
  assert.ok(Math.abs(r.lng - (-111.0)) < 0.000001);
});
