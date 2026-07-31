// melotts returns WAV, not MP3. Serving it as audio/mpeg worked only because
// decodeAudioData sniffs the container; the header was a lie and would break
// any consumer that trusted it.
import { describe, it, expect } from 'vitest';
import { contentTypeFor } from '../src/routes/tts';

function wavBytes(): Uint8Array {
  const b = new Uint8Array(16);
  b.set([0x52, 0x49, 0x46, 0x46], 0);  // 'RIFF'
  b.set([0x57, 0x41, 0x56, 0x45], 8);  // 'WAVE'
  return b;
}
function mp3FrameSync(): Uint8Array {
  return new Uint8Array([0xff, 0xfb, 0x90, 0x00, 0, 0, 0, 0]);
}
function mp3Id3(): Uint8Array {
  return new Uint8Array([0x49, 0x44, 0x33, 0x03, 0, 0, 0, 0]); // 'ID3'
}

describe('contentTypeFor', () => {
  it('detects WAV from the RIFF/WAVE magic', () => {
    expect(contentTypeFor(wavBytes())).toBe('audio/wav');
  });

  it('reports MP3 for Aura-2 output (frame sync and ID3)', () => {
    expect(contentTypeFor(mp3FrameSync())).toBe('audio/mpeg');
    expect(contentTypeFor(mp3Id3())).toBe('audio/mpeg');
  });

  it('falls back to audio/mpeg for unknown or short input, never throwing', () => {
    expect(contentTypeFor(new Uint8Array([1, 2, 3, 4]))).toBe('audio/mpeg');
    expect(contentTypeFor(new Uint8Array(0))).toBe('audio/mpeg');
  });

  it('does not mistake RIFF-without-WAVE for a WAV', () => {
    const b = new Uint8Array(16);
    b.set([0x52, 0x49, 0x46, 0x46], 0);          // 'RIFF'
    b.set([0x41, 0x56, 0x49, 0x20], 8);          // 'AVI ' — a RIFF container, not WAVE
    expect(contentTypeFor(b)).toBe('audio/mpeg');
  });
});
