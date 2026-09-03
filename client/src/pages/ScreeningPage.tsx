import { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { apiFetch } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ToastProvider';
import { resolveSourceKey } from '../utils/screeningSource';
import ConfirmDialog from '../components/ConfirmDialog';
import { copyToClipboard } from '../utils/clipboard';
import { screeningHitsToCsv, downloadTextFile } from '../utils/rmsListExport';

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
  const canManage = ['admin', 'manager', 'supervisor'].includes(user?.role ?? '');
  const canReview = canManage;
  const [searchParams, setSearchParams] = useSearchParams();

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
  const [hitsLoading, setHitsLoading] = useState(false);
  const [sourcesLoadError, setSourcesLoadError] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [hitsError, setHitsError] = useState(false);

  // ConfirmDialog for hit review actions
  const [pendingReview, setPendingReview] = useState<{ id: number; action: 'confirm' | 'dismiss'; name: string } | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);

  // Ref for surname input — N shortcut focuses it
  const nameInputRef = useRef<HTMLInputElement>(null);

  const loadSources = useCallback(() => {
    setSourcesLoadError(false);
    apiFetch<{ data: SourceInfo[] }>('/screening/sources')
      .then((r) => setSources(r.data))
      .catch(() => setSourcesLoadError(true));
  }, []);
  useEffect(() => { loadSources(); }, [loadSources]);

  // ── ?screen_id= / ?person_id= deep-link ─────────────────────────────────
  // On mount: screen_id switches to the review tab; person_id pre-fills the
  // surname field. Strip the param immediately after reading (replace: true).
  const deepLinkApplied = useRef(false);
  useEffect(() => {
    if (deepLinkApplied.current) return;
    const screenId = searchParams.get('screen_id');
    const personId = searchParams.get('person_id');
    const surname = searchParams.get('surname');
    if (!screenId && !personId && !surname) return;
    deepLinkApplied.current = true;
    const next = new URLSearchParams(searchParams);
    if (screenId) { next.delete('screen_id'); setTab('review'); }
    if (personId) { next.delete('person_id'); setName(personId); }
    if (surname) { next.delete('surname'); setName(surname); }
    setSearchParams(next, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const labelFor = useCallback((key: string) => sources.find((s) => s.sourceKey === key)?.label ?? key, [sources]);

  const search = useCallback(async () => {
    const resolved = resolveSourceKey(sourceText, sources);
    if (!resolved) {
      setSourceError('Unknown registry — choose from the list or type "All sources".');
      return;
    }
    setSourceError(null);
    setLoading(true);
    setSearchFailed(false);
    try {
      const qs = new URLSearchParams({ source: resolved });
      if (name) qs.set('name', name);
      if (forename) qs.set('forename', forename);
      if (nationality) qs.set('nationality', nationality);
      const r = await apiFetch<{ data: Candidate[]; coverage?: Coverage; coverages?: SourceCoverage[] }>(`/screening/search?${qs}`);
      setResults(r.data ?? []);
      setCoverage(r.coverage ?? null);
      setCoverages(r.coverages ?? []);
    } catch { setResults([]); setCoverage(null); setCoverages([]); setSearchFailed(true); } finally { setSearched(true); setLoading(false); }
  }, [sourceText, sources, name, forename, nationality]);

  // Reset stale results/coverage when the operator changes the source entry.
  useEffect(() => { setResults([]); setCoverage(null); setCoverages([]); setSearched(false); }, [sourceText]);

  const loadHits = useCallback(() => {
    setHitsLoading(true);
    setHitsError(false);
    apiFetch<{ data: Hit[] }>('/screening/hits?status=pending')
      .then((r) => setHits(r.data ?? []))
      .catch(() => { setHits([]); setHitsError(true); })
      .finally(() => setHitsLoading(false));
  }, []);
  useEffect(() => { if (tab === 'review') loadHits(); }, [tab, loadHits]);

  const confirmReviewHit = async () => {
    if (!pendingReview) return;
    setReviewBusy(true);
    try {
      await apiFetch(`/screening/hits/${pendingReview.id}/${pendingReview.action}`, { method: 'POST' });
      loadHits();
    } finally {
      setReviewBusy(false);
      setPendingReview(null);
    }
  };

  // ── N shortcut: focus surname input on search tab ─────────────────────
  // ── Esc cascade: close confirm dialog first, then nothing more ────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);

      if (e.key === 'Escape') {
        e.stopPropagation();
        if (pendingReview) { setPendingReview(null); return; }
        return;
      }

      if (e.key === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey && !inInput) {
        e.preventDefault();
        setTab('search');
        // Give React a tick to render the search tab before focusing
        setTimeout(() => nameInputRef.current?.focus(), 0);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [pendingReview]);

  return (
    <div className="space-y-4">
      <div className="flex gap-2 text-[11px]">
        {(['search', 'review', 'watchlist', 'sources'] as Tab[]).map((t) => (
          <button type="button" key={t} onClick={() => setTab(t)}
            className={`px-3 py-1 border border-border-default ${tab === t ? 'bg-surface-sunken text-brand-400' : 'text-rmpg-400'}`}>
            {t.toUpperCase()}
          </button>
        ))}
      </div>

      {tab === 'search' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {/* Manual-entry combobox: pick a registry OR type one (incl. "All sources"). */}
            <input list="screening-source-list" placeholder="Registry (or type — e.g. All sources)" aria-label="Screening registry" value={sourceText}
              onChange={(e) => setSourceText(e.target.value)} className="bg-surface-sunken border border-border-default px-2 py-1 text-[11px] min-w-[16rem]" />
            <datalist id="screening-source-list">
              <option value="All sources" />
              {sources.filter((s) => s.supportsSearch).map((s) => <option key={s.sourceKey} value={s.label} />)}
            </datalist>
            <input
              ref={nameInputRef}
              placeholder="Surname"
              aria-label="Surname"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') search(); }}
              className="bg-surface-sunken border border-border-default px-2 py-1 text-[11px]"
            />
            <input placeholder="Forename" value={forename} onChange={(e) => setForename(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') search(); }} className="bg-surface-sunken border border-border-default px-2 py-1 text-[11px]" />
            <input placeholder="Nationality" value={nationality} onChange={(e) => setNationality(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') search(); }} className="bg-surface-sunken border border-border-default px-2 py-1 text-[11px]" />
            <button type="button" onClick={search} className="px-3 py-1 border border-brand-500 text-brand-400 text-[11px]">SEARCH</button>
          </div>
          {sourceError && <div className="text-red-400 text-[11px]">{sourceError}</div>}
          {sourcesLoadError && (
            <div className="text-red-400 text-[11px] flex items-center justify-between">
              <span>Failed to load screening sources.</span>
              <button type="button" className="px-2 py-[1px] border border-border-default" onClick={loadSources}>Retry</button>
            </div>
          )}
          {searchFailed && (
            <div className="text-red-400 text-[11px] flex items-center justify-between">
              <span>Search failed.</span>
              <button type="button" className="px-2 py-[1px] border border-border-default" onClick={() => void search()}>Retry</button>
            </div>
          )}
          {/* False-clear guard: an empty local registry must never read as
              "not an offender." Show WHY there are no records to match.
              Single-source search uses `coverage`; an all-sources fan-out
              returns one warning per empty registry in `coverages`. */}
          {coverage && !coverage.available && (
            <div className="border border-brand-600 bg-surface-sunken text-brand-300 text-[11px] px-3 py-2 flex gap-2">
              <span aria-hidden className="text-brand-400 font-semibold">⚠</span>
              <span><span className="font-semibold uppercase">Not a clearance — registry empty.</span> {coverage.message}</span>
            </div>
          )}
          {coverages.map((cov) => (
            <div key={cov.sourceKey} className="border border-brand-600 bg-surface-sunken text-brand-300 text-[11px] px-3 py-2 flex gap-2">
              <span aria-hidden className="text-brand-400 font-semibold">⚠</span>
              <span><span className="font-semibold uppercase">{cov.label} — not a clearance.</span> {cov.message}</span>
            </div>
          ))}
          {loading ? (
            <div className="text-rmpg-400 text-[11px] py-4 text-center">Searching…</div>
          ) : !searched ? (
            <div className="text-rmpg-500 text-[11px] py-4 text-center">Enter a name and press SEARCH or Enter to query the registries.</div>
          ) : (
            <div className="overflow-x-auto"><table className="w-full text-[11px]">
              <thead><tr className="text-[9px] text-rmpg-400 font-semibold"><th className="text-left py-[3px]">NAME</th><th className="text-left">SOURCE</th><th className="text-left">SUMMARY</th><th className="text-left">COUNTRY</th><th className="text-left">DOB</th><th /></tr></thead>
              <tbody>
                {results.map((r) => (
                  <tr key={`${r.sourceKey}-${r.externalId}`} className="border-t border-border-subtle">
                    <td className="py-[2px] flex items-center gap-2">{r.photoUrl && <img src={r.photoUrl} alt="" className="w-6 h-6 object-cover" />}{r.displayName}</td>
                    <td>{labelFor(r.sourceKey)}</td>
                    <td>{r.summary}</td><td>{r.country ?? '—'}</td><td>{r.dob ?? '—'}</td>
                    <td>
                      <button type="button" className="px-2 py-[1px] border border-border-default" onClick={() => void copyToClipboard(r.externalId)}>Copy id</button>
                    </td>
                  </tr>
                ))}
          {!results.length && (
                  <tr><td colSpan={6} className="py-2">
                    {(coverage && !coverage.available) || coverages.length
                      ? <span className="text-brand-300">No records loaded for {coverages.length ? 'one or more registries' : 'this source'} — result is inconclusive, not a clearance.</span>
                      : <span>No matches found.</span>}
                  </td></tr>
                )}
              </tbody>
            </table></div>
          )}
        </div>
      )}

      {tab === 'review' && (
        <>
          <div className="flex items-center gap-2 mb-2">
            <button
              type="button"
              className="px-2 py-[1px] border border-border-default text-[11px]"
              disabled={hits.length === 0}
              onClick={() => downloadTextFile('screening-hits.csv', screeningHitsToCsv(hits))}
            >CSV</button>
          </div>
          {hitsError && (
            <div className="text-red-400 text-[11px] flex items-center justify-between mb-2">
              <span>Failed to load pending hits.</span>
              <button type="button" className="px-2 py-[1px] border border-border-default" onClick={loadHits}>Retry</button>
            </div>
          )}
          {hitsLoading ? (
            <div className="text-rmpg-400 text-[11px] py-4 text-center">Loading pending hits…</div>
          ) : !hits.length ? (
            <div className="text-rmpg-500 text-[11px] py-4 text-center">No pending hits requiring review.</div>
          ) : (
            <div className="overflow-x-auto"><table className="w-full text-[11px]">
              <thead><tr className="text-[9px] text-rmpg-400 font-semibold"><th className="text-left py-[3px]">PERSON</th><th className="text-left">SOURCE</th><th className="text-left">MATCH</th><th className="text-left">FIELDS</th><th /></tr></thead>
              <tbody>
                {hits.map((h) => (
                  <tr key={h.id} className="border-t border-border-subtle">
                    <td className="py-[2px]">{h.display_name}</td><td>{h.source_key}</td>
                    <td>{Math.round(h.match_score * 100)}%</td><td>{parseFields(h.matched_fields).join(', ')}</td>
                    <td className="text-right">
                      {canReview ? (
                        <>
                          <button type="button" onClick={() => setPendingReview({ id: h.id, action: 'confirm', name: h.display_name })} className="px-2 py-[2px] border border-brand-500 text-brand-400 mr-1">CONFIRM</button>
                          <button type="button" onClick={() => setPendingReview({ id: h.id, action: 'dismiss', name: h.display_name })} className="px-2 py-[2px] border border-border-default text-rmpg-400">DISMISS</button>
                        </>
                      ) : <span className="text-rmpg-500">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
          <ConfirmDialog
            isOpen={pendingReview !== null}
            onClose={() => setPendingReview(null)}
            onConfirm={confirmReviewHit}
            title={pendingReview?.action === 'confirm' ? 'Confirm Hit' : 'Dismiss Hit'}
            message={pendingReview?.action === 'confirm'
              ? 'Mark this screening hit as a confirmed match?'
              : 'Dismiss this screening hit as a false positive?'}
            details={pendingReview ? <span>{pendingReview.name}</span> : undefined}
            confirmLabel={pendingReview?.action === 'confirm' ? 'Confirm Match' : 'Dismiss Hit'}
            confirmVariant={pendingReview?.action === 'confirm' ? 'warning' : 'default'}
            isLoading={reviewBusy}
          />
        </>
      )}

      {tab === 'watchlist' && <WatchlistTab />}
      {tab === 'sources' && <SourcesTab sources={sources} canManage={canManage} />}
    </div>
  );
}

function WatchlistTab() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    apiFetch<{ data: Record<string, unknown>[] }>('/screening/watchlist')
      .then((r) => setRows(r.data ?? []))
      .catch(() => { setRows([]); setError(true); })
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  if (loading) return <div className="text-[11px] py-4 text-center">Loading watchlist…</div>;
  if (error) {
    return (
      <div className="text-red-400 text-[11px] flex items-center justify-between">
        <span>Failed to load watchlist.</span>
        <button type="button" className="px-2 py-[1px] border border-border-default" onClick={load}>Retry</button>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto"><table className="w-full text-[11px]">
      <thead><tr className="text-[9px] text-rmpg-400 font-semibold"><th className="text-left py-[3px]">PERSON</th><th className="text-left">SCOPE</th><th className="text-left">REASON</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={String(r.id)} className="border-t border-border-subtle">
            <td className="py-[2px]">{String(r.first_name ?? '')} {String(r.last_name ?? '')}</td>
            <td>{String(r.source_scope ?? 'all')}</td><td>{String(r.reason ?? '—')}</td>
          </tr>
        ))}
        {!rows.length && <tr><td colSpan={3} className="text-rmpg-500 py-2">No dedicated watch entries (intel-watchlist persons are also screened).</td></tr>}
      </tbody>
    </table></div>
  );
}

function SourcesTab({ sources, canManage }: { sources: SourceInfo[]; canManage: boolean }) {
  const [status, setStatus] = useState<{ state: Record<string, unknown>[]; pendingCount: number } | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [sorMsg, setSorMsg] = useState<string | null>(null);

  // ConfirmDialog for forced re-scrape (destructive — bypasses normal cadence)
  const [pendingScrape, setPendingScrape] = useState<{ key: string; label: string } | null>(null);
  const [scrapeBusy, setScrapeBusy] = useState(false);

  // Inline interval editor replaces window.prompt/alert
  const [editingInterval, setEditingInterval] = useState<{ key: string; value: string } | null>(null);

  const load = useCallback(() => {
    setStatusLoading(true);
    setStatusError(false);
    apiFetch<{ state: Record<string, unknown>[]; pendingCount: number }>('/screening/status')
      .then(setStatus)
      .catch(() => setStatusError(true))
      .finally(() => setStatusLoading(false));
  }, []);
  useEffect(load, [load]);

  // ── Esc cascade for SourcesTab: editingInterval → pendingScrape ───────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (editingInterval) { e.stopPropagation(); setEditingInterval(null); return; }
      if (pendingScrape) { e.stopPropagation(); setPendingScrape(null); return; }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [editingInterval, pendingScrape]);

  const byKey = new Map((status?.state ?? []).map((s) => [String(s.source_key), s]));

  const runSorImport = useCallback(async () => {
    if (!canManage) return;
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
  }, [canManage]);

  // Manual scrape FORCES the run (bypasses the per-source 6-month cadence).
  const confirmScrapeNow = async () => {
    if (!pendingScrape) return;
    setScrapeBusy(true);
    try { await apiFetch(`/screening/scan?source=${encodeURIComponent(pendingScrape.key)}`, { method: 'POST' }); }
    finally { setScrapeBusy(false); setPendingScrape(null); setTimeout(load, 1500); }
  };

  // Edit the re-scan cadence (days) inline — replaces window.prompt + window.alert.
  const submitInterval = async (key: string) => {
    if (!editingInterval || editingInterval.key !== key) return;
    const days = Number(editingInterval.value);
    if (!Number.isFinite(days) || days < 1 || days > 3650) return; // keep editor open on bad value
    setBusy(key);
    setEditingInterval(null);
    try { await apiFetch(`/screening/sources/${encodeURIComponent(key)}/interval`, { method: 'POST', body: JSON.stringify({ days: Math.round(days) }) }); }
    finally { setBusy(null); setTimeout(load, 300); }
  };

  if (statusLoading) return <div className="text-[11px] py-4 text-center">Loading source status…</div>;
  if (statusError) {
    return (
      <div className="text-red-400 text-[11px] flex items-center justify-between">
        <span>Failed to load source status.</span>
        <button type="button" className="px-2 py-[1px] border border-border-default" onClick={load}>Retry</button>
      </div>
    );
  }

  const sorMsgIsError = sorMsg && (sorMsg.toLowerCase().includes('fail') || sorMsg.toLowerCase().includes('not configured'));

  return (
    <div className="space-y-2 text-[11px]">
      <div className="flex items-center justify-between">
        <div className="text-brand-400">Pending review: {status?.pendingCount ?? 0}</div>
        {canManage && (
          <div className="flex items-center gap-3">
            {sorMsg && <span className={`text-[9px] ${sorMsgIsError ? 'text-red-400' : 'text-brand-400'}`}>{sorMsg}</span>}
            <button type="button" onClick={runSorImport} disabled={busy === '__sor__'}
              className="px-2 py-[1px] border border-brand-500 text-brand-400 hover:bg-surface-sunken disabled:opacity-50">
              {busy === '__sor__' ? '…' : 'Run SOR import'}
            </button>
            <div className="text-rmpg-500 text-[9px]">New sources scrape immediately, then re-scrape on their interval (default 180d ≈ 6 months).</div>
          </div>
        )}
      </div>
      {!sources.length ? (
        <div className="text-rmpg-500 text-[11px] py-4 text-center">No screening sources configured.</div>
      ) : (
        <div className="overflow-x-auto"><table className="w-full">
          <thead><tr className="text-[9px] text-rmpg-400 font-semibold">
            <th className="text-left py-[3px]">SOURCE</th><th className="text-left">ENABLED</th>
            <th className="text-left">INTERVAL</th><th className="text-left">LAST RUN</th>
            <th className="text-left">NEXT RUN</th><th className="text-left">ITEMS</th>
            {canManage && <th className="text-right">ACTIONS</th>}
          </tr></thead>
          <tbody>
            {sources.map((s) => {
              const st = byKey.get(s.sourceKey);
              const interval = Number(st?.scan_interval_days ?? 180);
              const next = st?.next_run_at ? String(st.next_run_at) : 'due now';
              const isEditing = editingInterval?.key === s.sourceKey;
              return (
                <tr key={s.sourceKey} className="border-t border-border-subtle">
                  <td className="py-[2px]">{s.label}</td>
                  <td>{st && Number(st.enabled) === 0 ? 'no' : 'yes'}</td>
                  <td>
                    {canManage ? (
                      isEditing ? (
                        <span className="flex items-center gap-1">
                          <input
                            type="number"
                            min={1} max={3650}
                            value={editingInterval.value}
                            onChange={(e) => setEditingInterval({ key: s.sourceKey, value: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { e.stopPropagation(); submitInterval(s.sourceKey); }
                              if (e.key === 'Escape') { e.stopPropagation(); setEditingInterval(null); }
                            }}
                            className="w-16 bg-surface-sunken border border-border-default px-1 text-[11px]"
                            autoFocus
                          />
                          <button type="button" onClick={() => submitInterval(s.sourceKey)} className="text-brand-400 hover:underline text-[9px]">save</button>
                          <button type="button" onClick={() => setEditingInterval(null)} className="text-rmpg-500 hover:underline text-[9px]">cancel</button>
                        </span>
                      ) : (
                        <button type="button" onClick={() => setEditingInterval({ key: s.sourceKey, value: String(interval) })} disabled={busy === s.sourceKey}
                          className="text-brand-400 hover:underline disabled:opacity-50" title="Change re-scan cadence">
                          {interval}d
                        </button>
                      )
                    ) : <span>{interval}d</span>}
                  </td>
                  <td>{String(st?.last_run_at ?? '—')}</td>
                  <td className={next === 'due now' ? 'text-brand-400' : ''}>{next}</td>
                  <td>{String(st?.items_count ?? '—')}</td>
                  {canManage && (
                    <td className="text-right">
                      <button type="button" onClick={() => setPendingScrape({ key: s.sourceKey, label: s.label })} disabled={busy === s.sourceKey}
                        className="px-2 py-[1px] border border-border-default text-brand-400 hover:bg-surface-sunken disabled:opacity-50">
                        {busy === s.sourceKey ? '…' : 'Scrape now'}
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table></div>
      )}

      <ConfirmDialog
        isOpen={pendingScrape !== null}
        onClose={() => setPendingScrape(null)}
        onConfirm={confirmScrapeNow}
        title="Force Re-scrape"
        message="Immediately re-scrape this source, bypassing the normal cadence. This may take several minutes."
        details={pendingScrape ? <span>{pendingScrape.label}</span> : undefined}
        confirmLabel="Scrape Now"
        confirmVariant="warning"
        isLoading={scrapeBusy}
      />
    </div>
  );
}
