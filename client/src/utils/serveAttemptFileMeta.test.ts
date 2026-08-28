import { describe, it, expect } from 'vitest';
import { inferServeFileKind } from './serveAttemptFileMeta';

describe('inferServeFileKind (client)', () => {
  it('maps mp3 and images', () => {
    expect(inferServeFileKind('audio/mpeg', 'note.mp3')).toBe('audio');
    expect(inferServeFileKind('image/png', 'door.png')).toBe('photo');
    expect(inferServeFileKind('application/pdf', 'complaint.pdf')).toBe('document');
  });
});
