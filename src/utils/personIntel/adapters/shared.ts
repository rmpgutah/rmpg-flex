import type { SourceResult, RawDataPoint, IntelConnection, CapturedCrossRef } from '../types';

export function makeSourceResult(
  sourceName: string,
  phase: 1 | 2 | 3,
  status: SourceResult['status'],
  dataPoints: RawDataPoint[],
  connections: IntelConnection[],
  responseTimeMs: number,
  errorMessage?: string,
  crossRefs?: CapturedCrossRef[],
): SourceResult {
  return { sourceName, phase, status, dataPoints, connections, responseTimeMs, errorMessage, crossRefs };
}

export async function getKey(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare(
    'SELECT config_value FROM system_config WHERE config_key = ? AND is_active = 1 LIMIT 1'
  ).bind(key).first<{ config_value: string }>();
  return row?.config_value ?? null;
}

export async function safeFetch(url: string, init: RequestInit, timeoutMs = 15000): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers = new Headers(init.headers);
    if (!headers.has('User-Agent')) {
      headers.set('User-Agent', 'RMPG-Flex/1.0 (Cloudflare Workers; sworn LE; person-intel)');
    }
    if (!headers.has('Accept')) {
      headers.set('Accept', 'application/json');
    }
    const res = await fetch(url, { ...init, headers, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
