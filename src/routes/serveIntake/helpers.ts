// Shared helpers, constants, and reconcilers for serve-intake routes.
// Extracted from the monolithic serveIntake.ts to keep each sub-route file focused.

import type { D1Database } from '@cloudflare/workers-types';
import { log } from '../../utils/logger';
import type { Env } from '../../types';
import { getDb, execute, columnExists } from '../../utils/db';
import { getContainer } from '@cloudflare/containers';
import { loadFlags } from '../adminDev';
import { ocrImage, ocrText } from '../../utils/serveIntakeOcr';
import type { ExtractionResult, PdfTextResult } from '../../utils/serveIntakeExtract';
import { putEncrypted } from '../../utils/encryptedR2';

// ── Migration 0140 runtime reconciler ───────────────────────
let scheduleSchemaReconciled = false;
export async function reconcileScheduleSchema(db: D1Database): Promise<void> {
  if (scheduleSchemaReconciled) return;
  let allOk = true;

  for (const [name, type] of [
    ['manually_moved', 'INTEGER NOT NULL DEFAULT 0'],
    ['moved_by_user_id', 'INTEGER'],
    ['moved_at', 'TEXT'],
    ['auto_replan_source', 'INTEGER'],
    ['officer_id', 'INTEGER'],
  ] as const) {
    try {
      if (!(await columnExists(db, 'serve_attempt_schedules', name))) {
        await execute(db, `ALTER TABLE serve_attempt_schedules ADD COLUMN ${name} ${type}`);
      }
    } catch (err) { log.warn(`[serve-intake] reconcile ${name} failed`, { name, error: err instanceof Error ? err.message : String(err) }); allOk = false; }
  }

  for (const [name, type] of [
    ['geo_cluster_id', 'TEXT'],
    ['urgency_tier', 'TEXT'],
    ['urgency_computed_at', 'TEXT'],
  ] as const) {
    try {
      if (!(await columnExists(db, 'serve_queue', name))) {
        await execute(db, `ALTER TABLE serve_queue ADD COLUMN ${name} ${type}`);
      }
    } catch (err) { log.warn(`[serve-intake] reconcile ${name} failed`, { name, error: err instanceof Error ? err.message : String(err) }); allOk = false; }
  }

  for (const [name, type] of [
    ['updated_at', "TEXT NOT NULL DEFAULT (datetime('now'))"],
  ] as const) {
    try {
      if (!(await columnExists(db, 'serve_attempt_schedules', name))) {
        await execute(db, `ALTER TABLE serve_attempt_schedules ADD COLUMN ${name} ${type}`);
      }
    } catch (err) { log.warn(`[serve-intake] reconcile ${name} failed`, { name, error: err instanceof Error ? err.message : String(err) }); allOk = false; }
  }

  if (allOk) scheduleSchemaReconciled = true;
}

// ── Migration 0152 runtime reconciler ───────────────────────
let qualityGateReconciled = false;
export async function ensureQualityGateColumns(db: D1Database): Promise<void> {
  if (qualityGateReconciled) return;
  let allOk = true;

  try {
    await execute(db, `CREATE TABLE IF NOT EXISTS serve_intake_judge_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      model TEXT NOT NULL,
      ms INTEGER NOT NULL,
      raw_response TEXT,
      flagged_field_count INTEGER NOT NULL DEFAULT 0,
      overall_status TEXT NOT NULL,
      fallback_chain TEXT NOT NULL,
      upload_user_id INTEGER
    )`);
  } catch (err) {
    log.warn('[serve-intake] judge_runs create failed', { error: err instanceof Error ? err.message : String(err) });
    allOk = false;
  }

  for (const [name, type] of [
    ['quality_status', "TEXT NOT NULL DEFAULT 'clean'"],
    ['judge_run_id', 'INTEGER'],
    ['quality_reviewed_by', 'INTEGER'],
    ['quality_reviewed_at', 'TEXT'],
  ] as const) {
    try {
      if (!(await columnExists(db, 'serve_queue', name))) {
        await execute(db, `ALTER TABLE serve_queue ADD COLUMN ${name} ${type}`);
      }
    } catch (err) {
      log.warn(`[serve-intake] reconcile ${name} failed`, { name, error: err instanceof Error ? err.message : String(err) });
      allOk = false;
    }
  }

  if (allOk) qualityGateReconciled = true;
}

// ── Role guard ──────────────────────────────────────────────
export function requireRole(c: { get: (k: 'user') => { role: string } | undefined }, ...roles: string[]): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}

// ── Validation sets ─────────────────────────────────────────
export const PRIORITIES = new Set(['routine', 'normal', 'rush', 'urgent']);
export const STATUSES = new Set(['pending', 'assigned', 'in_progress', 'served', 'attempted', 'failed', 'cancelled', 'archived']);
export const ATTEMPT_RESULTS = new Set([
  'served', 'sub_served', 'posted', 'no_answer', 'refused',
  'bad_address', 'moved', 'deceased', 'other',
]);
export const REPLAN_RESULTS = new Set(['no_answer', 'refused', 'bad_address', 'moved']);

// ── OCR + upload constants ──────────────────────────────────
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_FILES_PER_UPLOAD = 30;
export const PDF_TOOLS_NAME = 'shared';
export const INTAKE_ROLES = ['admin', 'manager', 'supervisor', 'dispatcher', 'officer'];

export function isPdf(mime: string): boolean { return mime === 'application/pdf'; }
export function isImage(mime: string): boolean { return mime.startsWith('image/'); }

export function emptyExtraction(model: string, error?: string): ExtractionResult {
  return {
    success: false, documentType: 'other', confidence: 0,
    fields: {} as Record<string, any>, rawText: '', allDates: [],
    model, ms: 0, error,
  };
}

export const MIN_CLIENT_TEXT_CHARS = 200;
export const CONTAINER_TIMEOUT_MS = 12_000;
export const TOMARKDOWN_TIMEOUT_MS = 8_000;
export const EMPTY_PDF_TEXT: PdfTextResult = { text: '', source: 'empty', structured: false, page_count: 0 };
export const AI_TIMEOUT_MS = 45_000;
const TESSERACT_CONTAINER_NAME = 'shared';

export async function ocrImageWithTesseractGate(
  env: Env['Bindings'], bytes: Uint8Array, mime: string,
): Promise<ExtractionResult> {
  let tesseractEnabled = false;
  try {
    const flags = await loadFlags(env.KV);
    tesseractEnabled = flags.tesseract_ocr_primary;
  } catch {
    tesseractEnabled = false;
  }

  if (tesseractEnabled) {
    try {
      const form = new FormData();
      form.append('image', new Blob([bytes], { type: mime }), 'input');
      const container = getContainer(env.TESSERACT_OCR, TESSERACT_CONTAINER_NAME);
      const res = await container.fetch(new Request('http://container/ocr', { method: 'POST', body: form }));
      if (res.ok) {
        const body = await res.json() as { text?: string };
        const text = (body.text ?? '').trim();
        if (text.length >= 20) {
          const extraction = await ocrText(env, text);
          if (extraction.success) {
            return { ...extraction, model: `tesseract+${extraction.model}` };
          }
        }
      }
    } catch {
      // Fall through to existing chain
    }
  }

  return ocrImage(env, bytes, mime);
}

export async function storeToR2(env: Env['Bindings'], file: File, uploaderId: number | null): Promise<string> {
  const ts = Date.now();
  const safeName = (file.name || 'upload').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  const key = `serve-intake/${uploaderId ?? 'anon'}/${ts}-${crypto.randomUUID().slice(0, 8)}-${safeName}`;
  await putEncrypted(env.UPLOADS, getDb(env), env, key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
  });
  return key;
}

export function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '""';
  const s = typeof v === 'string' ? v : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}
