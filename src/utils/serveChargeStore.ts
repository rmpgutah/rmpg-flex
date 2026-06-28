// src/utils/serveChargeStore.ts
import type { D1Database } from '@cloudflare/workers-types';
import { query, queryFirst, execute } from './db';
import { computeServeCharges, type PricingItem, type ContractTerms, type ServeJobFacts } from './serveCharges';

export async function loadPricing(db: D1Database): Promise<PricingItem[]> {
  const rows = await query<any>(db, 'SELECT code, label, unit, amount, taxable, attempts_included FROM ps_pricing_items WHERE is_active = 1');
  return rows.map((r) => ({
    code: r.code, label: r.label, unit: r.unit, amount: Number(r.amount) || 0,
    taxable: !!r.taxable, attempts_included: Number(r.attempts_included) || 0,
  }));
}

export async function loadTerms(db: D1Database, contractId: number | null): Promise<ContractTerms> {
  if (!contractId) return { contract_id: null, billing_trigger: 'on_completion', rate_overrides: {} };
  const row = await queryFirst<any>(db, 'SELECT contract_id, billing_trigger, rate_overrides_json FROM ps_contract_terms WHERE contract_id = ?', contractId);
  let overrides: Record<string, number> = {};
  try { overrides = row?.rate_overrides_json ? JSON.parse(row.rate_overrides_json) : {}; } catch { overrides = {}; }
  return {
    contract_id: contractId,
    billing_trigger: row?.billing_trigger ?? 'on_completion',
    rate_overrides: overrides,
  };
}

async function gatherFacts(db: D1Database, serveQueueId: number): Promise<{ facts: ServeJobFacts; contractId: number | null } | null> {
  const job = await queryFirst<any>(db, 'SELECT id, priority, attempt_count, contract_id FROM serve_queue WHERE id = ?', serveQueueId);
  if (!job) return null;
  const skip = await queryFirst<any>(db, 'SELECT 1 AS x FROM serve_skip_traces WHERE serve_queue_id = ? LIMIT 1', serveQueueId);
  return {
    contractId: job.contract_id ?? null,
    facts: {
      serve_queue_id: serveQueueId,
      priority: job.priority ?? 'normal',
      attempt_count: Number(job.attempt_count) || 0,
      has_skip_trace: !!skip,
      mileage: null,
      wait_hours: null,
    },
  };
}

/**
 * Compute and upsert charges for a completed serve job. Idempotent on
 * serve_queue_id. Returns the serve_charges row id, or null on any failure
 * (caller treats billing as best-effort and never lets it break serving).
 * Will NOT overwrite an already-invoiced charge.
 */
export async function generateServeCharges(db: D1Database, serveQueueId: number): Promise<number | null> {
  try {
    const existing = await queryFirst<any>(db, 'SELECT id, status FROM serve_charges WHERE serve_queue_id = ?', serveQueueId);
    if (existing && existing.status === 'invoiced') return existing.id;

    const gathered = await gatherFacts(db, serveQueueId);
    if (!gathered) return null;
    const pricing = await loadPricing(db);
    const terms = await loadTerms(db, gathered.contractId);
    const computed = computeServeCharges(gathered.facts, terms, pricing);

    let chargeId: number;
    if (existing) {
      chargeId = existing.id;
      await execute(db,
        `UPDATE serve_charges SET contract_id = ?, subtotal = ?, computed_at = datetime('now','localtime'), status = 'pending_review' WHERE id = ?`,
        gathered.contractId, computed.subtotal, chargeId);
      await execute(db, 'DELETE FROM serve_charge_lines WHERE serve_charge_id = ?', chargeId);
    } else {
      const ins = await execute(db,
        `INSERT INTO serve_charges (serve_queue_id, contract_id, status, subtotal) VALUES (?, ?, 'pending_review', ?)`,
        serveQueueId, gathered.contractId, computed.subtotal);
      chargeId = Number(ins.meta.last_row_id);
    }
    for (const l of computed.lines) {
      await execute(db,
        `INSERT INTO serve_charge_lines (serve_charge_id, pricing_code, description, quantity, unit_price, line_total, taxable)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        chargeId, l.pricing_code, l.description, l.quantity, l.unit_price, l.line_total, l.taxable ? 1 : 0);
    }
    return chargeId;
  } catch {
    return null;
  }
}
