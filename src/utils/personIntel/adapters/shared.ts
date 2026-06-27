import type { SourceResult, RawDataPoint, IntelConnection } from '../types';

export function makeSourceResult(
  sourceName: string,
  phase: 1 | 2 | 3,
  status: SourceResult['status'],
  dataPoints: RawDataPoint[],
  connections: IntelConnection[],
  responseTimeMs: number,
  errorMessage?: string,
): SourceResult {
  return { sourceName, phase, status, dataPoints, connections, responseTimeMs, errorMessage };
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
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
