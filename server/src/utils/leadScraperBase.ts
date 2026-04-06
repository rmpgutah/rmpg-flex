// ============================================================
// Lead Scraper Base — Shared Utilities
// ============================================================
// Common functions for all CRM lead scrapers: source config,
// logging, dedup upsert, lead scoring, HTTP helpers, and the
// scheduler that starts/stops individual source pollers.
// ============================================================

import { getDb } from '../models/database';
import { localNow } from './timeUtils';

// ── Constants ───────────────────────────────────────────────

const USER_AGENT = 'RMPG-Flex/5.3 (Law Enforcement CAD/RMS)';
const DEFAULT_TIMEOUT_MS = 15_000;
const STARTUP_DELAY_MS = 30_000;

// ── Types ───────────────────────────────────────────────────

export interface SourceConfig {
  id: number;
  source_key: string;
  display_name: string;
  base_url: string | null;
  is_enabled: number;
  poll_interval_seconds: number;
  last_poll_at: string | null;
  last_success_at: string | null;
  consecutive_failures: number;
  total_leads_imported: number;
  api_key_encrypted: string | null;
  extra_config: string | null;
}

export interface LeadUpsertData {
  source: string;
  source_id?: string;
  source_url?: string;
  business_name: string;
  industry?: string;
  sic_code?: string;
  business_type?: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  contact_title?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  latitude?: number;
  longitude?: number;
  estimated_value?: number;
  permit_number?: string;
  registration_date?: string;
  license_number?: string;
  project_type?: string;
  property_size?: string;
  notes?: string;
  service_interest?: string;
}

export interface ScrapeResult {
  source_key: string;
  status: 'success' | 'partial' | 'error';
  records_found: number;
  records_imported: number;
  records_skipped: number;
  error_message?: string;
  duration_ms: number;
}

// ── Source Config ────────────────────────────────────────────

export function getSourceConfig(sourceKey: string): SourceConfig | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM lead_scrape_sources WHERE source_key = ?').get(sourceKey) as SourceConfig | undefined;
  return row || null;
}

export function updateSourceStatus(sourceKey: string, success: boolean, importedCount: number): void {
  const db = getDb();
  const now = localNow();
  if (success) {
    db.prepare(`
      UPDATE lead_scrape_sources
      SET last_poll_at = ?, last_success_at = ?, consecutive_failures = 0,
          total_leads_imported = total_leads_imported + ?, updated_at = ?
      WHERE source_key = ?
    `).run(now, now, importedCount, now, sourceKey);
  } else {
    db.prepare(`
      UPDATE lead_scrape_sources
      SET last_poll_at = ?, consecutive_failures = consecutive_failures + 1, updated_at = ?
      WHERE source_key = ?
    `).run(now, now, sourceKey);
  }
}

// ── Scrape Logging ──────────────────────────────────────────

export function logScrapeRun(
  sourceKey: string,
  status: string,
  found: number,
  imported: number,
  skipped: number,
  errorMsg: string | null,
  durationMs: number,
): void {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO lead_scrape_log (source_key, status, records_found, records_imported, records_skipped, error_message, duration_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(sourceKey, status, found, imported, skipped, errorMsg, durationMs, localNow());
  } catch (err) {
    console.error(`[LeadScraper] Failed to log run for ${sourceKey}:`, err);
  }
}

// ── Lead Scoring ────────────────────────────────────────────

export function calculateLeadScore(lead: Partial<LeadUpsertData>): number {
  let score = 0;

  // Business type match (security-relevant industries)
  const bt = (lead.business_type || lead.industry || '').toLowerCase();
  if (/retail|warehouse|construction|venue|event|club|bar|nightclub|stadium/.test(bt)) {
    score += 30;
  } else if (/office|corporate|professional/.test(bt)) {
    score += 20;
  } else if (bt) {
    score += 10;
  }

  // Estimated value
  const val = lead.estimated_value || 0;
  if (val > 1_000_000) score += 20;
  else if (val > 500_000) score += 15;
  else if (val > 100_000) score += 10;
  else if (val > 0) score += 5;

  // Location proximity
  const city = (lead.city || '').toLowerCase();
  if (city === 'salt lake city' || city === 'slc') {
    score += 20;
  } else if (lead.state === 'UT' || (lead.state || '').toLowerCase() === 'utah') {
    score += 10;
  }

  // Contact info completeness
  if (lead.contact_email) score += 5;
  if (lead.contact_phone) score += 5;
  if (lead.contact_name) score += 5;

  // Legal / collections lead boost
  const si = (lead.service_interest || '').toLowerCase();
  if (si) score += 15; // Has identified service interest

  const src = (lead.source || '').toLowerCase();
  if (src === 'utah_bar' || src === 'ut_courts') score += 10;

  const ind = (lead.industry || '').toLowerCase();
  if (/collection|civil.?lit|debt|creditor|bankrupt|eviction/.test(ind)) score += 10;

  return Math.min(score, 100);
}

// ── Lead Upsert (Dedup) ─────────────────────────────────────

export function upsertLead(data: LeadUpsertData): { inserted: boolean; id: number } {
  const db = getDb();
  const now = localNow();
  const score = calculateLeadScore(data);

  // Use INSERT OR IGNORE to dedup on (source, source_id)
  const result = db.prepare(`
    INSERT OR IGNORE INTO crm_leads (
      source, source_id, source_url, business_name, industry, sic_code, business_type,
      contact_name, contact_email, contact_phone, contact_title,
      address, city, state, zip, latitude, longitude,
      estimated_value, permit_number, registration_date, license_number,
      project_type, property_size, notes, service_interest,
      pipeline_stage, lead_score, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?)
  `).run(
    data.source,
    data.source_id || null,
    data.source_url || null,
    data.business_name,
    data.industry || null,
    data.sic_code || null,
    data.business_type || null,
    data.contact_name || null,
    data.contact_email || null,
    data.contact_phone || null,
    data.contact_title || null,
    data.address || null,
    data.city || null,
    data.state || 'UT',
    data.zip || null,
    data.latitude ?? null,
    data.longitude ?? null,
    data.estimated_value || null,
    data.permit_number || null,
    data.registration_date || null,
    data.license_number || null,
    data.project_type || null,
    data.property_size || null,
    data.notes || null,
    data.service_interest || null,
    score,
    now,
    now,
  );

  const inserted = result.changes > 0;

  if (inserted) {
    return { inserted: true, id: Number(result.lastInsertRowid) };
  }

  // Already exists — look up existing ID
  const existing = db.prepare(
    'SELECT id FROM crm_leads WHERE source = ? AND source_id = ?'
  ).get(data.source, data.source_id || null) as { id: number } | undefined;

  return { inserted: false, id: existing?.id || 0 };
}

// ── HTTP Helpers ────────────────────────────────────────────

export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        ...(options.headers || {}),
      },
    });
    return res;
  } finally {
    clearTimeout(timeout);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Scheduler ───────────────────────────────────────────────

type ScraperFn = () => Promise<ScrapeResult>;

const scraperRegistry = new Map<string, ScraperFn>();
const pollerIntervals = new Map<string, ReturnType<typeof setInterval>>();
let startupTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Register a scraper function for a given source key.
 * Called by each scraper module on import.
 */
export function registerScraper(sourceKey: string, fn: ScraperFn): void {
  scraperRegistry.set(sourceKey, fn);
}

/**
 * Get a registered scraper function by key (used by poll-now endpoint).
 */
export function getRegisteredScraper(sourceKey: string): ScraperFn | undefined {
  return scraperRegistry.get(sourceKey);
}

/**
 * Run a single scrape cycle for a source, with logging and status updates.
 */
export async function runScraper(sourceKey: string): Promise<ScrapeResult> {
  const fn = scraperRegistry.get(sourceKey);
  if (!fn) {
    return {
      source_key: sourceKey,
      status: 'error',
      records_found: 0,
      records_imported: 0,
      records_skipped: 0,
      error_message: `No scraper registered for source: ${sourceKey}`,
      duration_ms: 0,
    };
  }

  const config = getSourceConfig(sourceKey);
  if (!config) {
    return {
      source_key: sourceKey,
      status: 'error',
      records_found: 0,
      records_imported: 0,
      records_skipped: 0,
      error_message: `No source config found for: ${sourceKey}`,
      duration_ms: 0,
    };
  }

  // Circuit breaker: skip if too many consecutive failures
  if (config.consecutive_failures >= 5) {
    console.warn(`[LeadScraper] ${sourceKey}: skipping due to ${config.consecutive_failures} consecutive failures`);
    return {
      source_key: sourceKey,
      status: 'error',
      records_found: 0,
      records_imported: 0,
      records_skipped: 0,
      error_message: `Circuit breaker: ${config.consecutive_failures} consecutive failures`,
      duration_ms: 0,
    };
  }

  try {
    const result = await fn();
    const success = result.status === 'success' || result.status === 'partial';
    updateSourceStatus(sourceKey, success, result.records_imported);
    logScrapeRun(sourceKey, result.status, result.records_found, result.records_imported, result.records_skipped, result.error_message || null, result.duration_ms);
    return result;
  } catch (err: any) {
    const errorMsg = err.message || String(err);
    updateSourceStatus(sourceKey, false, 0);
    logScrapeRun(sourceKey, 'error', 0, 0, 0, errorMsg, 0);
    console.error(`[LeadScraper] ${sourceKey}: unhandled error:`, errorMsg);
    return {
      source_key: sourceKey,
      status: 'error',
      records_found: 0,
      records_imported: 0,
      records_skipped: 0,
      error_message: errorMsg,
      duration_ms: 0,
    };
  }
}

/**
 * Start all enabled lead scrapers on their configured intervals.
 */
export function scheduleLeadScrapers(): void {
  const db = getDb();
  const sources = db.prepare('SELECT * FROM lead_scrape_sources WHERE is_enabled = 1').all() as SourceConfig[];

  if (sources.length === 0) {
    console.log('[LeadScrapers] No enabled sources found');
    return;
  }

  console.log(`[LeadScrapers] Starting ${sources.length} enabled source(s)`);

  // Initial poll after startup delay
  startupTimer = setTimeout(() => {
    for (const source of sources) {
      if (scraperRegistry.has(source.source_key)) {
        console.log(`[LeadScrapers] Initial poll: ${source.source_key}`);
        runScraper(source.source_key).catch(err =>
          console.error(`[LeadScrapers] Initial poll failed for ${source.source_key}:`, err)
        );
      }
    }
  }, STARTUP_DELAY_MS);

  // Set up recurring intervals
  for (const source of sources) {
    if (!scraperRegistry.has(source.source_key)) {
      console.warn(`[LeadScrapers] No scraper registered for enabled source: ${source.source_key}`);
      continue;
    }

    const intervalMs = (source.poll_interval_seconds || 86400) * 1000;
    const handle = setInterval(() => {
      runScraper(source.source_key).catch(err =>
        console.error(`[LeadScrapers] Scheduled poll failed for ${source.source_key}:`, err)
      );
    }, intervalMs);
    if (handle.unref) handle.unref();

    pollerIntervals.set(source.source_key, handle);
    console.log(`[LeadScrapers] Scheduled ${source.source_key} every ${source.poll_interval_seconds}s`);
  }
}

/**
 * Stop all running lead scraper pollers.
 */
export function stopLeadScrapers(): void {
  if (startupTimer) {
    clearTimeout(startupTimer);
    startupTimer = null;
  }
  for (const [key, handle] of pollerIntervals) {
    clearInterval(handle);
    console.log(`[LeadScrapers] Stopped ${key}`);
  }
  pollerIntervals.clear();
}
