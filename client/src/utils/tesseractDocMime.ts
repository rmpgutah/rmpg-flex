export function isPdfBytes(bytes: Uint8Array, mime: string | null | undefined): boolean {
  const t = (mime || '').toLowerCase();
  if (t.includes('pdf')) return true;
  return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

export function isImageMime(mime: string | null | undefined): boolean {
  return (mime || '').toLowerCase().startsWith('image/');
}
