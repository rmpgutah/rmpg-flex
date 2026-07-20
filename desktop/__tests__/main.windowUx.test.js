'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSecondaryWindowUrl } = require('../windowManager');

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
