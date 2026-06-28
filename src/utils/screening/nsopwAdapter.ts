// ============================================================
// RMPG Flex — NSOPW screening adapter.
// ------------------------------------------------------------
// Plugs runNsopwScreening() into the existing screening framework.
// By conforming to the ScreeningAdapter contract, NSOPW
// automatically gets:
//   • cron sweep (runScreeningScans → fetchForPerson for watchlist)
//   • review queue UI (client/src/pages/intel/ReviewQueues.tsx)
//   • confirm/dismiss flow + dossier integration
//   • the false-clear `coverage` guard via the existing
//     /api/screening/search?source=all fan-out.
// ============================================================

import type { Bindings } from '../../types';
import type {
  ScreeningAdapter, NormalizedCandidate, PersonRow, SearchParams,
  MatchResult, ScreeningHitRow,
} from './types';
import { getDb, queryFirst, execute } from '../db';
import {
  runNsopwScreening, screenPersonForSor, ensureNsopwColumns,
  type ClassifiedCandidate, type NsopwOffender,
} from '../nsopw';
import { isConfigured } from '../nsopw/client';
import type { SourceCoverage } from './coverage';

function candidateFromClassified(c: ClassifiedCandidate): NormalizedCandidate {
  return {
    sourceKey: 'nsopw',
    externalId: `${c.offender.jurisdiction}:${c.offender.nsopwOffenderId}`,
    displayName: [c.offender.firstName, c.offender.middleName, c.offender.lastName, c.offender.suffix]
      .filter(Boolean).join(' '),
    summary: summaryOf(c.offender),
    photoUrl: c.offender.photoUrl ?? undefined,
    country: 'US',
    listType: 'nsopw',
    dob: c.offender.dateOfBirth,
    nationalities: ['US'],
    raw: { classification: c.classification, score: c.score, ...c.offender },
  };
}

function summaryOf(o: NsopwOffender): string {
  const parts: string[] = [];
  if (o.jurisdictionLabel || o.jurisdiction) {
    parts.push(o.jurisdictionLabel || o.jurisdiction);
  }
  if (o.offense) parts.push(o.offense);
  if (o.riskLevel) parts.push(`Tier: ${o.riskLevel}`);
  if (o.city || o.state) {
    parts.push([o.city, o.state].filter(Boolean).join(', '));
  }
  return parts.join(' · ');
}

export const nsopwAdapter: ScreeningAdapter = {
  sourceKey: 'nsopw',
  kind: 'sex_offender',
  label: 'NSOPW — National Sex Offender Public Website',
  supportsSearch: true,
  supportsWatch: true,

  // The screening framework calls normalize() on raw rows from
  // legacy paths; NSOPW always goes through runNsopwScreening which
  // returns already-classified candidates, so this is only used in
  // edge cases (e.g. confirm-hit re-marshaling).
  normalize(raw: unknown): NormalizedCandidate {
    if (!raw || typeof raw !== 'object') {
      return {
        sourceKey: 'nsopw', externalId: '', displayName: 'unknown',
        summary: '', listType: 'nsopw', raw,
      };
    }
    const r = raw as Record<string, unknown>;
    const o = (r.offender ?? r) as Record<string, unknown> & Partial<NsopwOffender>;
    const off = o as NsopwOffender;
    return candidateFromClassified({
      offender: off, classification: 'possible', score: 0.6,
      matchedFields: [], reason: 'reconstructed from raw',
    });
  },

  async searchAdHoc(env: Bindings, params: SearchParams): Promise<NormalizedCandidate[]> {
    await ensureNsopwColumns(env).catch(() => {});
    if (!params.name?.trim()) return [];
    const result = await runNsopwScreening(env, {
      surname: params.name ?? '',
      forename: params.forename ?? '',
      // NSOPW search uses DOB. SearchParams doesn't carry it natively,
      // but the framework allows callers to thread it through nationality
      // when needed; mostly we accept that ad-hoc searches don't auto-
      // confirm (no DOB → can't reach score 1.0 → all become 'possible').
      dob: (params as { dob?: string }).dob,
    }, { triggeredBy: 'manual' });

    return [...result.confirmed, ...result.possible].map(candidateFromClassified);
  },

  async fetchForPerson(env: Bindings, person: PersonRow): Promise<NormalizedCandidate[]> {
    if (!person.last_name || !person.first_name) return [];
    const result = await runNsopwScreening(env, {
      surname: person.last_name,
      forename: person.first_name,
      middleName: person.middle_name ?? undefined,
      dob: person.dob ?? undefined,
    }, { triggeredBy: 'cron' });
    return [...result.confirmed, ...result.possible].map(candidateFromClassified);
  },

  scoreMatch(_person: PersonRow, candidate: NormalizedCandidate): MatchResult {
    // The classification already happened inside runNsopwScreening; we
    // unpack the score from `raw` and pass it through. This is the seam
    // that makes the engine respect our strict-vs-possible policy
    // instead of re-running its own generic name match.
    const raw = candidate.raw as { classification?: string; score?: number } | null;
    const classification = raw?.classification ?? 'possible';
    const score = typeof raw?.score === 'number' ? raw.score : 0;
    return {
      score,
      matchedFields: classification === 'confirmed' ? ['surname', 'forename', 'dob']
        : classification === 'possible' ? ['surname', 'partial']
        : [],
      isConfident: classification === 'confirmed',
    };
  },

  async coverage(env: Bindings): Promise<SourceCoverage> {
    const configured = isConfigured(env);
    const db = getDb(env);
    const cnt = await queryFirst<{ n: number }>(
      db, 'SELECT COUNT(*) n FROM national_sex_offenders',
    ).catch(() => null);
    const rowCount = cnt?.n ?? 0;
    if (configured) {
      return { available: true, rowCount, configured: true, severity: 'ok' };
    }
    return {
      available: false,
      rowCount,
      configured: false,
      severity: 'warning',
      message:
        'NSOPW is not configured (NSOPW_API_KEY unset). Nationwide SOR ' +
        'screening is offline; a blank result on the All-sources scan ' +
        'CANNOT confirm that a subject is not a registered offender. ' +
        'Apply for the DOJ NSOPW Web Service MOU and set the secret.',
    };
  },

  async confirmHit(env: Bindings, hit: ScreeningHitRow): Promise<{ promotedRef: string }> {
    if (hit.person_id) {
      // Mark the person as a registered sex offender at the source-of-
      // truth column on persons. external_id format is "JUR:offenderId";
      // we keep the offender side as the sor_number for cross-ref.
      const parts = hit.external_id.split(':');
      const sorNumber = parts.length > 1 ? parts.slice(1).join(':') : hit.external_id;
      await execute(
        getDb(env),
        `UPDATE persons SET is_sex_offender = 1,
           sor_number = COALESCE(NULLIF(sor_number, ''), ?)
         WHERE id = ?`,
        sorNumber, hit.person_id,
      ).catch(() => {});
    }
    return { promotedRef: 'sor_flag' };
  },
};

// Re-export for the records / dispatch auto-trigger hooks. Importing
// directly from `../nsopw` is fine; re-exporting here keeps the
// "everything SOR" surface on the screening namespace.
export { screenPersonForSor };
