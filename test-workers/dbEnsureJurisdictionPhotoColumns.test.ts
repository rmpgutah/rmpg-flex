import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { ensureJurisdictionAndPhotoColumns, columnExists } from '../src/utils/db';

describe('ensureJurisdictionAndPhotoColumns', () => {
  // Each test needs the base tables the reconciler ALTERs/creates against —
  // shared setup so either test can run alone or in any order, not just
  // when the first test happens to have created them already.
  beforeEach(async () => {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS businesses (id INTEGER PRIMARY KEY)`).run();
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS properties (id INTEGER PRIMARY KEY)`).run();
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS parcel_records (id INTEGER PRIMARY KEY)`).run();
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS business_photos (id INTEGER PRIMARY KEY)`).run();
  });

  it('adds jurisdiction_override to businesses and properties', async () => {
    await ensureJurisdictionAndPhotoColumns(env.DB);

    expect(await columnExists(env.DB, 'businesses', 'jurisdiction_override')).toBe(true);
    expect(await columnExists(env.DB, 'properties', 'jurisdiction_override')).toBe(true);
    expect(await columnExists(env.DB, 'parcel_records', 'photo_url')).toBe(true);
    expect(await columnExists(env.DB, 'parcel_records', 'layout_url')).toBe(true);
    expect(await columnExists(env.DB, 'business_photos', 'kind')).toBe(true);
  });

  it('creates the property_photos table', async () => {
    await ensureJurisdictionAndPhotoColumns(env.DB);
    const row = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='property_photos'`,
    ).first();
    expect(row).not.toBeNull();
  });
});
