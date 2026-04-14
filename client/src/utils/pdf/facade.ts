import { apiFetch } from '../../hooks/useApi';
import { downloadRecordPdf } from '../recordPdfGenerator';
import { downloadPdfV2 } from './v2';
import { getV2Schema } from './v2/forms';

let flagsCache: Record<string, boolean> | null = null;
let inflightFetch: Promise<Record<string, boolean>> | null = null;

async function getFlags(): Promise<Record<string, boolean>> {
  if (flagsCache) return flagsCache;
  if (inflightFetch) return inflightFetch;
  inflightFetch = apiFetch<Record<string, boolean>>('/api/admin/pdf-engine/flags')
    .then((r) => { flagsCache = r; return r; })
    .catch(() => ({}))
    .finally(() => { inflightFetch = null; });
  return inflightFetch;
}

export function invalidateFlagsCache(): void { flagsCache = null; }

export async function downloadPdf(formType: string, data: unknown, filename: string): Promise<unknown> {
  const flags = await getFlags();
  const forced = (import.meta as any).env?.VITE_PDF_FORCE_V2 === '1';
  const useV2 = Boolean(flags[formType]) || forced;
  if (useV2) {
    try {
      return await downloadPdfV2(getV2Schema(formType), data, filename);
    } catch (err) {
      console.error('[pdf-v2] rendering failed, falling back to v1', err);
      logPdfEngineFallback(formType, err);
    }
  }
  return await downloadRecordPdf(formType as any, data as any, filename);
}

function logPdfEngineFallback(formType: string, err: unknown): void {
  try {
    const p = apiFetch('/api/audit/pdf-engine-fallback', {
      method: 'POST',
      body: JSON.stringify({ formType, message: (err as Error)?.message }),
    });
    if (p && typeof (p as Promise<unknown>).catch === 'function') {
      (p as Promise<unknown>).catch(() => { /* best-effort */ });
    }
  } catch {
    /* best-effort */
  }
}

// Test hooks — only used by tests
export function _resetFacadeCacheForTest(): void { flagsCache = null; }
export function _setFlagsForTest(flags: Record<string, boolean>): void { flagsCache = flags; }
