// ============================================================
// Person Intel — Phase "Legal": cross-reference capture
// ============================================================
// Runs the four cross-reference sources in parallel and collects structured
// cross-refs for capture. This is the phase that integrates:
//   - freelawproject/juriscraper + courtlistener  → courtlistener adapter
//   - api.fbi.gov                                  → fbiwanted adapter
//   - Premasajjanar criminal-DB model             → criminaldb adapter
//   - WebOlivia/GautaVaid skip-trace model         → skiptracer adapter
// Each adapter degrades to 'not_configured'/'skipped' when its key/table is
// absent, so the phase never crashes the pipeline. Cross-refs are captured
// into person_intel_cross_refs by the DO after this phase returns.
// ============================================================

import type { IntelSeed, SourceResult, RiskFlag, CapturedCrossRef } from './types';
import { fuseResults, type FusionResult } from './fusion';
import { queryCourtListener } from './adapters/courtlistener';
import { queryFbiWantedAdapter } from './adapters/fbiwanted';
import { queryCriminalDb, criminalRiskFlagsFrom } from './adapters/criminaldb';
import { querySkipTracer } from './adapters/skiptracer';
import { collectCrossRefs, xrefRiskFlags } from './crossReference';

export interface LegalPhaseResult extends FusionResult {
  sourceResults: SourceResult[];
  riskFlags: RiskFlag[];
  crossRefs: CapturedCrossRef[];
}

const errorResult = (sourceName: string): SourceResult => ({
  sourceName,
  phase: 2,
  status: 'error',
  dataPoints: [],
  connections: [],
  responseTimeMs: 0,
});

const settled = (r: PromiseSettledResult<SourceResult>, fallback: SourceResult): SourceResult =>
  r.status === 'fulfilled' ? r.value : { ...fallback, status: 'error', errorMessage: String((r as PromiseRejectedResult).reason) };

export async function runLegalPhase(db: D1Database, seed: IntelSeed): Promise<LegalPhaseResult> {
  const riskFlags: RiskFlag[] = [];

  const [cl, fbi, crim, skip] = await Promise.allSettled([
    queryCourtListener(db, seed),
    queryFbiWantedAdapter(db, seed),
    queryCriminalDb(db, seed),
    querySkipTracer(db, seed),
  ]);

  const sourceResults: SourceResult[] = [
    settled(cl, errorResult('CourtListener')),
    settled(fbi, errorResult('FBI_Wanted')),
    settled(crim, errorResult('CriminalDB')),
    settled(skip, errorResult('SkipTracer')),
  ];

  // Fold the per-adapter risk flags into the dossier set.
  for (const r of sourceResults) {
    riskFlags.push(...(r.crossRefs ?? []).flatMap(c => c.riskFlags));
  }
  // criminaldb exports a helper for the deduped set it computed internally.
  const crimResult = sourceResults.find(r => r.sourceName === 'CriminalDB');
  if (crimResult) riskFlags.push(...criminalRiskFlagsFrom(crimResult));

  const crossRefs = collectCrossRefs(sourceResults);
  riskFlags.push(...xrefRiskFlags(crossRefs));

  const fused = fuseResults(sourceResults);
  return {
    ...fused,
    sourceResults,
    riskFlags: [...new Set(riskFlags)],
    crossRefs,
  };
}
