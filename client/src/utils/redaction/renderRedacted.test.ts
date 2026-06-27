// client/src/utils/redaction/renderRedacted.test.ts
import { describe, it, expect } from 'vitest';
import { pickRecorderFormat } from './renderRedacted';

describe('pickRecorderFormat', () => {
  it('prefers MP4/H.264 when supported (court-friendly, what investigators expect)', () => {
    const fmt = pickRecorderFormat(() => true); // everything supported
    expect(fmt).not.toBeNull();
    expect(fmt!.ext).toBe('mp4');
    expect(fmt!.mimeType).toMatch(/^video\/mp4/);
  });

  it('falls back to WebM when MP4 recording is unavailable (e.g. Firefox)', () => {
    const fmt = pickRecorderFormat((m) => m.startsWith('video/webm'));
    expect(fmt).not.toBeNull();
    expect(fmt!.ext).toBe('webm');
    expect(fmt!.mimeType).toMatch(/^video\/webm/);
  });

  it('returns null when nothing is supported so the caller can surface an honest error', () => {
    expect(pickRecorderFormat(() => false)).toBeNull();
  });

  it('honours the candidate preference order (first supported wins)', () => {
    // Only the bare containers supported — should still pick mp4 over webm.
    const fmt = pickRecorderFormat((m) => m === 'video/mp4' || m === 'video/webm');
    expect(fmt!.mimeType).toBe('video/mp4');
    expect(fmt!.ext).toBe('mp4');
  });
});
