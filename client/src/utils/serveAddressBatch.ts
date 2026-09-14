// client/src/utils/serveAddressBatch.ts
// ─────────────────────────────────────────────────────────────────────────────
// Address-based job batching for the Process Server module.
//
// Multiple jobs at the same physical address can be knocked out in a single
// door-knock — this utility groups them so the UI can surface that opportunity.
// ─────────────────────────────────────────────────────────────────────────────

import type { ServeJob } from '../types';

/**
 * Canonical key for address matching. Normalises case and whitespace so that
 * "123 Main St" and "123 main st  " batch together.
 *
 * Returns null when the job has no address (unbatchable).
 */
export function addressBatchKey(job: ServeJob): string | null {
  const street = job.recipient_address?.trim().toLowerCase();
  if (!street) return null;
  const unit = job.recipient_address_2?.trim().toLowerCase() ?? '';
  const city  = job.recipient_city?.trim().toLowerCase() ?? '';
  return [street, unit, city].filter(Boolean).join('|');
}

export interface AddressBatch {
  key: string;
  /** First job's display address (used as the batch header). */
  displayAddress: string;
  jobs: ServeJob[];
}

/**
 * Groups `jobs` by address. Jobs without an address are placed in a
 * `singles` array (one-element address groups are also singles when the
 * caller only wants true multi-job batches).
 *
 * The order of batches follows the order of first occurrence in `jobs`, so
 * callers can pass a route-ordered list and preserve that ordering.
 */
export function groupByAddress(jobs: ServeJob[]): {
  batches: AddressBatch[];   // groups of ≥2 jobs at the same address
  singles: ServeJob[];       // jobs with no address or unique address
} {
  const keyToJobs = new Map<string, ServeJob[]>();
  const keyOrder: string[] = [];
  const noAddress: ServeJob[] = [];

  for (const job of jobs) {
    const key = addressBatchKey(job);
    if (!key) {
      noAddress.push(job);
      continue;
    }
    if (!keyToJobs.has(key)) {
      keyToJobs.set(key, []);
      keyOrder.push(key);
    }
    keyToJobs.get(key)!.push(job);
  }

  const batches: AddressBatch[] = [];
  const singles: ServeJob[] = [...noAddress];

  for (const key of keyOrder) {
    const group = keyToJobs.get(key)!;
    if (group.length >= 2) {
      batches.push({
        key,
        displayAddress: formatDisplayAddress(group[0]),
        jobs: group,
      });
    } else {
      singles.push(group[0]);
    }
  }

  return { batches, singles };
}

/** Address badge label shown when a job is part of a multi-job batch. */
export function batchCountLabel(count: number): string {
  return `×${count} at address`;
}

function formatDisplayAddress(job: ServeJob): string {
  return [
    job.recipient_address,
    job.recipient_address_2,
    job.recipient_city,
    job.recipient_state,
    job.recipient_zip,
  ].filter(Boolean).join(', ');
}
