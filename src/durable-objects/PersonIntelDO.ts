// src/durable-objects/PersonIntelDO.ts
// One instance per dossier (idFromName(`pi-${dossierId}`)). alarm() runs one
// pipeline stage per tick — never blows a single request CPU budget.
// Constructor receives the RAW Bindings object, same pattern as DeepResearchDO.
import type { Bindings } from '../types';
import { execute, query } from '../utils/db';
import type { IntelSeed, RiskFlag } from '../utils/personIntel/types';
import { queryPhase1 } from '../utils/personIntel/phase1';
import { runPhase2 as executePhase2 } from '../utils/personIntel/phase2';
import { runLegalPhase as executeLegalPhase } from '../utils/personIntel/phaseLegal';
import { runPhase3 as executePhase3 } from '../utils/personIntel/phase3';
import { mergeDataPoints } from '../utils/personIntel/confidence';
import { computeRiskScore } from '../utils/personIntel/riskScore';
import { persistCrossRefs } from '../utils/personIntel/crossReference';
import { ensurePersonIntelSchema } from '../utils/personIntel/schema';
import { confirmIdentity, parsePersonName } from '../utils/identityConfirm';
import { applyVerifiedPointsToPerson, autoPromote, shouldPersistPoint } from '../utils/personIntel/applyVerifiedToPerson';

import { log } from '../utils/logger';
interface DOState {
  dossierId: number;
  seed: IntelSeed;
  stage: 'phase1' | 'phase2' | 'phaseLegal' | 'phase3' | 'done' | 'error';
  phase1Points?: any[];
  phase2Points?: any[];
  phase2Connections?: any[];
  riskFlags?: RiskFlag[];
}

const STAGE_GAP_MS = 500;

async function persistSourceResult(db: D1Database, dossierId: number, r: any) {
  await execute(db, `INSERT INTO person_intel_sources (dossier_id,source_name,phase,status,response_time_ms,data_points_found,error_message) VALUES (?,?,?,?,?,?,?)`,
    dossierId, r.sourceName, r.phase, r.status, r.responseTimeMs, r.dataPoints?.length ?? 0, r.errorMessage ?? null);
}

async function persistDataPoints(db: D1Database, dossierId: number, pts: any[]) {
  for (const p of pts) {
    if (!shouldPersistPoint(p.confidence ?? 0)) continue;
    const sources = Array.isArray(p.sources) ? p.sources : [];
    const promoted = autoPromote(p.confidence ?? 0, sources.length) ? 1 : 0;
    await execute(db, `INSERT INTO person_intel_data_points (dossier_id,category,field,value,sources,confidence,verified_by,promoted) VALUES (?,?,?,?,?,?,?,?)`,
      dossierId, p.category, p.field, p.value, JSON.stringify(sources), p.confidence, sources.length, promoted);
  }
}

async function persistConnections(db: D1Database, dossierId: number, conns: any[]) {
  for (const c of conns) {
    await execute(db, `INSERT INTO person_intel_connections (dossier_id,from_subject,relationship,to_subject,confidence,sources) VALUES (?,?,?,?,?,?)`,
      dossierId, c.fromSubject, c.relationship, c.toSubject, c.confidence, JSON.stringify(c.sources));
  }
}

export class PersonIntelDO {
  state: DurableObjectState;
  env: Bindings;

  constructor(state: DurableObjectState, env: Bindings) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const { dossierId, seed } = await request.json<{ dossierId: number; seed: IntelSeed }>();
    await this.state.storage.put<DOState>('s', { dossierId, seed, stage: 'phase1' });
    await execute(this.env.DB, `UPDATE person_intelligence SET status='running', phase=1 WHERE id=?`, dossierId);
    await this.state.storage.setAlarm(Date.now() + STAGE_GAP_MS);
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
  }

  async alarm(): Promise<void> {
    const st = await this.state.storage.get<DOState>('s');
    if (!st) return;

    try {
      await ensurePersonIntelSchema(this.env.DB);
      if (st.stage === 'phase1') await this.runPhase1(st);
      else if (st.stage === 'phase2') await this.runPhase2(st);
      else if (st.stage === 'phaseLegal') await this.runLegalPhase(st);
      else if (st.stage === 'phase3') await this.runPhase3(st);
    } catch (e: any) {
      log.error('handler failed', { src: 'src/durable-objects/PersonIntelDO.ts' }, e);
      await execute(this.env.DB, `UPDATE person_intelligence SET status='error', notes=? WHERE id=?`,
        String(e?.message ?? e).slice(0, 500), st.dossierId);
      st.stage = 'error';
      await this.state.storage.put('s', st);
      return;
    }

    if (st.stage !== 'done') await this.state.storage.setAlarm(Date.now() + STAGE_GAP_MS);
  }

  private async runPhase1(st: DOState) {
    const result = await queryPhase1(this.env.DB, st.seed);
    await persistSourceResult(this.env.DB, st.dossierId, result);
    const merged = mergeDataPoints(result.dataPoints);
    st.phase1Points = merged;
    await execute(this.env.DB, `UPDATE person_intelligence SET phase=1, phase1_completed_at=datetime('now') WHERE id=?`, st.dossierId);
    await persistDataPoints(this.env.DB, st.dossierId, merged);
    st.stage = 'phase2';
    await this.state.storage.put('s', st);
  }

  private async runPhase2(st: DOState) {
    const { sourceResults, mergedPoints, connections, riskFlags } = await executePhase2(this.env.DB, st.seed);
    for (const r of sourceResults) await persistSourceResult(this.env.DB, st.dossierId, r);
    await persistDataPoints(this.env.DB, st.dossierId, mergedPoints);
    await persistConnections(this.env.DB, st.dossierId, connections);
    st.phase2Points = mergedPoints;
    st.phase2Connections = connections;
    st.riskFlags = riskFlags;
    await execute(this.env.DB, `UPDATE person_intelligence SET phase=2, phase2_completed_at=datetime('now'), sources_queried=sources_queried+?, sources_succeeded=sources_succeeded+? WHERE id=?`,
      sourceResults.length, sourceResults.filter(r => r.status === 'success').length, st.dossierId);
    st.stage = 'phaseLegal';
    await this.state.storage.put('s', st);
  }

  private async runLegalPhase(st: DOState) {
    // Cross-reference capture: CourtListener/juriscraper, FBI Wanted,
    // criminal-DB, skip-trace. Persists structured cross-refs into
    // person_intel_cross_refs for officer verification.
    const { sourceResults, mergedPoints, connections, riskFlags: legalFlags, crossRefs } = await executeLegalPhase(this.env.DB, st.seed);
    for (const r of sourceResults) await persistSourceResult(this.env.DB, st.dossierId, r);
    await persistDataPoints(this.env.DB, st.dossierId, mergedPoints);
    await persistConnections(this.env.DB, st.dossierId, connections);

    const capturedBy = await this.env.DB.prepare(`SELECT created_by FROM person_intelligence WHERE id=?`).bind(st.dossierId).first<{ created_by: number }>().catch(() => null);
    const captured = await persistCrossRefs(this.env.DB, st.dossierId, crossRefs, capturedBy?.created_by);

    // Merge the legal/criminal risk flags into the dossier set.
    const mergedFlags: RiskFlag[] = [...(st.riskFlags ?? []), ...legalFlags];
    st.riskFlags = mergedFlags;
    await execute(this.env.DB,
      `UPDATE person_intelligence SET sources_queried=sources_queried+?, sources_succeeded=sources_succeeded+?, cross_refs_found=? WHERE id=?`,
      sourceResults.length, sourceResults.filter(r => r.status === 'success').length, captured, st.dossierId);
    st.stage = 'phase3';
    await this.state.storage.put('s', st);
  }

  private async runPhase3(st: DOState) {
    const knownValues = (st.phase1Points ?? []).concat(st.phase2Points ?? []).map((p: any) => p.value as string).filter(Boolean);
    const { sourceResults, dataPoints, riskFlags: crawlFlags } = await executePhase3(this.env, st.seed, knownValues);
    for (const r of sourceResults) await persistSourceResult(this.env.DB, st.dossierId, r);

    const merged = mergeDataPoints(dataPoints);
    const allRiskFlags: RiskFlag[] = [...(st.riskFlags ?? []), ...crawlFlags];

    // Auto-link only when name + DOB/age confirm a single local person.
    // A unique "John Doe" with no birthday is a lead, not a link.
    let linkedPersonId: number | null = null;
    if (st.seed.name) {
      const { first, last } = parsePersonName(st.seed.name);
      if (first && last) {
        const matches = await this.env.DB.prepare(
          `SELECT id, first_name, last_name, dob, city, state FROM persons
            WHERE UPPER(TRIM(first_name))=UPPER(?) AND UPPER(TRIM(last_name))=UPPER(?) LIMIT 25`,
        ).bind(first, last).all<{ id: number; first_name: string; last_name: string; dob: string | null; city: string | null; state: string | null }>();
        const seedId = {
          first, last, dob: st.seed.dob, age: st.seed.age, city: st.seed.city, state: st.seed.state,
        };
        const confirmed = (matches.results ?? []).filter((p) => confirmIdentity(seedId, {
          first: p.first_name, last: p.last_name, dob: p.dob, city: p.city, state: p.state,
        }).matched);
        if (confirmed.length === 1) linkedPersonId = confirmed[0].id;
      }
    }

    // Check warrants and NSO → additional risk flags
    if (linkedPersonId) {
      const warrant = await this.env.DB.prepare(`SELECT id FROM warrants WHERE subject_person_id=? AND status='active' LIMIT 1`).bind(linkedPersonId).first<{ id: number }>();
      if (warrant) allRiskFlags.push('warrant');
      const sor = await this.env.DB.prepare(`SELECT id FROM national_sex_offenders WHERE person_id=? LIMIT 1`).bind(linkedPersonId).first<{ id: number }>();
      if (sor) allRiskFlags.push('nsopw');
    }

    const uniqueFlags = [...new Set(allRiskFlags)];
    const riskScore = computeRiskScore(uniqueFlags);
    const dataPointsCount = await this.env.DB.prepare(`SELECT COUNT(*) as c FROM person_intel_data_points WHERE dossier_id=?`).bind(st.dossierId).first<{ c: number }>();

    await persistDataPoints(this.env.DB, st.dossierId, merged);
    if (linkedPersonId) {
      const allPts = (st.phase1Points ?? []).concat(st.phase2Points ?? []).concat(merged);
      try {
        await applyVerifiedPointsToPerson(this.env.DB, linkedPersonId, allPts);
      } catch (err) {
        log.error('verified fill onto person failed', { personId: linkedPersonId, dossierId: st.dossierId }, err instanceof Error ? err : undefined);
      }
    }
    await execute(this.env.DB, `UPDATE person_intelligence SET status='complete', phase=3, phase3_completed_at=datetime('now'), completed_at=datetime('now'), risk_score=?, risk_flags=?, linked_person_id=?, data_points_found=? WHERE id=?`,
      riskScore, JSON.stringify(uniqueFlags), linkedPersonId, (dataPointsCount?.c ?? 0), st.dossierId);

    st.stage = 'done';
    await this.state.storage.put('s', st);
  }
}
