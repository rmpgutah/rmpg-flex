'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSecondaryWindowUrl, coerceBadgeCount, isValidTrayStatus, formatTrayTooltip, boundsIntersectSomeDisplay, saveWindowBounds, restoreWindowBounds } = require('../windowManager');

const BASE_URL = 'https://rmpgutah.us';

test('buildSecondaryWindowUrl: valid relative path builds the correct URL', () => {
  const result = buildSecondaryWindowUrl(BASE_URL, '/dispatch-board');
  assert.equal(result, 'https://rmpgutah.us/dispatch-board');
});

test('buildSecondaryWindowUrl: valid nested relative path builds the correct URL', () => {
  const result = buildSecondaryWindowUrl(BASE_URL, '/records/case/123');
  assert.equal(result, 'https://rmpgutah.us/records/case/123');
});

test('buildSecondaryWindowUrl: missing leading "/" is rejected', () => {
  const result = buildSecondaryWindowUrl(BASE_URL, 'dispatch-board');
  assert.equal(typeof result, 'object');
  assert.equal(result.ok, false);
  assert.ok(result.error);
});

test('buildSecondaryWindowUrl: absolute external URL is rejected', () => {
  const result = buildSecondaryWindowUrl(BASE_URL, 'http://evil.example.com');
  assert.equal(typeof result, 'object');
  assert.equal(result.ok, false);
  assert.ok(result.error);
});

test('buildSecondaryWindowUrl: https absolute URL is rejected', () => {
  const result = buildSecondaryWindowUrl(BASE_URL, 'https://evil.example.com');
  assert.equal(result.ok, false);
});

test('buildSecondaryWindowUrl: javascript: URL is rejected', () => {
  const result = buildSecondaryWindowUrl(BASE_URL, 'javascript:alert(1)');
  assert.equal(typeof result, 'object');
  assert.equal(result.ok, false);
  assert.ok(result.error);
});

test('buildSecondaryWindowUrl: file: URL is rejected', () => {
  const result = buildSecondaryWindowUrl(BASE_URL, 'file:///etc/passwd');
  assert.equal(result.ok, false);
});

test('buildSecondaryWindowUrl: protocol-relative URL is rejected', () => {
  const result = buildSecondaryWindowUrl(BASE_URL, '//attacker.example.com');
  assert.equal(typeof result, 'object');
  assert.equal(result.ok, false);
  assert.ok(result.error);
});

test('buildSecondaryWindowUrl: non-string routePath is rejected', () => {
  const result = buildSecondaryWindowUrl(BASE_URL, null);
  assert.equal(result.ok, false);
});

test('buildSecondaryWindowUrl: empty string routePath is rejected', () => {
  const result = buildSecondaryWindowUrl(BASE_URL, '');
  assert.equal(result.ok, false);
});

// ─── coerceBadgeCount ───────────────────────────────────────

test('coerceBadgeCount: negative number is clamped to 0', () => {
  assert.equal(coerceBadgeCount(-5), 0);
});

test('coerceBadgeCount: non-numeric string coerces to 0', () => {
  assert.equal(coerceBadgeCount('abc'), 0);
});

test('coerceBadgeCount: null coerces to 0', () => {
  assert.equal(coerceBadgeCount(null), 0);
});

test('coerceBadgeCount: undefined coerces to 0', () => {
  assert.equal(coerceBadgeCount(undefined), 0);
});

test('coerceBadgeCount: float is floored', () => {
  assert.equal(coerceBadgeCount(3.7), 3);
});

test('coerceBadgeCount: value above the cap is clamped to 9999', () => {
  assert.equal(coerceBadgeCount(50000), 9999);
});

test('coerceBadgeCount: normal valid integer is unchanged', () => {
  assert.equal(coerceBadgeCount(5), 5);
});

// ─── isValidTrayStatus ──────────────────────────────────────

test('isValidTrayStatus: "on-shift" is valid', () => {
  assert.equal(isValidTrayStatus('on-shift'), true);
});

test('isValidTrayStatus: "off-shift" is valid', () => {
  assert.equal(isValidTrayStatus('off-shift'), true);
});

test('isValidTrayStatus: "alert" is valid', () => {
  assert.equal(isValidTrayStatus('alert'), true);
});

test('isValidTrayStatus: wrong case "On-Shift" is rejected', () => {
  assert.equal(isValidTrayStatus('On-Shift'), false);
});

test('isValidTrayStatus: wrong case "ON-SHIFT" is rejected', () => {
  assert.equal(isValidTrayStatus('ON-SHIFT'), false);
});

test('isValidTrayStatus: near-match without hyphen "onshift" is rejected', () => {
  assert.equal(isValidTrayStatus('onshift'), false);
});

test('isValidTrayStatus: value with extra whitespace is rejected', () => {
  assert.equal(isValidTrayStatus('on-shift '), false);
  assert.equal(isValidTrayStatus(' on-shift'), false);
});

test('isValidTrayStatus: empty string is rejected', () => {
  assert.equal(isValidTrayStatus(''), false);
});

test('isValidTrayStatus: null is rejected', () => {
  assert.equal(isValidTrayStatus(null), false);
});

test('isValidTrayStatus: undefined is rejected', () => {
  assert.equal(isValidTrayStatus(undefined), false);
});

test('isValidTrayStatus: number is rejected', () => {
  assert.equal(isValidTrayStatus(123), false);
});

test('isValidTrayStatus: unrelated string is rejected', () => {
  assert.equal(isValidTrayStatus('busy'), false);
});

// ─── formatTrayTooltip ──────────────────────────────────────

test('formatTrayTooltip: "on-shift" maps to the expected tooltip', () => {
  assert.equal(formatTrayTooltip('on-shift'), 'RMPG Flex — On Shift');
});

test('formatTrayTooltip: "off-shift" maps to the expected tooltip', () => {
  assert.equal(formatTrayTooltip('off-shift'), 'RMPG Flex — Off Shift');
});

test('formatTrayTooltip: "alert" maps to the expected tooltip', () => {
  assert.equal(formatTrayTooltip('alert'), 'RMPG Flex — ALERT');
});

test('formatTrayTooltip: invalid state returns a fallback, not a throw', () => {
  assert.doesNotThrow(() => formatTrayTooltip('bogus'));
  assert.equal(formatTrayTooltip('bogus'), 'RMPG Flex');
});

// ─── boundsIntersectSomeDisplay ─────────────────────────────

const SINGLE_DISPLAY = [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }];
const TWO_DISPLAYS = [
  { bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
  { bounds: { x: 1920, y: 0, width: 1920, height: 1080 } },
];

test('boundsIntersectSomeDisplay: bounds fully within a single display returns true', () => {
  const bounds = { x: 100, y: 100, width: 800, height: 600 };
  assert.equal(boundsIntersectSomeDisplay(bounds, SINGLE_DISPLAY), true);
});

test('boundsIntersectSomeDisplay: bounds fully outside all displays returns false', () => {
  const bounds = { x: 5000, y: 5000, width: 800, height: 600 };
  assert.equal(boundsIntersectSomeDisplay(bounds, SINGLE_DISPLAY), false);
});

test('boundsIntersectSomeDisplay: bounds partially overlapping a display edge returns true', () => {
  // Mostly off the left edge of display 0, but 50px of it still overlaps.
  const bounds = { x: -750, y: 100, width: 800, height: 600 };
  assert.equal(boundsIntersectSomeDisplay(bounds, SINGLE_DISPLAY), true);
});

test('boundsIntersectSomeDisplay: bounds intersecting the second of multiple displays returns true', () => {
  const bounds = { x: 2000, y: 100, width: 800, height: 600 };
  assert.equal(boundsIntersectSomeDisplay(bounds, TWO_DISPLAYS), true);
});

test('boundsIntersectSomeDisplay: empty displays array returns false', () => {
  const bounds = { x: 100, y: 100, width: 800, height: 600 };
  assert.equal(boundsIntersectSomeDisplay(bounds, []), false);
});

test('boundsIntersectSomeDisplay: missing bounds fields returns false, not a throw', () => {
  assert.doesNotThrow(() => boundsIntersectSomeDisplay({ x: 100, y: 100 }, SINGLE_DISPLAY));
  assert.equal(boundsIntersectSomeDisplay({ x: 100, y: 100 }, SINGLE_DISPLAY), false);
});

test('boundsIntersectSomeDisplay: null bounds returns false, not a throw', () => {
  assert.doesNotThrow(() => boundsIntersectSomeDisplay(null, SINGLE_DISPLAY));
  assert.equal(boundsIntersectSomeDisplay(null, SINGLE_DISPLAY), false);
});

test('boundsIntersectSomeDisplay: undefined displays returns false, not a throw', () => {
  const bounds = { x: 100, y: 100, width: 800, height: 600 };
  assert.doesNotThrow(() => boundsIntersectSomeDisplay(bounds, undefined));
  assert.equal(boundsIntersectSomeDisplay(bounds, undefined), false);
});

// ─── saveWindowBounds ───────────────────────────────────────

test('saveWindowBounds: calls setConfigFn with the JSON-stringified bounds from win.getBounds()', () => {
  const fixedBounds = { x: 50, y: 60, width: 1200, height: 800 };
  const fakeWin = { getBounds: () => fixedBounds };
  const calls = [];
  const setConfigFn = (key, value) => calls.push([key, value]);

  saveWindowBounds(fakeWin, setConfigFn);

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'main_window_bounds');
  assert.equal(calls[0][1], JSON.stringify(fixedBounds));
});

// ─── restoreWindowBounds ────────────────────────────────────

test('restoreWindowBounds: valid stored bounds intersecting a display returns the parsed bounds', () => {
  const stored = { x: 100, y: 100, width: 800, height: 600 };
  const getConfigFn = () => JSON.stringify(stored);
  const getAllDisplaysFn = () => SINGLE_DISPLAY;

  const result = restoreWindowBounds(getConfigFn, getAllDisplaysFn);
  assert.deepEqual(result, stored);
});

test('restoreWindowBounds: no stored value returns null', () => {
  const getConfigFn = () => null;
  const getAllDisplaysFn = () => SINGLE_DISPLAY;

  assert.equal(restoreWindowBounds(getConfigFn, getAllDisplaysFn), null);
});

test('restoreWindowBounds: undefined stored value returns null', () => {
  const getConfigFn = () => undefined;
  const getAllDisplaysFn = () => SINGLE_DISPLAY;

  assert.equal(restoreWindowBounds(getConfigFn, getAllDisplaysFn), null);
});

test('restoreWindowBounds: malformed JSON returns null, not a throw', () => {
  const getConfigFn = () => '{not valid json';
  const getAllDisplaysFn = () => SINGLE_DISPLAY;

  assert.doesNotThrow(() => restoreWindowBounds(getConfigFn, getAllDisplaysFn));
  assert.equal(restoreWindowBounds(getConfigFn, getAllDisplaysFn), null);
});

test('restoreWindowBounds: valid JSON but bounds outside all displays returns null', () => {
  const stored = { x: 5000, y: 5000, width: 800, height: 600 };
  const getConfigFn = () => JSON.stringify(stored);
  const getAllDisplaysFn = () => SINGLE_DISPLAY;

  assert.equal(restoreWindowBounds(getConfigFn, getAllDisplaysFn), null);
});
