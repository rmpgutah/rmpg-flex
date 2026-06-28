// ============================================================
// RMPG Flex — v2 audit-emitting apiFetch wrapper
// ------------------------------------------------------------
// Drop-in replacement for `apiFetch` inside /fleet/v2/* code. Identical
// success path (resolves with the typed response). On failure, fires
// emitFleetV2ApiError → POST /api/audit-emit so the FleetV2 Health tab's
// "API errors (24h)" cell shows a real number (was always 0 — the audit
// hook was exported but never wired). AbortError (component unmount, route
// change) is propagated as-is without emitting; cancellation is not an
// error worth tracking.
// ============================================================

import { apiFetch } from '../../../../hooks/useApi';
import { emitFleetV2ApiError } from './useFleetV2Audit';

interface ApiError extends Error {
  status?: number;
  payload?: unknown;
  code?: string;
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

function statusFromError(err: ApiError): number {
  if (typeof err.status === 'number' && Number.isFinite(err.status)) return err.status;
  // Fallback for the bare `throw new Error(\`HTTP ${status}\`)` path in useApi.ts
  const m = err.message?.match(/\b(?:HTTP|status)\s*(\d{3})\b/i) ?? err.message?.match(/\b(\d{3})\b/);
  return m ? parseInt(m[1], 10) : 0;
}

export async function apiFetchV2<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    return await apiFetch<T>(path, init);
  } catch (err) {
    if (isAbortError(err)) throw err;                                  // don't track cancellations
    const e = err as ApiError;
    emitFleetV2ApiError(path, statusFromError(e), e.message ?? 'Unknown error');
    throw err;
  }
}
