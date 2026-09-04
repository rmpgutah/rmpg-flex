// ============================================================
// ServeQueueToolsPanel — surfaces two already-built Worker tools
// ============================================================
// Both endpoints below were fully implemented, deployed, and had
// ZERO client references — the capability existed and nobody could
// reach it:
//
//   POST /serve-queue/detect-duplicates
//     Fuzzy-matches active queue rows on case #, defendant name and
//     address. Duplicate filings are expensive in this business: two
//     servers drive to the same door, and the second attempt muddies
//     the diligence chain on the first.
//
//   POST /serve-queue/priority-score
//     Runs calculateAttemptPriority over open jobs — weights warrants
//     25, protection orders 20, subpoenas 15, plus days-pending,
//     deadline proximity, geography and server availability.
//
// Both are MANUAL, button-triggered. detect-duplicates loops up to
// 100 jobs issuing a query per job, so running it automatically on
// queue load would be a real cost for a check that only matters when
// someone is actually reconciling intake.
// ============================================================

import { useState } from 'react';
import { CopyCheck, ListOrdered, Loader2, AlertTriangle } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { toDisplayLabel } from '../../utils/formatters';

interface DuplicateMatch {
  queueId: number;
  caseNumber: string;
  defendantName: string;
  address: string;
  similarityScore: number;
  matchType: 'exact' | 'fuzzy_name' | 'fuzzy_address' | 'partial';
}
interface DuplicateGroup {
  primary: { queueId: number; caseNumber: string; defendantName: string; address: string };
  matches: DuplicateMatch[];
}
interface ScoredJob {
  queueId: number;
  priority: number;
  breakdown: Record<string, number>;
}

const MATCH_STYLE: Record<DuplicateMatch['matchType'], string> = {
  exact:         'text-red-300 bg-red-900/40 border-red-600/60',
  fuzzy_name:    'text-amber-300 bg-amber-900/30 border-amber-600/50',
  fuzzy_address: 'text-amber-300 bg-amber-900/30 border-amber-600/50',
  partial:       'text-fg-secondary bg-surface-sunken/70 border-border-default/50',
};

export default function ServeQueueToolsPanel() {
  const [dupes, setDupes] = useState<DuplicateGroup[] | null>(null);
  const [dupeBusy, setDupeBusy] = useState(false);
  const [dupeError, setDupeError] = useState<string | null>(null);

  const [scored, setScored] = useState<ScoredJob[] | null>(null);
  const [scoreBusy, setScoreBusy] = useState(false);
  const [scoreError, setScoreError] = useState<string | null>(null);

  const scanDuplicates = async () => {
    setDupeBusy(true);
    setDupeError(null);
    try {
      const res = await apiFetch<{ duplicateGroups: DuplicateGroup[]; count: number }>(
        '/serve-queue/detect-duplicates',
        { method: 'POST', body: JSON.stringify({}) },
      );
      setDupes(res.duplicateGroups ?? []);
    } catch (err) {
      setDupeError(err instanceof Error ? err.message : 'Duplicate scan failed');
    } finally {
      setDupeBusy(false);
    }
  };

  const runScoring = async () => {
    setScoreBusy(true);
    setScoreError(null);
    try {
      const res = await apiFetch<{ scored: ScoredJob[]; count: number }>(
        '/serve-queue/priority-score',
        { method: 'POST', body: JSON.stringify({}) },
      );
      setScored((res.scored ?? []).slice(0, 10));
    } catch (err) {
      setScoreError(err instanceof Error ? err.message : 'Priority scoring failed');
    } finally {
      setScoreBusy(false);
    }
  };

  return (
    <div className="bg-surface-raised border border-rmpg-700 rounded-[2px] p-3 space-y-3">
      <span className="text-[9px] text-fg-muted uppercase font-semibold tracking-wider">Queue Tools</span>

      {/* ── Duplicate detection ── */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <button
            type="button"
            onClick={scanDuplicates}
            disabled={dupeBusy}
            className="inline-flex items-center gap-1 px-2 py-[3px] text-[10px] rounded-[2px] border border-accent-silver-500/50 bg-accent-silver-500/10 text-accent-silver-300 hover:bg-accent-silver-500/20 disabled:opacity-40 transition-colors"
          >
            {dupeBusy ? <Loader2 size={11} className="animate-spin" aria-hidden /> : <CopyCheck size={11} aria-hidden />}
            Scan for duplicates
          </button>
          <span className="text-[9px] text-fg-muted">same defendant or address filed twice</span>
          {dupes !== null && !dupeBusy && (
            <span className={`text-[9px] tabular-nums ml-auto ${dupes.length ? 'text-amber-400' : 'text-green-400'}`}>
              {dupes.length === 0 ? 'No duplicates found' : `${dupes.length} group${dupes.length === 1 ? '' : 's'}`}
            </span>
          )}
        </div>
        {dupeError && <div className="text-[10px] text-red-400">{dupeError}</div>}
        {dupes && dupes.length > 0 && (
          <div className="space-y-1 mt-1">
            {dupes.map((g) => (
              <div key={g.primary.queueId} className="border border-border-default/40 rounded-[2px] p-1.5">
                <div className="text-[10px] text-rmpg-100 font-semibold truncate">
                  #{g.primary.queueId} {g.primary.defendantName || '—'}
                  {g.primary.caseNumber && <span className="text-fg-muted font-normal"> · {g.primary.caseNumber}</span>}
                </div>
                <div className="text-[9px] text-fg-muted truncate mb-1">{g.primary.address}</div>
                {g.matches.map((m) => (
                  <div key={m.queueId} className="flex items-center gap-2 text-[9px] pl-2 border-l-2 border-amber-600/40 py-0.5">
                    <span className={`px-1 rounded-[2px] border ${MATCH_STYLE[m.matchType]}`}>
                      {toDisplayLabel(m.matchType)}
                    </span>
                    <span className="text-rmpg-200">#{m.queueId}</span>
                    <span className="text-fg-secondary truncate">{m.defendantName}</span>
                    <span className="text-fg-muted tabular-nums ml-auto">
                      {Math.round(m.similarityScore * 100)}%
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Priority scoring ── */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <button
            type="button"
            onClick={runScoring}
            disabled={scoreBusy}
            className="inline-flex items-center gap-1 px-2 py-[3px] text-[10px] rounded-[2px] border border-accent-silver-500/50 bg-accent-silver-500/10 text-accent-silver-300 hover:bg-accent-silver-500/20 disabled:opacity-40 transition-colors"
          >
            {scoreBusy ? <Loader2 size={11} className="animate-spin" aria-hidden /> : <ListOrdered size={11} aria-hidden />}
            Score open jobs
          </button>
          <span className="text-[9px] text-fg-muted">warrants &amp; deadlines weighted highest</span>
        </div>
        {scoreError && <div className="text-[10px] text-red-400">{scoreError}</div>}
        {scored && scored.length === 0 && (
          <div className="text-[10px] text-fg-muted">No open jobs to score.</div>
        )}
        {scored && scored.length > 0 && (
          <table className="w-full text-[10px] mt-1">
            <thead>
              <tr className="text-fg-muted text-[9px]">
                <th className="text-left font-semibold py-[3px]">Job</th>
                <th className="text-right font-semibold py-[3px]">Score</th>
                <th className="text-left font-semibold py-[3px] pl-3">Top drivers</th>
              </tr>
            </thead>
            <tbody>
              {scored.map((s) => {
                const drivers = Object.entries(s.breakdown)
                  .filter(([, v]) => v > 0)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 3);
                return (
                  <tr key={s.queueId} className="border-t border-border-subtle">
                    <td className="py-[2px] text-rmpg-200 tabular-nums">#{s.queueId}</td>
                    <td className="py-[2px] text-right text-rmpg-100 font-mono tabular-nums font-semibold">
                      {Math.round(s.priority)}
                    </td>
                    <td className="py-[2px] pl-3 text-fg-muted truncate">
                      {drivers.map(([k, v]) => `${toDisplayLabel(k)} ${Math.round(v)}`).join(' · ') || '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {!dupes && !scored && (
        <div className="flex items-start gap-1.5 text-[9px] text-fg-muted">
          <AlertTriangle size={10} className="mt-px flex-shrink-0" aria-hidden />
          <span>Both scans run on demand — they query every open job, so they are not run automatically.</span>
        </div>
      )}
    </div>
  );
}
