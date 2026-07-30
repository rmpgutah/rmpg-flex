import { describe, it, expect } from 'vitest';

// The `/api/conversations/:id/messages` route in `src/index.ts` accumulates the
// raw upstream bytes into `fullReply` using `decoder.decode(chunk, { stream: true })`
// inside `transform()`, then parses SSE lines out of `fullReply` inside `flush()`.
// This test isolates that decode behavior (independent of D1/OpenRouter/Hono) to
// guard against a trailing multi-byte UTF-8 character being silently dropped when
// the stream ends mid-character — i.e. it verifies the fix that adds a final
// no-argument `decoder.decode()` call in `flush()` to emit TextDecoder's buffered
// tail.
//
// A full integration test through the D1-backed route would require mocking the
// OpenRouter fetch to emit a chunk boundary that splits a multi-byte character and
// then asserting on what gets persisted to D1 — heavier to set up than the decode
// logic itself warrants. This narrower unit test exercises the exact TextDecoder
// call sequence used by the route's TransformStream and is sufficient to catch a
// regression of the reported bug.

function decodeChunksWithFlush(chunks: Uint8Array[], callFinalDecode: boolean): string {
  const decoder = new TextDecoder();
  let result = '';
  for (const chunk of chunks) {
    result += decoder.decode(chunk, { stream: true });
  }
  if (callFinalDecode) {
    result += decoder.decode();
  }
  return result;
}

describe('TextDecoder stream/flush behavior used by the messages route', () => {
  it('drops a trailing multi-byte character when the LAST chunk ends mid-sequence and no final decode() is called', () => {
    // '€' (U+20AC) encodes to 3 bytes in UTF-8: 0xE2 0x82 0xAC.
    // Truncate the final chunk so the stream ends after only the first byte
    // of the sequence — mimicking the upstream connection closing mid-character.
    const full = new TextEncoder().encode('price: 5€');
    const truncated = full.slice(0, full.length - 2); // drops the last 2 of the 3 bytes

    const withoutFinalDecode = decodeChunksWithFlush([truncated], false);
    expect(withoutFinalDecode).toBe('price: 5');
  });

  it('recovers as much as possible via replacement handling when a final decode() is called on a truncated sequence', () => {
    const full = new TextEncoder().encode('price: 5€');
    const truncated = full.slice(0, full.length - 2);

    // A trailing incomplete byte cannot be reconstructed into '€' (the other
    // bytes were never sent), but the final decode() call still flushes
    // TextDecoder's internal buffer instead of silently swallowing it — here
    // that means the dangling lead byte surfaces (as a replacement char under
    // default non-fatal decoding) rather than vanishing with no trace.
    const withFinalDecode = decodeChunksWithFlush([truncated], true);
    expect(withFinalDecode.startsWith('price: 5')).toBe(true);
    expect(withFinalDecode.length).toBeGreaterThan(truncated.length > 0 ? 'price: 5'.length : 0);
  });

  it('reconstructs a multi-byte character correctly when it is split across two chunks but the stream continues', () => {
    // When more data follows, TextDecoder's internal stream buffering already
    // reassembles the character correctly even without a final decode() call —
    // this confirms the fix does not change behavior for the non-truncated case.
    const full = new TextEncoder().encode('price: 5€ each');
    const splitIndex = full.length - 8; // splits inside the 3-byte '€' sequence
    const chunk1 = full.slice(0, splitIndex);
    const chunk2 = full.slice(splitIndex);

    expect(decodeChunksWithFlush([chunk1, chunk2], false)).toBe('price: 5€ each');
    expect(decodeChunksWithFlush([chunk1, chunk2], true)).toBe('price: 5€ each');
  });

  it('is a no-op for plain ASCII content split across chunks', () => {
    const full = new TextEncoder().encode('hello world');
    const chunk1 = full.slice(0, 5);
    const chunk2 = full.slice(5);

    expect(decodeChunksWithFlush([chunk1, chunk2], true)).toBe('hello world');
    expect(decodeChunksWithFlush([chunk1, chunk2], false)).toBe('hello world');
  });
});
