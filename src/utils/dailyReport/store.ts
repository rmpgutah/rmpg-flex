// ============================================================
// RMPG Flex — Daily Blotter: R2 storage
// ============================================================
// R2 is the single source of truth for which reports exist — by-month
// is built from a list, so there is no index table that can drift from
// the objects.
//
// parseReportKey is also the security boundary: the download route
// resolves a caller-supplied filename THROUGH it rather than
// interpolating it into a key, so traversal is structurally impossible.
// ============================================================

import type { R2Bucket, R2ObjectBody } from '@cloudflare/workers-types';

const PREFIX = 'daily-reports/';
const FILENAME_RE = /^rmpg-daily-(\d{4})-(\d{2})-(\d{2})\.pdf$/;

export interface StoredReport {
  filename: string;
  date: string;
  size: number;
  generated_at: string;
}

export function reportFilename(date: string): string {
  return `rmpg-daily-${date}.pdf`;
}

export function reportKey(date: string): string {
  const [y, m] = date.split('-');
  return `${PREFIX}${y}/${m}/${reportFilename(date)}`;
}

/** Accepts a full key or a bare filename. Returns null for anything that
 *  is not an exact, well-formed report name — including traversal. */
export function parseReportKey(input: string): { date: string; filename: string } | null {
  if (!input || input.includes('..')) return null;
  const filename = input.slice(input.lastIndexOf('/') + 1);
  const m = FILENAME_RE.exec(filename);
  if (!m) return null;
  const [, y, mo, d] = m;
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = `${y}-${mo}-${d}`;
  // Reject impossible dates (e.g. 2026-02-31) by round-tripping.
  const probe = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(probe.getTime()) || probe.toISOString().slice(0, 10) !== date) return null;
  return { date, filename };
}

export async function putReport(bucket: R2Bucket, date: string, bytes: Uint8Array): Promise<void> {
  await bucket.put(reportKey(date), bytes, {
    httpMetadata: { contentType: 'application/pdf' },
    customMetadata: { generated_at: new Date().toISOString(), report_date: date },
  });
}

export async function getReport(bucket: R2Bucket, filename: string): Promise<R2ObjectBody | null> {
  const parsed = parseReportKey(filename);
  if (!parsed) return null;
  return bucket.get(reportKey(parsed.date));
}

export async function hasReport(bucket: R2Bucket, date: string): Promise<boolean> {
  return (await bucket.head(reportKey(date))) !== null;
}

/** Every stored report, newest first. Paginates — R2 list caps at 1000. */
export async function listReports(bucket: R2Bucket): Promise<StoredReport[]> {
  const out: StoredReport[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: PREFIX, limit: 1000, cursor, include: ['customMetadata'] });
    for (const obj of page.objects) {
      const parsed = parseReportKey(obj.key);
      if (!parsed) continue;
      out.push({
        filename: parsed.filename,
        date: parsed.date,
        size: obj.size,
        generated_at: obj.customMetadata?.generated_at ?? obj.uploaded.toISOString(),
      });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return out;
}
