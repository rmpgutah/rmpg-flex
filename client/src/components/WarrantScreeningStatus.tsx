// ============================================================
// RMPG Flex — Unified multi-source screening status pane.
// ------------------------------------------------------------
// Embedded on WarrantsListTab's warrant-detail panel; shows hit
// status across ALL registered screening sources (Interpol,
// OFAC, Utah SOR, NSOPW, UDC, etc.) for the warrant's subject —
// not just NSOPW (see WarrantNsopwStatus, which this supersedes
// on the warrant-detail surface but is left in place for other
// consumers). Auto-screened in the background on warrant
// create/update (src/routes/warrants.ts); "Screen Now" re-runs
// on demand via POST /api/screening/screen-person/:id.
// ============================================================

import { useEffect, useState, useCallback } from 'react';
import { ShieldAlert, ShieldCheck, Loader2, RefreshCw, Search } from 'lucide-react';
import { Link } from 'react-router';
import { apiFetch } from '../hooks/useApi';

interface ScreeningHit {
  id: number;
  source_key: string;
  match_score: number;
  status: 'pending' | 'confirmed' | 'dismissed';
  display_name: string | null;
}

interface ScreeningSource {
  sourceKey: string;
  label: string;
}

interface Props {
  personId: number;
  subjectSurname?: string;
}

export default function WarrantScreeningStatus({ personId, subjectSurname }: Props) {
  const [sources, setSources] = useState<ScreeningSource[] | null>(null);
  const [hits, setHits] = useState<ScreeningHit[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [screening, setScreening] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [srcRes, hitsRes] = await Promise.all([
        apiFetch<{ data: ScreeningSource[] }>('/screening/sources'),
        apiFetch<{ data: ScreeningHit[] }>(`/screening/hits?person_id=${personId}`),
      ]);
      setSources(srcRes.data ?? []);
      setHits(hitsRes.data ?? []);
    } catch (err) {
      console.warn('[warrant-screening] load failed:', err);
      setSources([]);
      setHits([]);
    } finally {
      setLoading(false);
    }
  }, [personId]);

  const screenNow = useCallback(async () => {
    setScreening(true);
    try {
      await apiFetch(`/screening/screen-person/${personId}`, { method: 'POST' });
      await load();
    } catch (err) {
      console.warn('[warrant-screening] screen-now failed:', err);
    } finally {
      setScreening(false);
    }
  }, [personId, load]);

  useEffect(() => { void load(); }, [load]);

  if (loading && !sources) {
    return (
      <div className="panel-beveled p-4">
        <h3 className="text-[10px] font-bold text-[var(--brand-gold)] uppercase tracking-widest flex items-center gap-2 mb-3">
          <ShieldCheck className="w-4 h-4 text-[var(--brand-gold)]" /> Screening Status
        </h3>
        <div className="text-[11px] text-rmpg-300 flex items-center gap-1">
          <Loader2 className="w-3 h-3 animate-spin" /> Loading screening status…
        </div>
      </div>
    );
  }

  const hitsBySource = new Map<string, ScreeningHit[]>();
  for (const h of hits ?? []) {
    const list = hitsBySource.get(h.source_key) ?? [];
    list.push(h);
    hitsBySource.set(h.source_key, list);
  }
  const totalActive = (hits ?? []).filter((h) => h.status !== 'dismissed').length;
  const HeaderIcon = totalActive > 0 ? ShieldAlert : ShieldCheck;
  const headerColor = totalActive > 0 ? 'text-red-400' : 'text-green-400';

  return (
    <div className="panel-beveled p-4">
      <h3 className="text-[10px] font-bold text-[var(--brand-gold)] uppercase tracking-widest flex items-center gap-2 mb-3">
        <HeaderIcon className={`w-4 h-4 ${headerColor}`} /> Screening Status — All Sources
        <span className="ml-auto flex items-center gap-2">
          {subjectSurname && (
            <Link
              to={`/screening?surname=${encodeURIComponent(subjectSurname)}`}
              className="toolbar-btn text-[9px]"
              title="Search other sources for this subject"
            >
              <Search className="w-3 h-3" /> Search Other Sources
            </Link>
          )}
          <button type="button" onClick={() => void screenNow()} disabled={screening}
            className="toolbar-btn text-[9px]" title="Screen this subject against all sources now">
            {screening
              ? <Loader2 className="w-3 h-3 animate-spin" />
              : <RefreshCw className="w-3 h-3" />}
            Screen Now
          </button>
        </span>
      </h3>

      <div className="divide-y divide-rmpg-700/40">
        {(sources ?? []).map((s) => {
          const sourceHits = (hitsBySource.get(s.sourceKey) ?? []).filter((h) => h.status !== 'dismissed');
          return (
            <div key={s.sourceKey} className="flex items-center justify-between py-1.5 text-[11px]">
              <span className="text-rmpg-200">{s.label}</span>
              {sourceHits.length > 0
                ? <span className="text-red-400 font-bold">{sourceHits.length} hit{sourceHits.length === 1 ? '' : 's'}</span>
                : <span className="text-green-400">Clear</span>}
            </div>
          );
        })}
        {(sources ?? []).length === 0 && (
          <div className="text-[11px] text-rmpg-400 py-1.5">No screening sources registered.</div>
        )}
      </div>
    </div>
  );
}
