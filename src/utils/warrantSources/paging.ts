// src/utils/warrantSources/paging.ts
// Pure pagination helpers for chunked full-list sources. No I/O — the adapters
// call fetch() and feed the responses here so the URL/cursor/done logic is
// unit-testable in isolation.

/** Live maxRecordCount for the Arlington ArcGIS layer — the server caps every
 *  query at this many rows regardless of resultRecordCount, so we page by it. */
export const ARCGIS_SERVER_PAGE = 2000;

/** Soft per-tick ingest budget. The arcgis loop stops at the first server-page
 *  boundary at or beyond this count, so a tick stores ~5000–6000 rows. */
export const CHUNK_TARGET = 5000;

interface ArcgisLikeBody { features?: unknown[]; exceededTransferLimit?: boolean }

/** Keyset page after `afterOid`, ordered by OBJECTID so deletions can't make us
 *  skip rows (unlike resultOffset paging). */
export function buildArcgisKeysetUrl(baseUrl: string, afterOid: number, pageSize: number): string {
  const where = encodeURIComponent(`OBJECTID>${afterOid}`);
  const order = encodeURIComponent('OBJECTID ASC');
  return `${baseUrl}/query?where=${where}&outFields=*&orderByFields=${order}` +
         `&resultRecordCount=${pageSize}&returnGeometry=false&f=json`;
}

/** Socrata offset page with a stable :id sort (matches the pre-chunking code). */
export function buildSocrataOffsetUrl(baseUrl: string, resourceId: string, offset: number, pageSize: number): string {
  return `https://${baseUrl}/resource/${resourceId}.json?$limit=${pageSize}&$offset=${offset}&$order=:id`;
}

/** Largest OBJECTID among features; `fallback` when there are none. */
export function maxObjectId(features: { attributes?: Record<string, unknown> }[], fallback: number): number {
  let max = fallback;
  for (const f of features) {
    const v = Number(f.attributes?.OBJECTID);
    if (Number.isFinite(v) && v > max) max = v;
  }
  return max;
}

/** Whether more rows likely remain after this arcgis page: a full page (== the
 *  server cap) or an explicit exceededTransferLimit means keep going; a short
 *  page means the roster is exhausted. */
export function arcgisHasMore(body: ArcgisLikeBody, pageSize: number): boolean {
  if (body.exceededTransferLimit === true) return true;
  return (body.features?.length ?? 0) >= pageSize;
}
