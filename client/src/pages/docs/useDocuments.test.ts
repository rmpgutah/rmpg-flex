import { describe, it, expect } from 'vitest';
import { buildDocsQuery, canEditDocument } from './useDocuments';

describe('buildDocsQuery', () => {
  it('returns bare path with no params', () => {
    expect(buildDocsQuery({})).toBe('/docs');
  });
  it('encodes filters', () => {
    expect(buildDocsQuery({ mine: true, status: 'draft', q: 'foo' }))
      .toBe('/docs?mine=true&status=draft&q=foo');
  });
  it('encodes a call target', () => {
    expect(buildDocsQuery({ targetType: 'call', targetId: 42 }))
      .toBe('/docs?target_type=call&target_id=42');
  });
  it('omits target when id is missing', () => {
    expect(buildDocsQuery({ targetType: 'call' })).toBe('/docs');
  });
  it('encodes limit and offset', () => {
    expect(buildDocsQuery({ limit: 50, offset: 100 })).toBe('/docs?limit=50&offset=100');
  });
});

describe('canEditDocument', () => {
  const draftMine = { status: 'draft' as const, owner_username: 'jdoe' };
  it('blocks when no user', () => {
    expect(canEditDocument(draftMine, null)).toBe(false);
  });
  it('blocks a finalized doc even for admins', () => {
    expect(canEditDocument({ status: 'finalized', owner_username: 'jdoe' }, { username: 'boss', role: 'admin' })).toBe(false);
  });
  it('allows the owner on a draft', () => {
    expect(canEditDocument(draftMine, { username: 'jdoe', role: 'officer' })).toBe(true);
  });
  it('blocks a non-owner non-admin', () => {
    expect(canEditDocument(draftMine, { username: 'other', role: 'officer' })).toBe(false);
  });
  it('allows an admin on a draft they do not own', () => {
    expect(canEditDocument(draftMine, { username: 'boss', role: 'manager' })).toBe(true);
  });
  it('blocks anyone non-admin when owner_username is null', () => {
    expect(canEditDocument({ status: 'draft', owner_username: null }, { username: 'jdoe', role: 'officer' })).toBe(false);
  });
});
