// src/durable-objects/PersonIntelDO.ts
// One instance per dossier (idFromName(`pi-${dossierId}`)). alarm() runs one
// pipeline stage per tick — never blows a single request CPU budget.
// Constructor receives the RAW Bindings object, same pattern as DeepResearchDO.
import type { Bindings } from '../types';
import { execute, query } from '../utils/db';
import type { IntelSeed, RiskFlag } from '../utils/personIntel/types';
import { queryPhase1 } from '../utils/personIntel/phase1';
import { runPhase2 as executePhase2 } from '../utils/personIntel/phase2';
import { runPhase3 as executePhase3 } from '../utils/personIntel/phase3';
import { mergeDataPoints, deriveConfidence } from '../utils/personIntel/confidence';
import { computeRiskScore } from '../utils/personIntel/riskScore';

interface DOState {
  dossierId: number;
  seed: IntelSeed;
  stage: 'phase1' | 'phase2' | 'phase3' | 'done' | 'error';
  phase1Points?: any[];
  phase2Points?: any[];
  phase2Connections?: any[];
  riskFlags?: RiskFlag[];
}

const STAGE_GAP_MS = 500;

async function persistSourceResult(db: D1Database, dossierId: number, r: any) {
  await execute(db, `INSERT INTO person_intel_sources (dossier_id,source_name,phase,status,response_time_ms,data_points_found,error_message) VALUES (?,?,?,?,?,?,?)`,
    [dossierId, r.sourceName, r.phase, r.status, r.responseTimeMs, r.dataPoints?.length ?? 0, r.errorMessage ?? null]);
}

async function persistDataPoints(db: D1Database, dossierId: number, pts: any[]) {
  for (const p of pts) {
    await execute(db, `INSERT INTO person_intel_data_points (dossier_id,category,field,value,sources,confidence) VALUES (?,?,?,?,?,?)`,
      [dossierId, p.category, p.field, p.value, JSON.stringify(p.sources), p.confidence]);
  }
}

async function persistConnections(db: D1Database, dossierId: number, conns: any[]) {
  for (const c of conns) {
    await execute(db, `INSERT INTO person_intel_connections (dossier_id,from_subject,relationship,to_subject,confidence,sources) VALUES (?,?,?,?,?,?)`,
      [dossierId, c.fromSubject, c.relationship, c.toSubject, c.confidence, JSON.stringify(c.sources)]);
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
    await execute(this.env.DB, `UPDATE person_intelligence SET status='running', phase=1 WHERE id=?`, [dossierId]);
    await this.state.storage.setAlarm(Date.now() + STAGE_GAP_MS);
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
  }

  async alarm(): Promise<void> {
    const st = await this.state.storage.get<DOState>('s');
    if (!st) return;

    try {
      if (st.stage === 'phase1') await this.runPhase1(st);
      else if (st.stage === 'phase2') await this.runPhase2(st);
      else if (st.stage === 'phase3') await this.runPhase3(st);
    } catch (e: any) {
      await execute(this.env.DB, `UPDATE person_intelligence SET status='error', notes=? WHERE id=?`,
        [String(e?.message ?? e).slice(0, 500), st.dossierId]);
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
    await execute(this.env.DB, `UPDATE person_intelligence SET phase=1, phase1_completed_at=datetime('now') WHERE id=?`, [st.dossierId]);
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
      [sourceResults.length, sourceResults.filter(r => r.status === 'success').length, st.dossierId]);
    st.stage = 'phase3';
    await this.state.storage.put('s', st);
  }

  private async runPhase3(st: DOState) {
    const knownValues = (st.phase1Points ?? []).concat(st.phase2Points ?? []).map((p: any) => p.value as string).filter(Boolean);
    const { sourceResults, dataPoints, riskFlags: crawlFlags, crawlCorroboration } = await executePhase3(this.env, st.seed, knownValues);
    for (const r of sourceResults) await persistSourceResult(this.env.DB, st.dossierId, r);

    const merged = mergeDataPoints(dataPoints);
    const allRiskFlags: RiskFlag[] = [...(st.riskFlags ?? []), ...crawlFlags];

    // Auto-link: check if persons table has a match
    let linkedPersonId: number | null = null;
    if (st.seed.name) {
      const person = await this.env.DB.prepare(`SELECT id FROM persons WHERE full_name LIKE ? LIMIT 1`).bind(`%${st.seed.name.split(' ')[0]}%`).first<{ id: number }>();
      if (person) linkedPersonId = person.id;
    }

    // Check warrants and NSO → additional risk flags
    if (linkedPersonId) {
      const warrant = await this.env.DB.prepare(`SELECT id FROM warrants WHERE person_id=? AND status='active' LIMIT 1`).bind(linkedPersonId).first<{ id: number }>();
      if (warrant) allRiskFlags.push('warrant');
      const sor = await this.env.DB.prepare(`SELECT id FROM national_sex_offenders WHERE person_id=? LIMIT 1`).bind(linkedPersonId).first<{ id: number }>();
      if (sor) allRiskFlags.push('nsopw');
    }

    const uniqueFlags = [...new Set(allRiskFlags)];
    const riskScore = computeRiskScore(uniqueFlags);
    const dataPointsCount = await this.env.DB.prepare(`SELECT COUNT(*) as c FROM person_intel_data_points WHERE dossier_id=?`).bind(st.dossierId).first<{ c: number }>();

    await persistDataPoints(this.env.DB, st.dossierId, merged);
    await execute(this.env.DB, `UPDATE person_intelligence SET status='complete', phase=3, phase3_completed_at=datetime('now'), completed_at=datetime('now'), risk_score=?, risk_flags=?, linked_person_id=?, data_points_found=? WHERE id=?`,
      [riskScore, JSON.stringify(uniqueFlags), linkedPersonId, (dataPointsCount?.c ?? 0), st.dossierId]);

    st.stage = 'done';
    await this.state.storage.put('s', st);
  }
}
