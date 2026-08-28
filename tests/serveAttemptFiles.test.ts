import { describe, it, expect } from 'vitest';
import {
  clampCopies,
  inferServeFileKind,
  isServeDocumentType,
  parsePhotoIdList,
  serveAttemptR2Key,
} from '../src/utils/serveAttemptFiles';

describe('serveAttemptFiles helpers', () => {
  it('classifies photos, mp3, and documents', () => {
    expect(inferServeFileKind('image/jpeg', 'door.jpg')).toBe('photo');
    expect(inferServeFileKind('audio/mpeg', 'memo.mp3')).toBe('audio');
    expect(inferServeFileKind('application/octet-stream', 'memo.mp3')).toBe('audio');
    expect(inferServeFileKind('application/pdf', 'summons.pdf')).toBe('document');
  });

  it('clamps copy counts', () => {
    expect(clampCopies(2)).toBe(2);
    expect(clampCopies('3')).toBe(3);
    expect(clampCopies(0)).toBeNull();
    expect(clampCopies(400)).toBe(99);
    expect(clampCopies('nope')).toBeNull();
  });

  it('parses photo_ids JSON', () => {
    expect(parsePhotoIdList('["a","b"]')).toEqual(['a', 'b']);
    expect(parsePhotoIdList('not-json')).toEqual([]);
    expect(parsePhotoIdList(null)).toEqual([]);
  });

  it('builds per-attempt R2 keys', () => {
    expect(serveAttemptR2Key(41, 3, 'abc', '.mp3')).toBe('serve/41/attempt-3/abc.mp3');
    expect(serveAttemptR2Key(41, 1, 'abc', 'pdf')).toBe('serve/41/attempt-1/abc.pdf');
  });

  it('accepts known document types only', () => {
    expect(isServeDocumentType('summons')).toBe(true);
    expect(isServeDocumentType('voice_memo')).toBe(true);
    expect(isServeDocumentType('not-a-type')).toBe(false);
  });
});
