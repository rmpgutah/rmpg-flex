// ============================================================
// RMPG Flex — persisted attempt-planning context (R6)
// ============================================================
// commitIntake() resolves the address class and parses the client's
// schedule/day/start-date constraints, then writes them to
// serve_queue.parsed_data. Every LATER planning path — the failed-attempt
// re-plan route, the cron auto-replan, and /schedule/backfill — used to
// re-derive an INTERIM address class from `business_id` / `recipient_type`
// and pass NO client constraints at all, so every attempt after the first
// ignored the client's dictated hours. That is the court-exposure case, on
// the path that generates most attempts.
//
// This module is the single reader for that persisted context so the three
// paths cannot drift apart again.
//
// Storage shape (written by commitIntake):
//   parsed_data.client_attempt_schedule   flat, raw ('06:00-09:00;18:00-21:00')
//   parsed_data.service_days_allowed      flat, raw
//   parsed_data.attempt_start_not_before  flat, raw (YYYY-MM-DD)
//   parsed_data._intake.address_class     { klass, confirmed, source }
//
// D-2: `confirmed` is load-bearing. Business TIMING is gated on it in
// selectWindows(); an unconfirmed class yields residential windows.
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import { queryFirst } from './db';
import { log } from './logger';
import { coerceAddressClass, type AddressClass } from './serveAddressClass';
import type { TimeBand } from './serveScheduleParse';
import { parseClientBands, parseAllowedDays } from './serveScheduleParse';

export interface PersistedPlanContext {
  addressClass: AddressClass;
  addressClassConfirmed: boolean;
  clientBands: TimeBand[];
  allowedDays: number[] | null;
  startNotBefore: string | null;
}

/** The columns loadPersistedPlanContext selects — reusable in a batch query so
 *  a loop over many jobs doesn't have to issue one round trip per job. */
export const PLAN_CONTEXT_COLUMNS = `
  json_extract(parsed_data, '$._intake.address_class.klass')     AS klass,
  json_extract(parsed_data, '$._intake.address_class.confirmed') AS confirmed,
  parsed_data->>'client_attempt_schedule'  AS client_attempt_schedule,
  parsed_data->>'service_days_allowed'     AS service_days_allowed,
  parsed_data->>'attempt_start_not_before' AS attempt_start_not_before`;

export interface PlanContextRow {
  klass: string | null;
  confirmed: number | string | null;
  client_attempt_schedule: string | null;
  service_days_allowed: string | null;
  attempt_start_not_before: string | null;
}

function coerceClass(raw: string | null): AddressClass | null {
  return coerceAddressClass(raw);
}

// SQLite json_extract returns integer 1/0 for JSON booleans; be tolerant of a
// string form too rather than trusting one representation.
function coerceConfirmed(raw: number | string | null): boolean {
  if (raw === 1 || raw === '1' || raw === 'true') return true;
  return false;
}

const FALLBACK_CONTEXT: PersistedPlanContext = {
  addressClass: 'unknown',
  addressClassConfirmed: false,
  clientBands: [],
  allowedDays: null,
  startNotBefore: null,
};

/** Pure row → context mapping, for callers that already selected
 *  PLAN_CONTEXT_COLUMNS as part of a larger query. */
export function planContextFromRow(row: PlanContextRow | null | undefined): PersistedPlanContext {
  if (!row) return { ...FALLBACK_CONTEXT };
  const startNotBefore = (row.attempt_start_not_before || '').trim();
  return {
    addressClass: coerceClass(row.klass) ?? 'unknown',
    addressClassConfirmed: coerceConfirmed(row.confirmed),
    clientBands: parseClientBands(row.client_attempt_schedule || ''),
    allowedDays: parseAllowedDays(row.service_days_allowed || ''),
    startNotBefore: /^\d{4}-\d{2}-\d{2}$/.test(startNotBefore) ? startNotBefore : null,
  };
}

/**
 * Read the planning context commitIntake persisted for this queue job.
 *
 * Returns an all-defaults context (unknown / unconfirmed / no client
 * constraints) when the row predates R6 or has no parsed_data — that is the
 * SAFE direction under D-2 (residential windows are strictly wider). It does
 * NOT reconstruct a business class from `business_id`: an unconfirmed
 * business class would not select business timing anyway, so guessing one
 * would only produce a misleading briefing.
 */
export async function loadPersistedPlanContext(
  db: D1Database,
  queueId: number,
): Promise<PersistedPlanContext> {
  let row: PlanContextRow | null = null;
  try {
    row = await queryFirst<PlanContextRow>(
      db,
      `SELECT ${PLAN_CONTEXT_COLUMNS} FROM serve_queue WHERE id = ?`,
      queueId,
    );
  } catch (err) {
    // Fall through to all-defaults (residential / no client constraints) — the
    // safe direction per D-2. Log so the failure is visible in error_log and
    // wrangler tail rather than silently degrading every re-plan for this job.
    log.error('loadPersistedPlanContext: D1 query failed; falling back to all-defaults', { queueId }, err instanceof Error ? err : new Error(String(err)));
  }
  return planContextFromRow(row);
}
