'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSecondaryWindowUrl, coerceBadgeCount, isValidTrayStatus, formatTrayTooltip } = require('../windowManager');

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
