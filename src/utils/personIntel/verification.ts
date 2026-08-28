// ============================================================
// Cross-reference verification engine
// ============================================================
// An officer verifies a captured cross-reference by supplying evidence for
// a method (DOB / address / phone / email / identifier / officer_review).
// The engine compares the evidence to the cross-ref's matched fields and the
// dossier's known values, returns a verdict (confirmed/rejected/inconclusive)
// and an adjusted confidence, and persists the verdict into
// person_intel_verifications. A cross-ref is only "actionable" once a
// confirmed verification raises its effective confidence above 0.8.
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import type { CrossReference, Verification, VerificationMethod, VerificationResult } from './types';
import { execute, query } from '../db';
import { safeParse } from './crossReference';
import { normalizeDob } from '../normalizeDob';

export interface VerifyInput {
  crossRefId: number;
  method: VerificationMethod;
  /** The officer's stated value (DOB string, address, phone digits, etc.). */
  evidence: string;
  verifiedBy: number;
}

export interface VerifyOutcome {
  result: VerificationResult;
  adjustedConfidence: number;
  reason: string;
}

const DIGITS = (s: string) => (s || '').replace(/\D/g, '');

function compareDob(known: string, evidence: string): 'match' | 'partial' | 'mismatch' | 'none' {
  if (!known || !evidence) return 'none';
  const k = normalizeDob(known) ?? known.trim();
  const e = normalizeDob(evidence) ?? evidence.trim();
  if (k === e) return 'match';
  const kym = k.slice(0, 7);
  const eym = e.slice(0, 7);
  if (kym && eym && kym === eym) return 'partial';
  if (k.slice(0, 4) && k.slice(0, 4) === e.slice(0, 4)) return 'partial';
  return 'mismatch';
}

function compareAddress(known: string, evidence: string): 'match' | 'mismatch' | 'none' {
  if (!known || !evidence) return 'none';
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const k = norm(known);
  const e = norm(evidence);
  if (!k || !e) return 'none';
  if (k === e) return 'match';
  if (k.includes(e) || e.includes(k)) return 'match';
  return 'mismatch';
}

function comparePhone(known: string, evidence: string): 'match' | 'mismatch' | 'none' {
  const k = DIGITS(known);
  const e = DIGITS(evidence);
  if (!k || !e) return 'none';
  // Compare last 10 digits to absorb country-code differences.
  return k.slice(-10) === e.slice(-10) ? 'match' : 'mismatch';
}

function compareEmail(known: string, evidence: string): 'match' | 'mismatch' | 'none' {
  if (!known || !evidence) return 'none';
  return known.trim().toLowerCase() === evidence.trim().toLowerCase() ? 'match' : 'mismatch';
}

/**
 * Compute a verification verdict for a cross-ref. Pure function — no I/O — so
 * it is trivial to unit-test. `knownValues` is the set of values the dossier
 * already corroborates (from matched fields + fused data points).
 */
export function computeVerdict(
  crossRef: CrossReference,
  method: VerificationMethod,
  evidence: string,
  knownValues: string[] = [],
): VerifyOutcome {
  const base = crossRef.confidence;
  const matched = crossRef.matchedFields;

  // Resolve the value the cross-ref claims for this method's field.
  const fieldForMethod: Record<VerificationMethod, string> = {
    dob: 'dob',
    address: 'street',
    phone: 'phone',
    email: 'email',
    identifier: 'identifier',
    officer_review: 'name',
  };
  const fieldKey = fieldForMethod[method];
  const claimed = matched.find(m => m.field === fieldKey)?.value
    ?? matched.find(m => m.field.toLowerCase().includes(fieldKey))?.value
    ?? knownValues.find(v => v.toLowerCase().includes(evidence.toLowerCase().slice(0, 6))) ?? '';

  if (method === 'officer_review') {
    // Officer attestation: a documented review counts, but evidence text is required.
    if (!evidence.trim()) return { result: 'inconclusive', adjustedConfidence: base, reason: 'no officer evidence supplied' };
    return { result: 'confirmed', adjustedConfidence: Math.max(base, 0.7), reason: 'officer documented review' };
  }

  if (!evidence.trim()) {
    return { result: 'inconclusive', adjustedConfidence: base, reason: 'no evidence supplied' };
  }

  let verdict: 'match' | 'partial' | 'mismatch' | 'none' = 'none';
  let methodConfidence = base;

  switch (method) {
    case 'dob': {
      verdict = compareDob(claimed, evidence);
      methodConfidence = 0.9;
      break;
    }
    case 'address': {
      verdict = compareAddress(claimed, evidence);
      methodConfidence = 0.82;
      break;
    }
    case 'phone': {
      verdict = comparePhone(claimed, evidence);
      methodConfidence = 0.85;
      break;
    }
    case 'email': {
      verdict = compareEmail(claimed, evidence);
      methodConfidence = 0.85;
      break;
    }
    case 'identifier': {
      verdict = claimed && claimed.toLowerCase() === evidence.trim().toLowerCase() ? 'match' : 'mismatch';
      methodConfidence = 0.88;
      break;
    }
  }

  if (verdict === 'match') {
    return {
      result: 'confirmed',
      adjustedConfidence: Math.min(0.97, Math.max(base, methodConfidence)),
      reason: `${method} corroborated by external record`,
    };
  }
  if (verdict === 'partial') {
    return {
      result: 'confirmed',
      adjustedConfidence: Math.min(0.9, Math.max(base, methodConfidence - 0.08)),
      reason: `${method} partially corroborated`,
    };
  }
  if (verdict === 'mismatch') {
    return {
      result: 'rejected',
      adjustedConfidence: Math.min(base, 0.05),
      reason: `${method} conflicts with external record`,
    };
  }
  return { result: 'inconclusive', adjustedConfidence: base, reason: `no ${method} on record to compare` };
}

/** Persist a verification + update the cross-ref's effective confidence. */
export async function persistVerification(
  db: D1Database,
  crossRef: CrossReference,
  input: VerifyInput,
  outcome: VerifyOutcome,
): Promise<void> {
  try {
    await execute(
      db,
      `INSERT INTO person_intel_verifications
         (cross_ref_id, method, result, evidence, verified_by, adjusted_confidence, notes)
       VALUES (?,?,?,?,?,?,?)`,
      input.crossRefId,
      input.method,
      outcome.result,
      input.evidence,
      input.verifiedBy,
      outcome.adjustedConfidence,
      outcome.reason,
    );
    // Update the cross-ref's confidence to the verified verdict.
    await execute(
      db,
      `UPDATE person_intel_cross_refs SET confidence=?, verified_result=?
       WHERE id=?`,
      outcome.adjustedConfidence,
      outcome.result,
      input.crossRefId,
    );
  } catch (e) {
    // Degrade — the route asserts on the returned verdict, not res.status.
    throw e;
  }
}

export async function fetchVerifications(db: D1Database, crossRefId: number): Promise<Verification[]> {
  const rows = await query<any>(
    db,
    `SELECT id, cross_ref_id, method, result, evidence, verified_by,
            adjusted_confidence, notes, verified_at
       FROM person_intel_verifications
       WHERE cross_ref_id=? ORDER BY verified_at DESC`,
    crossRefId,
  ).catch(() => []);
  return rows.map((r: any) => ({
    id: r.id,
    crossRefId: r.cross_ref_id,
    method: r.method,
    result: r.result,
    evidence: r.evidence ?? '',
    verifiedBy: r.verified_by,
    verifiedAt: r.verified_at,
    adjustedConfidence: r.adjusted_confidence,
  }));
}

/** Effective confidence = highest verification's adjusted value (confirmed), else base. */
export function effectiveConfidence(crossRef: CrossReference, verifications: Verification[]): number {
  const confirmed = verifications.filter(v => v.result === 'confirmed');
  if (!confirmed.length) {
    const rejected = verifications.filter(v => v.result === 'rejected');
    return rejected.length ? Math.min(crossRef.confidence, 0.05) : crossRef.confidence;
  }
  return Math.max(...confirmed.map(v => v.adjustedConfidence));
}
