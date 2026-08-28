/** File extension used when mirroring a serve-intake document into the training R2 layout. */
export function corpusObjectExt(fileType: string | null | undefined): string {
  const t = (fileType || '').toLowerCase();
  if (t.includes('png')) return '.png';
  if (t.includes('jpeg') || t.includes('jpg')) return '.jpg';
  if (t.includes('tif')) return '.tif';
  if (t.includes('pdf')) return '.pdf';
  if (t.startsWith('image/')) return '.bin';
  return '.bin';
}

/** Keys tesstrain can consume as a page image (not the original PDF). */
export function isTesstrainRasterKey(key: string): boolean {
  return /\/(image|page-\d+)\.(png|jpe?g|tif|tiff)$/i.test(key);
}

export function pageNumberFromRasterKey(key: string): number | null {
  const m = key.match(/\/page-(\d+)\.(png|jpe?g|tif|tiff)$/i);
  if (!m) return null;
  return parseInt(m[1], 10);
}

export function rasterExtFromKey(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase() || 'png';
  if (ext === 'jpeg') return 'jpg';
  return ext;
}
