// FlateDecode (zlib) decompression via the platform's DecompressionStream API.
// This is the only stream filter the native backend currently understands.
// Everything else (LZW, RunLengthDecode, JBIG2, etc.) triggers a backend
// fallback.
//
// DecompressionStream is supported in all modern browsers + Electron + the
// browsers Capacitor uses on Android/iOS, so no polyfill is required.

import { BackendUnsupportedError } from '../types';

export async function flateDecode(input: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new BackendUnsupportedError('DecompressionStream not available in this runtime');
  }
  const stream = new Blob([input as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) { chunks.push(value); total += value.byteLength; }
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return out;
}
