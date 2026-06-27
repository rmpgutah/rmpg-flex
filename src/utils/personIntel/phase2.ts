import type { IntelSeed, SourceResult, RiskFlag } from './types';
import { fuseResults, type FusionResult } from './fusion';
import { queryMicrobilt } from './adapters/microbilt';
import { queryPipl } from './adapters/pipl';
import { querySpokeo } from './adapters/spokeo';
import { queryNumverify } from './adapters/numverify';
import { queryHunter } from './adapters/hunter';
import { queryHibp } from './adapters/hibp';
import { queryClearbit } from './adapters/clearbit';

export interface Phase2Result extends FusionResult {
  sourceResults: SourceResult[];
  riskFlags: RiskFlag[];
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

export async function runPhase2(db: D1Database, seed: IntelSeed): Promise<Phase2Result> {
  const riskFlags: RiskFlag[] = [];

  const [microbilt, pipl, spokeo, numverify, hunter, hibpResult, clearbit] = await Promise.allSettled([
    queryMicrobilt(db, seed),
    queryPipl(db, seed),
    querySpokeo(db, seed),
    queryNumverify(db, seed),
    queryHunter(db, seed),
    queryHibp(db, seed),
    queryClearbit(db, seed),
  ]);

  const hibp = hibpResult.status === 'fulfilled'
    ? hibpResult.value
    : { result: { ...errorResult('HIBP'), errorMessage: String((hibpResult as PromiseRejectedResult).reason) }, riskFlags: [] as RiskFlag[] };
  riskFlags.push(...hibp.riskFlags);

  const sourceResults: SourceResult[] = [
    settled(microbilt, errorResult('MicroBilt')),
    settled(pipl, errorResult('Pipl')),
    settled(spokeo, errorResult('Spokeo')),
    settled(numverify, errorResult('NumVerify')),
    settled(hunter, errorResult('HunterIO')),
    hibp.result,
    settled(clearbit, errorResult('Clearbit')),
  ];

  const fused = fuseResults(sourceResults);
  return { ...fused, sourceResults, riskFlags };
}
