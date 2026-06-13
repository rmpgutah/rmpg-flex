import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import { ShieldAlert } from 'lucide-react';

interface SourceInfo { sourceKey: string; label: string; kind: string; supportsSearch: boolean; }
interface Candidate { sourceKey: string; externalId: string; displayName: string; summary: string; photoUrl?: string; country?: string; listType?: string; dob?: string | null; }
interface Hit { id: number; source_key: string; person_id: number | null; display_name: string; summary: string; match_score: number; matched_fields: string; status: string; }

type Tab = 'search' | 'review' | 'watchlist' | 'sources';

export default function ScreeningPage() {
  const [tab, setTab] = useState<Tab>('search');
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [source, setSource] = useState('interpol-red');
  const [name, setName] = useState(''); const [forename, setForename] = useState(''); const [nationality, setNationality] = useState('');
  const [results, setResults] = useState<Candidate[]>([]);
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { apiFetch<{ data: SourceInfo[] }>('/screening/sources').then((r) => setSources(r.data)).catch(() => {}); }, []);

  const search = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ source });
      if (name) qs.set('name', name);
      if (forename) qs.set('forename', forename);
      if (nationality) qs.set('nationality', nationality);
      const r = await apiFetch<{ data: Candidate[] }>(`/screening/search?${qs}`);
      setResults(r.data ?? []);
    } catch { setResults([]); } finally { setLoading(false); }
  }, [source, name, forename, nationality]);

  const loadHits = useCallback(() => {
    apiFetch<{ data: Hit[] }>('/screening/hits?status=pending').then((r) => setHits(r.data ?? [])).catch(() => setHits([]));
  }, []);
  useEffect(() => { if (tab === 'review') loadHits(); }, [tab, loadHits]);

  const reviewHit = async (id: number, action: 'confirm' | 'dismiss') => {
    await apiFetch(`/screening/hits/${id}/${action}`, { method: 'POST' }).catch(() => {});
    loadHits();
  };

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="PERSON SCREENING" icon={ShieldAlert} />
      <div className="flex gap-2 text-[11px]">
        {(['search', 'review', 'watchlist', 'sources'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1 border border-[#232323] ${tab === t ? 'bg-[#0b0b0b] text-[#d4a017]' : 'text-[#888]'}`}>
            {t.toUpperCase()}
          </button>
        ))}
      </div>

      {tab === 'search' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <select value={source} onChange={(e) => setSource(e.target.value)} className="bg-black border border-[#232323] px-2 py-1 text-[11px]">
              {sources.filter((s) => s.supportsSearch).map((s) => <option key={s.sourceKey} value={s.sourceKey}>{s.label}</option>)}
            </select>
            <input placeholder="Surname" value={name} onChange={(e) => setName(e.target.value)} className="bg-black border border-[#232323] px-2 py-1 text-[11px]" />
            <input placeholder="Forename" value={forename} onChange={(e) => setForename(e.target.value)} className="bg-black border border-[#232323] px-2 py-1 text-[11px]" />
            <input placeholder="Nationality" value={nationality} onChange={(e) => setNationality(e.target.value)} className="bg-black border border-[#232323] px-2 py-1 text-[11px]" />
            <button onClick={search} className="px-3 py-1 border border-[#d4a017] text-[#d4a017] text-[11px]">SEARCH</button>
          </div>
          {loading ? <div className="text-[#888] text-[11px]">Searching…</div> : (
            <table className="w-full text-[11px]">
              <thead><tr className="text-[9px] text-[#888]"><th className="text-left py-[3px]">NAME</th><th className="text-left">SUMMARY</th><th className="text-left">COUNTRY</th><th className="text-left">DOB</th></tr></thead>
              <tbody>
                {results.map((r) => (
                  <tr key={`${r.sourceKey}-${r.externalId}`} className="border-t border-[#121212]">
                    <td className="py-[2px] flex items-center gap-2">{r.photoUrl && <img src={r.photoUrl} alt="" className="w-6 h-6 object-cover" />}{r.displayName}</td>
                    <td>{r.summary}</td><td>{r.country ?? '—'}</td><td>{r.dob ?? '—'}</td>
                  </tr>
                ))}
                {!results.length && <tr><td colSpan={4} className="text-[#888] py-2">No results.</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'review' && (
        <table className="w-full text-[11px]">
          <thead><tr className="text-[9px] text-[#888]"><th className="text-left py-[3px]">PERSON</th><th className="text-left">SOURCE</th><th className="text-left">MATCH</th><th className="text-left">FIELDS</th><th /></tr></thead>
          <tbody>
            {hits.map((h) => (
              <tr key={h.id} className="border-t border-[#121212]">
                <td className="py-[2px]">{h.display_name}</td><td>{h.source_key}</td>
                <td>{Math.round(h.match_score * 100)}%</td><td>{(JSON.parse(h.matched_fields || '[]') as string[]).join(', ')}</td>
                <td className="text-right">
                  <button onClick={() => reviewHit(h.id, 'confirm')} className="px-2 py-[2px] border border-[#d4a017] text-[#d4a017] mr-1">CONFIRM</button>
                  <button onClick={() => reviewHit(h.id, 'dismiss')} className="px-2 py-[2px] border border-[#232323] text-[#888]">DISMISS</button>
                </td>
              </tr>
            ))}
            {!hits.length && <tr><td colSpan={5} className="text-[#888] py-2">No pending hits.</td></tr>}
          </tbody>
        </table>
      )}

      {tab === 'watchlist' && <WatchlistTab />}
      {tab === 'sources' && <SourcesTab sources={sources} />}
    </div>
  );
}

function WatchlistTab() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const load = useCallback(() => { apiFetch<{ data: Record<string, unknown>[] }>('/screening/watchlist').then((r) => setRows(r.data ?? [])).catch(() => setRows([])); }, []);
  useEffect(load, [load]);
  return (
    <table className="w-full text-[11px]">
      <thead><tr className="text-[9px] text-[#888]"><th className="text-left py-[3px]">PERSON</th><th className="text-left">SCOPE</th><th className="text-left">REASON</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={String(r.id)} className="border-t border-[#121212]">
            <td className="py-[2px]">{String(r.first_name ?? '')} {String(r.last_name ?? '')}</td>
            <td>{String(r.source_scope ?? 'all')}</td><td>{String(r.reason ?? '—')}</td>
          </tr>
        ))}
        {!rows.length && <tr><td colSpan={3} className="text-[#888] py-2">No dedicated watch entries (intel-watchlist persons are also screened).</td></tr>}
      </tbody>
    </table>
  );
}

function SourcesTab({ sources }: { sources: SourceInfo[] }) {
  const [status, setStatus] = useState<{ state: Record<string, unknown>[]; pendingCount: number } | null>(null);
  useEffect(() => { apiFetch<{ state: Record<string, unknown>[]; pendingCount: number }>('/screening/status').then(setStatus).catch(() => {}); }, []);
  const byKey = new Map((status?.state ?? []).map((s) => [String(s.source_key), s]));
  return (
    <div className="space-y-2 text-[11px]">
      <div className="text-[#d4a017]">Pending review: {status?.pendingCount ?? 0}</div>
      <table className="w-full">
        <thead><tr className="text-[9px] text-[#888]"><th className="text-left py-[3px]">SOURCE</th><th className="text-left">ENABLED</th><th className="text-left">LAST RUN</th><th className="text-left">ITEMS</th></tr></thead>
        <tbody>
          {sources.map((s) => {
            const st = byKey.get(s.sourceKey);
            return (
              <tr key={s.sourceKey} className="border-t border-[#121212]">
                <td className="py-[2px]">{s.label}</td>
                <td>{st && Number(st.enabled) === 0 ? 'no' : 'yes'}</td>
                <td>{String(st?.last_run_at ?? '—')}</td><td>{String(st?.items_count ?? '—')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
