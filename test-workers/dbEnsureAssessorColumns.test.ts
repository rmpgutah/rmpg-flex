import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { ensureAssessorColumns, columnExists } from '../src/utils/db';

describe('ensureAssessorColumns — multi-county fields', () => {
  it('adds recorded_document_url and recorded_document_type to parcel_records', async () => {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS parcel_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parcel_number TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL DEFAULT 'sl_county_assessor'
    )`).run();
    await ensureAssessorColumns(env.DB);
    expect(await columnExists(env.DB, 'parcel_records', 'recorded_document_url')).toBe(true);
    expect(await columnExists(env.DB, 'parcel_records', 'recorded_document_type')).toBe(true);
  });
});
