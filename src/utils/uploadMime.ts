/** Map a filename extension to a MIME type when the browser sends an empty
 *  or generic Content-Type (common for phone photos dragged onto Dispatch Files). */
const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  heic: 'image/heic',
  heif: 'image/heif',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
  csv: 'text/csv',
  html: 'text/html',
  htm: 'text/html',
  json: 'application/json',
  md: 'text/markdown',
  xml: 'application/xml',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
};

export function mimeFromFilename(name: string): string | null {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  return EXT_MIME[ext] ?? null;
}

/** Prefer a real browser MIME; otherwise infer from the filename. */
export function resolveUploadMime(filename: string, reportedType: string | undefined | null): string {
  const reported = (reportedType || '').trim().toLowerCase();
  if (reported && reported !== 'application/octet-stream') return reported;
  return mimeFromFilename(filename) || reported || 'application/octet-stream';
}
