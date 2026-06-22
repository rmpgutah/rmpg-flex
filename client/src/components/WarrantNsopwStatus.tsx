// ============================================================
// RMPG Flex — Warrant ⇄ NSOPW status pane.
// ------------------------------------------------------------
// Embedded on WarrantsPage warrant-detail; shows the NSOPW
// federated SOR cross-reference status for the warrant's
// subject_person_id. NSOPW is the primary SOR data retention
// system under warrants: when a warrant is created, the
// warrants.ts route fires screenPersonForSor() in the
// background, which populates screening_hits. This pane reads
// /api/nsopw/person/:id/hits and renders confirmed +
// possible matches with the local photo (if persisted).
// ============================================================

import { useEffect, useState, useCallback } from 'react';
import { Shield, ShieldAlert, ShieldCheck, Loader2, RefreshCw, ExternalLink } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';

interface NsopwHit {
  id: number;
  source_key: string;
  external_id: string;
  match_score: number;
  matched_fields: string;
  status: 'pending' | 'confirmed' | 'dismissed';
  display_name: string | null;
  summary: string | null;
  photo_url: string | null;
  list_type: string | null;
  reviewed_at: string | null;
  last_seen_at: string;
}

interface HitsResponse { data: NsopwHit[]; }

interface Props { personId: number; }

export default function WarrantNsopwStatus({ personId }: Props) {
  const [hits, setHits] = useState<NsopwHit[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [rescreening, setRescreening] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiFetch<HitsResponse>(`/nsopw/person/${personId}/hits`);
      setHits(r.data ?? []);
    } catch (err) {
      console.warn('[warrant-nsopw] load failed:', err);
      setHits([]);
    } finally {
      setLoading(false);
    }
  }, [personId]);

  const rescreen = useCallback(async () => {
    setRescreening(true);
    try {
      await apiFetch(`/nsopw/screen-person/${personId}`, { method: 'POST' });
      await load();
    } catch (err) {
      console.warn('[warrant-nsopw] rescreen failed:', err);
    } finally {
      setRescreening(false);
    }
  }, [personId, load]);

  useEffect(() => { void load(); }, [load]);

  if (loading && !hits) {
    return (
      <div className="panel-beveled p-4">
        <h3 className="text-[10px] font-bold text-[#d4a017] uppercase tracking-widest flex items-center gap-2 mb-3">
          <Shield className="w-4 h-4 text-[#d4a017]" /> NSOPW Status
        </h3>
        <div className="text-[11px] text-rmpg-300 flex items-center gap-1">
          <Loader2 className="w-3 h-3 animate-spin" /> Loading nationwide SOR status…
        </div>
      </div>
    );
  }

  const confirmed = hits?.filter((h) => h.match_score >= 1.0) ?? [];
  const possible = hits?.filter((h) => h.match_score < 1.0 && h.status !== 'dismissed') ?? [];
  const total = confirmed.length + possible.length;

  const headerIcon = confirmed.length > 0 ? ShieldAlert : ShieldCheck;
  const HeaderIcon = headerIcon;
  const headerColor = confirmed.length > 0 ? 'text-red-400'
    : possible.length > 0 ? 'text-amber-400' : 'text-green-400';

  return (
    <div className="panel-beveled p-4">
      <h3 className="text-[10px] font-bold text-[#d4a017] uppercase tracking-widest flex items-center gap-2 mb-3">
        <HeaderIcon className={`w-4 h-4 ${headerColor}`} /> NSOPW Status — Nationwide Sex Offender Registry
        <span className="ml-auto flex items-center gap-2">
          {total > 0 && (
            <span className={`text-[10px] ${headerColor} font-bold`}>
              {confirmed.length} confirmed · {possible.length} possible
            </span>
          )}
          <button type="button" onClick={() => void rescreen()} disabled={rescreening}
            className="toolbar-btn text-[9px]" title="Re-screen subject against NSOPW now">
            {rescreening
              ? <Loader2 className="w-3 h-3 animate-spin" />
              : <RefreshCw className="w-3 h-3" />}
            Re-screen
          </button>
        </span>
      </h3>

      {total === 0 && (
        <div className="bg-green-950/30 border border-green-700/40 text-green-300 text-[11px] px-3 py-2">
          No nationwide SOR matches for the warrant subject. Auto-screened at
          warrant creation; re-screen above for a fresh federated query.
        </div>
      )}

      {confirmed.length > 0 && (
        <div className="bg-red-950/40 border border-red-700/60 mb-2">
          <div className="px-2 py-1 border-b border-red-700/60 text-[10px] font-bold uppercase tracking-wider text-red-300">
            Confirmed Matches — Name + DOB Exact
          </div>
          <div className="divide-y divide-rmpg-700/40">
            {confirmed.map((h) => <HitRow key={h.id} hit={h} />)}
          </div>
        </div>
      )}

      {possible.length > 0 && (
        <div className="bg-amber-950/30 border border-amber-700/50">
          <div className="px-2 py-1 border-b border-amber-700/50 text-[10px] font-bold uppercase tracking-wider text-amber-300">
            Possible Matches — Officer Review
          </div>
          <div className="divide-y divide-rmpg-700/40">
            {possible.map((h) => <HitRow key={h.id} hit={h} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function HitRow({ hit }: { hit: NsopwHit }) {
  // external_id format: "JUR:offenderId" — split for the jurisdiction badge.
  const [jur, ...rest] = (hit.external_id || '').split(':');
  const restStr = rest.join(':');
  return (
    <div className="px-3 py-2 flex items-start gap-3">
      {hit.photo_url ? (
        <img src={hit.photo_url} alt="" className="w-12 h-16 object-cover bg-surface-sunken flex-shrink-0" />
      ) : (
        <div className="w-12 h-16 bg-surface-sunken" />
      )}
      <div className="flex-1 min-w-0 text-[11px]">
        <div className="font-bold text-rmpg-100">{hit.display_name || 'Unknown'}</div>
        {hit.summary && <div className="text-rmpg-200 text-[10px]">{hit.summary}</div>}
        <div className="text-[9px] text-rmpg-400 mt-0.5">
          <span className="font-bold">{jur || '?'}</span>
          {restStr && <span className="ml-1">{restStr}</span>}
          <span className="ml-2">score {hit.match_score.toFixed(2)}</span>
          <span className="ml-2">first seen {new Date(hit.last_seen_at).toLocaleDateString()}</span>
        </div>
      </div>
      <a href={`/nsopw#offender/${hit.external_id}`}
        className="text-[10px] underline text-rmpg-300 hover:text-white flex-shrink-0 flex items-center gap-0.5">
        Detail <ExternalLink className="w-2.5 h-2.5" />
      </a>
    </div>
  );
}
