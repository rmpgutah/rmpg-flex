import { describe, it, expect } from 'vitest';
import { isInlineAudio, parseBytesRange, playbackContentType } from '../src/utils/inlineMedia';

describe('playbackContentType', () => {
  it('maps audio/mp3 and .mp3 to audio/mpeg', () => {
    expect(playbackContentType('audio/mp3', 'memo.MP3')).toBe('audio/mpeg');
    expect(playbackContentType('application/octet-stream', 'door.mp3')).toBe('audio/mpeg');
    expect(playbackContentType('audio/mpeg', 'a.mp3')).toBe('audio/mpeg');
  });

  it('leaves documents alone', () => {
    expect(playbackContentType('application/pdf', 'summons.pdf')).toBe('application/pdf');
  });
});

describe('isInlineAudio', () => {
  it('detects mp3 even when MIME is wrong', () => {
    expect(isInlineAudio('audio/mp3', 'x.mp3')).toBe(true);
    expect(isInlineAudio('application/pdf', 'x.pdf')).toBe(false);
  });
});

describe('parseBytesRange', () => {
  it('returns null when no Range header', () => {
    expect(parseBytesRange(undefined, 1000)).toBeNull();
  });

  it('parses open-ended and closed ranges', () => {
    expect(parseBytesRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
    expect(parseBytesRange('bytes=500-', 1000)).toEqual({ start: 500, end: 999 });
    expect(parseBytesRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
  });

  it('flags unsatisfiable ranges', () => {
    expect(parseBytesRange('bytes=2000-3000', 1000)).toBe('unsatisfiable');
    expect(parseBytesRange('bytes=50-10', 1000)).toBe('unsatisfiable');
  });
});
