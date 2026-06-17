import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { resolveSourceKey } from '../utils/screeningSource';

function parseFields(raw: string | null | undefined): string[] {
  try { const v = JSON.parse(raw || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

interface SourceInfo { sourceKey: string; label: string; kind: string; supportsSearch: boolean; }
interface Candidate { sourceKey: string; externalId: string; displayName: string; summary: string; photoUrl?: string; country?: string; listType?: string; dob?: string | null; }
interface Hit { id: number; source_key: string; person_id: number | null; display_name: string; summary: string; match_score: number; matched_fields: string; status: string; }
interface Coverage { available: boolean; rowCount?: number; configured?: boolean; severity: 'ok' | 'warning'; message?: string; }
interface SourceCoverage extends Coverage { sourceKey: string; label: string; }

type Tab = 'search' | 'review' | 'watchlist' | 'sources';

export function ScreeningWorkspace() {
  const { user } = useAuth();
  const canReview = ['admin', 'manager', 'supervisor'].includes(user?.role ?? '');
  const [tab, setTab] = useState<Tab>('search');
  const [sources, setSources] = useState<SourceInfo[]>([]);
  // Manual-entry combobox: free text resolved to a source key (or 'all') on search.
  const [sourceText, setSourceText] = useState('All sources');
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [name, setName] = useState(''); const [forename, setForename] = useState(''); const [nationality, setNationality] = useState('');
  const [results, setResults] = useState<Candidate[]>([]);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [coverages, setCoverages] = useState<SourceCoverage[]>([]);
  const [searched, setSearched] = useState(false);
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { apiFetch<{ data: SourceInfo[] }>('/screening/sources').then((r) => setSources(r.data)).catch(() => {}); }, []);

  const labelFor = useCallback((key: string) => sources.find((s) => s.sourceKey === key)?.label ?? key, [sources]);

  const search = useCallback(async () => {
    const resolved = resolveSourceKey(sourceText, sources);
    if (!resolved) {
      setSourceError('Unknown registry — choose from the list or type "All sources".');
      return;
    }
    setSourceError(null);
    setLoading(true);
    try {
      const qs = new URLSearchParams({ source: resolved });
      if (name) qs.set('name', name);
      if (forename) qs.set('forename', forename);
      if (nationality) qs.set('nationality', nationality);
      const r = await apiFetch<{ data: Candidate[]; coverage?: Coverage; coverages?: SourceCoverage[] }>(`/screening/search?${qs}`);
      setResults(r.data ?? []);
      setCoverage(r.coverage ?? null);
      setCoverages(r.coverages ?? []);
    } catch { setResults([]); setCoverage(null); setCoverages([]); } finally { setSearched(true); setLoading(false); }
  }, [sourceText, sources, name, forename, nationality]);

  // Reset stale results/coverage when the operator changes the source entry.
  useEffect(() => { setResults([]); setCoverage(null); setCoverages([]); setSearched(false); }, [sourceText]);

  const loadHits = useCallback(() => {
    apiFetch<{ data: Hit[] }>('/screening/hits?status=pending').then((r) => setHits(r.data ?? [])).catch(() => setHits([]));
  }, []);
  useEffect(() => { if (tab === 'review') loadHits(); }, [tab, loadHits]);

  const reviewHit = async (id: number, action: 'confirm' | 'dismiss') => {
    await apiFetch(`/screening/hits/${id}/${action}`, { method: 'POST' }).catch(() => {});
    loadHits();
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2 text-[11px]">
        {(['search', 'review', 'watchlist', 'sources'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1 border border-border-default ${tab === t ? 'bg-surface-sunken text-[#d4a017]' : 'text-[#888]'}`}>
            {t.toUpperCase()}
          </button>
        ))}
      </div>

      {tab === 'search' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {/* Manual-entry combobox: pick a registry OR type one (incl. "All sources"). */}
            <input list="screening-source-list" placeholder="Registry (or type — e.g. All sources)" value={sourceText}
              onChange={(e) => setSourceText(e.target.value)} className="bg-black border border-border-default px-2 py-1 text-[11px] min-w-[16rem]" />
            <datalist id="screening-source-list">
              <option value="All sources" />
              {sources.filter((s) => s.supportsSearch).map((s) => <option key={s.sourceKey} value={s.label} />)}
            </datalist>
            <input placeholder="Surname" value={name} onChange={(e) => setName(e.target.value)} className="bg-black border border-border-default px-2 py-1 text-[11px]" />
            <input placeholder="Forename" value={forename} onChange={(e) => setForename(e.target.value)} className="bg-black border border-border-default px-2 py-1 text-[11px]" />
            <input placeholder="Nationality" value={nationality} onChange={(e) => setNationality(e.target.value)} className="bg-black border border-border-default px-2 py-1 text-[11px]" />
            <button onClick={search} className="px-3 py-1 border border-[#d4a017] text-[#d4a017] text-[11px]">SEARCH</button>
          </div>
          {sourceError && <div className="text-[#e87558] text-[11px]">{sourceError}</div>}
          {/* False-clear guard: an empty local registry must never read as
              "not an offender." Show WHY there are no records to match.
              Single-source search uses `coverage`; an all-sources fan-out
              returns one warning per empty registry in `coverages`. */}
          {coverage && !coverage.available && (
            <div className="border border-[#d4a017] bg-[#1a1305] text-[#e8c558] text-[11px] px-3 py-2 flex gap-2">
              <span aria-hidden className="text-[#d4a017] font-semibold">⚠</span>
              <span><span className="font-semibold uppercase">Not a clearance — registry empty.</span> {coverage.message}</span>
            </div>
          )}
          {coverages.map((cov) => (
            <div key={cov.sourceKey} className="border border-[#d4a017] bg-[#1a1305] text-[#e8c558] text-[11px] px-3 py-2 flex gap-2">
              <span aria-hidden className="text-[#d4a017] font-semibold">⚠</span>
              <span><span className="font-semibold uppercase">{cov.label} — not a clearance.</span> {cov.message}</span>
            </div>
          ))}
          {loading ? <div className="text-[#888] text-[11px]">Searching…</div> : (
            <div className="overflow-x-auto"><table className="w-full text-[11px]">
              <thead><tr className="text-[9px] text-[#888]"><th className="text-left py-[3px]">NAME</th><th className="text-left">SOURCE</th><th className="text-left">SUMMARY</th><th className="text-left">COUNTRY</th><th className="text-left">DOB</th></tr></thead>
              <tbody>
                {results.map((r) => (
                  <tr key={`${r.sourceKey}-${r.externalId}`} className="border-t border-border-subtle">
                    <td className="py-[2px] flex items-center gap-2">{r.photoUrl && <img src={r.photoUrl} alt="" className="w-6 h-6 object-cover" />}{r.displayName}</td>
                    <td className="text-[#888]">{labelFor(r.sourceKey)}</td>
                    <td>{r.summary}</td><td>{r.country ?? '—'}</td><td>{r.dob ?? '—'}</td>
                  </tr>
                ))}
                {searched && !results.length && (
                  <tr><td colSpan={5} className="py-2">
                    {(coverage && !coverage.available) || coverages.length
                      ? <span className="text-[#e8c558]">No records loaded for {coverages.length ? 'one or more registries' : 'this source'} — result is inconclusive, not a clearance.</span>
                      : <span className="text-[#888]">No matches found.</span>}
                  </td></tr>
                )}
              </tbody>
            </table></div>
          )}
        </div>
      )}

      {tab === 'review' && (
        <div className="overflow-x-auto"><table className="w-full text-[11px]">
          <thead><tr className="text-[9px] text-[#888]"><th className="text-left py-[3px]">PERSON</th><th className="text-left">SOURCE</th><th className="text-left">MATCH</th><th className="text-left">FIELDS</th><th /></tr></thead>
          <tbody>
            {hits.map((h) => (
              <tr key={h.id} className="border-t border-border-subtle">
                <td className="py-[2px]">{h.display_name}</td><td>{h.source_key}</td>
                <td>{Math.round(h.match_score * 100)}%</td><td>{parseFields(h.matched_fields).join(', ')}</td>
                <td className="text-right">
                  {canReview ? (
                    <>
                      <button onClick={() => reviewHit(h.id, 'confirm')} className="px-2 py-[2px] border border-[#d4a017] text-[#d4a017] mr-1">CONFIRM</button>
                      <button onClick={() => reviewHit(h.id, 'dismiss')} className="px-2 py-[2px] border border-border-default text-[#888]">DISMISS</button>
                    </>
                  ) : <span className="text-[#888]">—</span>}
                </td>
              </tr>
            ))}
            {!hits.length && <tr><td colSpan={5} className="text-[#888] py-2">No pending hits.</td></tr>}
          </tbody>
        </table></div>
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
    <div className="overflow-x-auto"><table className="w-full text-[11px]">
      <thead><tr className="text-[9px] text-[#888]"><th className="text-left py-[3px]">PERSON</th><th className="text-left">SCOPE</th><th className="text-left">REASON</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={String(r.id)} className="border-t border-border-subtle">
            <td className="py-[2px]">{String(r.first_name ?? '')} {String(r.last_name ?? '')}</td>
            <td>{String(r.source_scope ?? 'all')}</td><td>{String(r.reason ?? '—')}</td>
          </tr>
        ))}
        {!rows.length && <tr><td colSpan={3} className="text-[#888] py-2">No dedicated watch entries (intel-watchlist persons are also screened).</td></tr>}
      </tbody>
    </table></div>
  );
}

function SourcesTab({ sources }: { sources: SourceInfo[] }) {
  const [status, setStatus] = useState<{ state: Record<string, unknown>[]; pendingCount: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sorMsg, setSorMsg] = useState<string | null>(null);
  const load = useCallback(() => {
    apiFetch<{ state: Record<string, unknown>[]; pendingCount: number }>('/screening/status').then(setStatus).catch(() => {});
  }, []);
  useEffect(load, [load]);
  const byKey = new Map((status?.state ?? []).map((s) => [String(s.source_key), s]));

  const runSorImport = useCallback(async () => {
    setSorMsg(null);
    setBusy('__sor__');
    try {
      const r = await apiFetch<{ success: boolean; message?: string; error?: string }>(
        '/sor-sources/icrimewatch/scan?mode=incremental', { method: 'POST' });
      setSorMsg(r.success ? (r.message ?? 'SOR scan started') : (r.error ?? 'Failed'));
    } catch (err) {
      // apiFetch throws Error.message = server's error text (e.g. the 503
      // "FIRECRAWL_API_KEY not configured"), so an admin sees WHY it failed.
      setSorMsg(err instanceof Error ? err.message : 'SOR scan failed to start');
    }
    finally { setBusy(null); }
  }, []);

  // Manual scrape FORCES the run (bypasses the per-source 6-month cadence).
  const scrapeNow = async (key: string) => {
    setBusy(key);
    try { await apiFetch(`/screening/scan?source=${encodeURIComponent(key)}`, { method: 'POST' }); }
    finally { setBusy(null); setTimeout(load, 1500); }
  };
  // Edit the re-scan cadence (days). New sources default to 180 (~6 months).
  const editInterval = async (key: string, current: number) => {
    const input = window.prompt(`Re-scan this source every how many days?\n(180 = ~6 months; new sources scrape immediately, then on this cadence)`, String(current || 180));
    if (input == null) return;
    const days = Number(input);
    if (!Number.isFinite(days) || days < 1 || days > 3650) { window.alert('Enter a number of days between 1 and 3650.'); return; }
    setBusy(key);
    try { await apiFetch(`/screening/sources/${encodeURIComponent(key)}/interval`, { method: 'POST', body: JSON.stringify({ days: Math.round(days) }) }); }
    finally { setBusy(null); setTimeout(load, 300); }
  };

  return (
    <div className="space-y-2 text-[11px]">
      <div className="flex items-center justify-between">
        <div className="text-[#d4a017]">Pending review: {status?.pendingCount ?? 0}</div>
        <div className="flex items-center gap-3">
          {sorMsg && <span className={`text-[9px] ${sorMsg.toLowerCase().includes('fail') || sorMsg.toLowerCase().includes('not configured') ? 'text-[#e87558]' : 'text-[#d4a017]'}`}>{sorMsg}</span>}
          <button onClick={runSorImport} disabled={busy === '__sor__'}
            className="px-2 py-[1px] border border-[#d4a017] text-[#d4a017] hover:bg-[#1a1305] disabled:opacity-50">
            {busy === '__sor__' ? '…' : 'Run SOR import'}
          </button>
          <div className="text-[#888] text-[9px]">New sources scrape immediately, then re-scrape on their interval (default 180d ≈ 6 months).</div>
        </div>
      </div>
      <div className="overflow-x-auto"><table className="w-full">
        <thead><tr className="text-[9px] text-[#888]">
          <th className="text-left py-[3px]">SOURCE</th><th className="text-left">ENABLED</th>
          <th className="text-left">INTERVAL</th><th className="text-left">LAST RUN</th>
          <th className="text-left">NEXT RUN</th><th className="text-left">ITEMS</th><th className="text-right">ACTIONS</th>
        </tr></thead>
        <tbody>
          {sources.map((s) => {
            const st = byKey.get(s.sourceKey);
            const interval = Number(st?.scan_interval_days ?? 180);
            const next = st?.next_run_at ? String(st.next_run_at) : 'due now';
            return (
              <tr key={s.sourceKey} className="border-t border-border-subtle">
                <td className="py-[2px]">{s.label}</td>
                <td>{st && Number(st.enabled) === 0 ? 'no' : 'yes'}</td>
                <td>
                  <button onClick={() => editInterval(s.sourceKey, interval)} disabled={busy === s.sourceKey}
                    className="text-[#d4a017] hover:underline disabled:opacity-50" title="Change re-scan cadence">
                    {interval}d
                  </button>
                </td>
                <td>{String(st?.last_run_at ?? '—')}</td>
                <td className={next === 'due now' ? 'text-[#d4a017]' : ''}>{next}</td>
                <td>{String(st?.items_count ?? '—')}</td>
                <td className="text-right">
                  <button onClick={() => scrapeNow(s.sourceKey)} disabled={busy === s.sourceKey}
                    className="px-2 py-[1px] border border-border-default text-[#d4a017] hover:bg-surface-sunken disabled:opacity-50">
                    {busy === s.sourceKey ? '…' : 'Scrape now'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
    </div>
  );
}
