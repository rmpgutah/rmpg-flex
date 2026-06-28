// Supervisor review strip for "possible duplicate person" suggestions
// computed by the intel resolution cron. Confirming writes a reversible
// person_canonical pointer on the backend — no rows are merged.
// Renders nothing for non-supervisor roles (the API 403s and we swallow it).
import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../hooks/useApi';

interface Suggestion {
  id: number; person_a: number; person_b: number; score: number; reasons: string;
  a_first: string; a_last: string; a_dob: string | null;
  b_first: string; b_last: string; b_dob: string | null;
}

export default function ResolutionReviewPanel() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const load = useCallback(() => {
    apiFetch<Suggestion[]>('/intel/resolution/suggestions?status=pending')
      .then((rows) => setSuggestions(Array.isArray(rows) ? rows : []))
      .catch(() => setSuggestions([]));
  }, []);
  useEffect(load, [load]);

  const decide = async (id: number, action: 'confirm' | 'reject') => {
    await apiFetch(`/intel/resolution/suggestions/${id}/${action}`, { method: 'POST' }).catch(console.error);
    load();
  };

  if (!suggestions.length) return null;
  return (
    <div className="bg-surface-base border border-[#d4a017]">
      <div className="px-2 py-[3px] text-[9px] font-semibold text-[#d4a017] border-b border-border-default">
        POSSIBLE DUPLICATE PERSONS ({suggestions.length})
      </div>
      {suggestions.map((s) => {
        let reasons: { rule: string; detail: string }[] = [];
        try { reasons = JSON.parse(s.reasons); } catch { /* malformed reasons render empty */ }
        return (
          <div key={s.id} className="px-2 py-[2px] text-[11px] text-rmpg-200 flex items-center gap-2 border-b border-border-default last:border-b-0">
            <span className="flex-1">
              {s.a_first} {s.a_last} {s.a_dob ? `(${s.a_dob})` : ''} ↔ {s.b_first} {s.b_last} {s.b_dob ? `(${s.b_dob})` : ''}
            </span>
            <span className="text-[9px] text-[#888888]">{reasons.map((r) => r.rule).join(', ')} · {(s.score * 100).toFixed(0)}%</span>
            <button onClick={() => decide(s.id, 'confirm')} className="text-[9px] text-[#d4a017] border border-border-default px-2 py-[1px]">SAME PERSON</button>
            <button onClick={() => decide(s.id, 'reject')} className="text-[9px] text-[#888888] border border-border-default px-2 py-[1px]">DIFFERENT</button>
          </div>
        );
      })}
    </div>
  );
}
