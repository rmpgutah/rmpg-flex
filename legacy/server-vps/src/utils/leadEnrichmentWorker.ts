// ============================================================
// Lead Enrichment Worker
// ============================================================
// Background worker that processes the firecrawl_enrichment_queue.
// Polls every 30 seconds for pending jobs, scrapes target URLs
// via Firecrawl to extract contact info, social profiles, and
// reviews, then updates the CRM lead with enrichment data.
// ============================================================

import { getDb } from '../models/database';
import { firecrawlScrape } from './firecrawlClient';
import { broadcast } from './websocket';
import { localNow } from './timeUtils';

// ── Types ───────────────────────────────────────────────────

interface EnrichmentJob {
  id: number;
  lead_id: number;
  status: string;
  target_url: string | null;
  result_data: string | null;
  error_message: string | null;
  attempts: number;
  max_attempts: number;
  created_at: string;
  completed_at: string | null;
}

// ── Enrichment Extract Schema ───────────────────────────────

const ENRICHMENT_EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    business_name: { type: 'string' },
    phone_numbers: { type: 'array', items: { type: 'string' } },
    email_addresses: { type: 'array', items: { type: 'string' } },
    physical_address: { type: 'string' },
    website: { type: 'string' },
    social_profiles: {
      type: 'object',
      properties: {
        facebook: { type: 'string' },
        twitter: { type: 'string' },
        linkedin: { type: 'string' },
        instagram: { type: 'string' },
        yelp: { type: 'string' },
      },
    },
    hours_of_operation: { type: 'string' },
    description: { type: 'string' },
    reviews_summary: { type: 'string' },
    employee_count: { type: 'string' },
    year_established: { type: 'string' },
    industry: { type: 'string' },
    key_contacts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          title: { type: 'string' },
          email: { type: 'string' },
          phone: { type: 'string' },
        },
      },
    },
  },
};

// ── Worker State ────────────────────────────────────────────

let pollInterval: ReturnType<typeof setInterval> | null = null;
let isProcessing = false;

const POLL_INTERVAL_MS = 30_000; // 30 seconds
const BATCH_SIZE = 3;

// ── Core Processing ─────────────────────────────────────────

async function processEnrichmentQueue(): Promise<void> {
  if (isProcessing) return;
  isProcessing = true;

  try {
    const db = getDb();

    // Fetch pending jobs
    const jobs = db.prepare(`
      SELECT * FROM firecrawl_enrichment_queue
      WHERE status = 'pending' AND attempts < max_attempts
      ORDER BY created_at ASC
      LIMIT ?
    `).all(BATCH_SIZE) as EnrichmentJob[];

    if (jobs.length === 0) return;

    console.log(`[EnrichmentWorker] Processing ${jobs.length} pending job(s)`);

    for (const job of jobs) {
      await processJob(db, job);
    }
  } catch (err) {
    console.error('[EnrichmentWorker] Queue processing error:', err);
  } finally {
    isProcessing = false;
  }
}

async function processJob(db: ReturnType<typeof getDb>, job: EnrichmentJob): Promise<void> {
  const now = localNow();

  // Mark as processing and increment attempts
  db.prepare(`
    UPDATE firecrawl_enrichment_queue
    SET status = 'processing', attempts = attempts + 1
    WHERE id = ?
  `).run(job.id);

  // Update lead status
  db.prepare(
    "UPDATE crm_leads SET enrichment_status = 'processing', updated_at = ? WHERE id = ?"
  ).run(now, job.lead_id);

  // If no target_url, try to get the source_url from the lead
  let targetUrl = job.target_url;
  if (!targetUrl) {
    const lead = db.prepare('SELECT source_url FROM crm_leads WHERE id = ?').get(job.lead_id) as { source_url?: string } | undefined;
    targetUrl = lead?.source_url || null;
  }

  if (!targetUrl) {
    // No URL to scrape — mark as failed
    db.prepare(`
      UPDATE firecrawl_enrichment_queue
      SET status = 'failed', error_message = 'No target URL available', completed_at = ?
      WHERE id = ?
    `).run(now, job.id);

    db.prepare(
      "UPDATE crm_leads SET enrichment_status = 'failed', updated_at = ? WHERE id = ?"
    ).run(now, job.lead_id);

    console.warn(`[EnrichmentWorker] Job ${job.id} (lead ${job.lead_id}): no target URL`);
    return;
  }

  try {
    const result = await firecrawlScrape({
      url: targetUrl,
      formats: ['markdown'],
      onlyMainContent: true,
      extract: {
        schema: ENRICHMENT_EXTRACT_SCHEMA,
        prompt: 'Extract business contact information, social media profiles, reviews, and key personnel from this page.',
      },
    });

    const extractedData = result.data?.extract || {};
    const enrichmentJson = JSON.stringify(extractedData);

    // Mark as completed
    db.prepare(`
      UPDATE firecrawl_enrichment_queue
      SET status = 'completed', result_data = ?, error_message = NULL, completed_at = ?
      WHERE id = ?
    `).run(enrichmentJson, now, job.id);

    // Update lead with enrichment data
    db.prepare(`
      UPDATE crm_leads
      SET enrichment_status = 'completed', enrichment_data = ?, updated_at = ?
      WHERE id = ?
    `).run(enrichmentJson, now, job.lead_id);

    console.log(`[EnrichmentWorker] Job ${job.id} (lead ${job.lead_id}): completed successfully`);

    // Broadcast enrichment completion
    broadcast('crm', 'lead:enriched', {
      lead_id: job.lead_id,
      status: 'completed',
      data: extractedData,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const currentAttempts = (job.attempts || 0) + 1;
    const maxAttempts = job.max_attempts || 3;
    const finalStatus = currentAttempts >= maxAttempts ? 'failed' : 'pending';

    db.prepare(`
      UPDATE firecrawl_enrichment_queue
      SET status = ?, error_message = ?, completed_at = CASE WHEN ? = 'failed' THEN ? ELSE NULL END
      WHERE id = ?
    `).run(finalStatus, errorMsg, finalStatus, now, job.id);

    db.prepare(
      'UPDATE crm_leads SET enrichment_status = ?, updated_at = ? WHERE id = ?'
    ).run(finalStatus, now, job.lead_id);

    console.error(`[EnrichmentWorker] Job ${job.id} (lead ${job.lead_id}): ${finalStatus} — ${errorMsg}`);

    if (finalStatus === 'failed') {
      broadcast('crm', 'lead:enriched', {
        lead_id: job.lead_id,
        status: 'failed',
        error: errorMsg,
      });
    }
  }
}

// ── Public API ──────────────────────────────────────────────

/**
 * Start the enrichment worker poll loop.
 */
export function startEnrichmentWorker(): void {
  if (pollInterval) {
    console.warn('[EnrichmentWorker] Already running');
    return;
  }

  console.log(`[EnrichmentWorker] Starting (poll every ${POLL_INTERVAL_MS / 1000}s)`);

  pollInterval = setInterval(() => {
    processEnrichmentQueue().catch(err =>
      console.error('[EnrichmentWorker] Unhandled error:', err)
    );
  }, POLL_INTERVAL_MS);

  // Unref so the timer doesn't prevent Node.js from exiting
  if (pollInterval.unref) pollInterval.unref();
}

/**
 * Stop the enrichment worker poll loop.
 */
export function stopEnrichmentWorker(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    console.log('[EnrichmentWorker] Stopped');
  }
}
