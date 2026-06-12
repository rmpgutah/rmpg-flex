// Review strip for narrative-extracted link suggestions (Intel Wave 1).
// The extraction cron mines call/incident text for known persons, plates,
// and phones; confirming creates the real junction row (call_persons etc.)
// which feeds the graph, associates, and watchlists.
import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../hooks/useApi';

interface Suggestion {
  id: number; source_type: string; source_id: number;
  entity_type: string; entity_id: number;
  extracted_text: string | null; match_basis: string | null;
  entity_label: string | null; source_label: string | null;
}

export default function SuggestedLinksPanel() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const load = useCallback(() => {
    apiFetch<Suggestion[]>('/intel/suggestions?status=pending')
      .then((rows) => setSuggestions(Array.isArray(rows) ? rows : []))
      .catch(() => setSuggestions([]));
  }, []);
  useEffect(load, [load]);

  const decide = async (id: number, action: 'confirm' | 'reject') => {
    await apiFetch(`/intel/suggestions/${id}/${action}`, { method: 'POST' }).catch(console.error);
    load();
  };

  if (!suggestions.length) return null;
  return (
    <div className="bg-[#141414] border border-[#d4a017]">
      <div className="px-2 py-[3px] text-[9px] font-semibold text-[#d4a017] border-b border-[#1a1a1a]">
        SUGGESTED LINKS FROM NARRATIVES ({suggestions.length})
      </div>
      {suggestions.map((s) => (
        <div key={s.id} className="px-2 py-[2px] text-[11px] text-gray-200 flex items-center gap-2 border-b border-[#1a1a1a] last:border-b-0">
          <span className="flex-1 min-w-0 truncate">
            <span className="text-[#d4a017]">{s.entity_label || `${s.entity_type} #${s.entity_id}`}</span>
            <span className="text-[#888888]"> mentioned on </span>
            {s.source_label || `${s.source_type} #${s.source_id}`}
            {s.match_basis && <span className="text-[#888888]"> ({s.match_basis})</span>}
          </span>
          <button onClick={() => decide(s.id, 'confirm')} className="text-[9px] text-[#d4a017] border border-[#222222] px-2 py-[1px]">LINK</button>
          <button onClick={() => decide(s.id, 'reject')} className="text-[9px] text-[#888888] border border-[#222222] px-2 py-[1px]">DISMISS</button>
        </div>
      ))}
    </div>
  );
}
