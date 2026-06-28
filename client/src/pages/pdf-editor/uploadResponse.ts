// Dependency-free helpers for the /api/uploads contract.
//
// Kept separate from save.ts so they can be unit-tested without dragging in the
// pdf-lib / pdfjs / RMPG-engine import chain (the engine pulls a Vite
// `?url`-suffixed worker import that a plain vitest run can't resolve).

export interface UploadedRecord {
  file_id: string;
  original_name: string;
}

/**
 * Normalise the `/api/uploads` response into a flat list of uploaded records.
 *
 * The Worker route returns a **bare array** of attachment rows
 * (`[{ file_id, original_name, ... }]`). Older/newer call sites have at various
 * points expected a `{ files: [...] }` envelope that the server never emitted —
 * the source of the recurring "Upload did not return file" failure. This reader
 * accepts every shape we've ever produced so the editor can't dead-end on it:
 *   - bare array:            `[{ file_id }]`
 *   - `{ files: [...] }`     envelope
 *   - `{ file: {...} }` /    single-record envelope
 *   - `{ uploaded: [...] }`  legacy alias
 */
export function normalizeUploadResponse(data: unknown): UploadedRecord[] {
  const pick = (r: any): UploadedRecord => ({
    file_id: String(r?.file_id ?? r?.fileId ?? r?.id ?? ''),
    original_name: String(r?.original_name ?? r?.originalName ?? r?.name ?? 'document.pdf'),
  });
  if (Array.isArray(data)) return data.map(pick).filter((r) => r.file_id);
  const obj = data as any;
  const arr = obj?.files ?? obj?.uploaded ?? obj?.results ?? (obj?.file ? [obj.file] : null);
  if (Array.isArray(arr)) return arr.map(pick).filter((r) => r.file_id);
  if (obj?.file_id || obj?.fileId || obj?.id) {
    const one = pick(obj);
    return one.file_id ? [one] : [];
  }
  return [];
}
