// Jail / booking records (Intel Wave 3a). Shows the Utah source registry
// + scrape health, a manual roster-ingest box (CSV or "Name - charges"
// lines) that cross-hits every booking against known/flagged subjects,
// and a recent-bookings list with match badges.
import { useEffect, useState, useCallback, useRef } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Building2, Search, X, RefreshCw } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToast } from '../components/ToastProvider';
import { parseTimestamp, safeDateStr } from '../utils/dateUtils';
import { useAuth } from '../context/AuthContext';
import { formatEnumValue } from '../utils/formatters';
import { jailBookingsToCsv, jailSourcesToCsv, downloadTextFile } from '../utils/rmsListExport';
import { copyToClipboard } from '../utils/contextMenuActions';

interface Source {
  source_key: string; display_name: string; county: string | null;
  kind: string; status: string; last_run_at: string | null; last_status: string | null; row_count: number;
}
interface Booking {
  id: number; full_name: string; booking_date: string | null; charges: string | null;
  county: string | null; entry_source: string; person_id: number | null;
}
interface IngestResult { ingested: number; matched: number; alerts: number; parsed: number }

const STATUS_DOT: Record<string, string> = {
  active: 'bg-emerald-500', pending: 'bg-rmpg-500', disabled: 'bg-red-600',
};

function fmtBookingDate(dateStr: string | null): string {
  if (!dateStr) return '';
  return String(dateStr).slice(0, 10);
}

function fmtRelativeAge(iso: string | null): string | null {
  if (!iso) return null;
  const t = parseTimestamp(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const diffMs = Date.now() - t;
  if (diffMs < 0) return 'just now';
  const m = Math.floor(diffMs / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function JailRecordsPage() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [sources, setSources] = useState<Source[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [bookingSearch, setBookingSearch] = useState('');
  const [bookingCounty, setBookingCounty] = useState('ALL');
  const [newestFirst, setNewestFirst] = useState(true);
  const [bookingsError, setBookingsError] = useState<string | null>(null);
  const [county, setCounty] = useState('');
  const [format, setFormat] = useState<'lines' | 'csv'>('lines');
  const [text, setText] = useState('');
  const [result, setResult] = useState<IngestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sourcesError, setSourcesError] = useState(false);

  // Role gate: only supervisor+ can ingest roster data
  const canIngest = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'supervisor';
  const [showIngestConfirm, setShowIngestConfirm] = useState(false);
  const lineCount = text.trim().split('\n').filter(Boolean).length;

  const loadSources = useCallback(() =>
    apiFetch<Source[]>('/intel/jail/sources')
      .then((r) => { setSources(Array.isArray(r) ? r : []); setSourcesError(false); })
      .catch(() => { setSources([]); setSourcesError(true); }),
  []);

  const loadBookings = useCallback(() =>
    apiFetch<Booking[]>('/intel/jail/bookings?limit=25')
      .then((r) => { setBookings(Array.isArray(r) ? r : []); setBookingsError(null); })
      .catch((err) => {
        setBookings([]);
        setBookingsError(err instanceof Error ? err.message : 'Failed to load bookings');
      }),
  []);

  useEffect(() => {
    Promise.all([loadSources(), loadBookings()]).finally(() => setLoading(false));
  }, [loadSources, loadBookings]);

  // ── Deep-link: ?source_key=<key> scrolls the source row into view ──────────
  const deepLinkConsumedRef = useRef(false);
  const sourceKeyParam = searchParams.get('source_key');
  useEffect(() => {
    if (loading || deepLinkConsumedRef.current || !sourceKeyParam) return;
    deepLinkConsumedRef.current = true;
    const target = sources.find(s => s.source_key === sourceKeyParam);
    if (target) {
      const el = document.getElementById(`source-row-${sourceKeyParam}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      addToast(`Source "${sourceKeyParam}" not found.`, 'warning');
    }
    const next = new URLSearchParams(searchParams);
    next.delete('source_key');
    setSearchParams(next, { replace: true });
  }, [loading, sources, sourceKeyParam, searchParams, setSearchParams, addToast]);

  // ── N shortcut → focus the county input (primary entry point) ───────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'n' && e.key !== 'N') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (!t) return;
      const tag = t.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (t.isContentEditable) return;
      e.preventDefault();
      document.getElementById('jail-records-county-input')?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // ── Esc cascade: clear search → blur ingest ─────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (bookingSearch) {
        e.stopPropagation();
        setBookingSearch('');
        return;
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [bookingSearch]);

  const ingest = async () => {
    if (!text.trim() || busy || !canIngest) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await apiFetch<IngestResult>('/intel/jail/ingest', {
        method: 'POST', body: JSON.stringify({ county: county.trim() || undefined, format, text }),
      });
      setResult(r);
      setText('');
      addToast(`Ingested ${r.ingested} booking${r.ingested === 1 ? '' : 's'}${r.matched > 0 ? ` · ${r.matched} known subject(s)` : ''}${r.alerts > 0 ? ` · ${r.alerts} FLAGGED` : ''}`, r.alerts > 0 ? 'error' : 'success');
      loadBookings();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Ingest failed';
      addToast(msg, 'error');
    } finally {
      setBusy(false);
    }
  };

  const doIngest = useCallback(async () => {
    setShowIngestConfirm(false);
    await ingest();
  }, [text, busy, canIngest, county, format, addToast, loadBookings]);

  const active = sources.filter((s) => s.status === 'active');
  const pending = sources.filter((s) => s.status !== 'active');

  const counties = Array.from(new Set(bookings.map((b) => b.county).filter(Boolean))) as string[];
  const filteredBookings = bookings.filter(b => {
    if (bookingCounty !== 'ALL' && b.county !== bookingCounty) return false;
    if (!bookingSearch.trim()) return true;
    const term = bookingSearch.trim().toLowerCase();
    return (
      b.full_name.toLowerCase().includes(term) ||
      (b.charges || '').toLowerCase().includes(term) ||
      (b.county || '').toLowerCase().includes(term)
    );
  }).slice().sort((a, b) => {
    const da = a.booking_date ?? '';
    const db = b.booking_date ?? '';
    return newestFirst ? db.localeCompare(da) : da.localeCompare(db);
  });

  const bookingsEmpty = !loading && bookings.length === 0;
  const bookingsFiltered = !loading && bookings.length > 0 && filteredBookings.length === 0;

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="JAIL / BOOKING RECORDS" icon={Building2}>
        <button
          type="button"
          onClick={() => { loadSources(); loadBookings(); }}
          className="toolbar-btn flex items-center gap-1.5"
          style={{ height: 28, padding: '0 10px' }}
          title="Refresh sources and bookings"
        >
          <RefreshCw size={13} /> Refresh
        </button>
      </PanelTitleBar>

      {/* Manual ingest — supervisor+ only */}
      <div className="bg-surface-raised border border-rmpg-700 p-3 space-y-2">
        <div className="text-[9px] font-semibold text-brand-400">MANUAL ROSTER INGEST</div>
        {!canIngest && (
          <div className="text-[11px] text-rmpg-500 italic">Supervisor or higher role required to ingest roster data.</div>
        )}
        {canIngest && (
          <>
            <div className="flex gap-2">
              <input
                id="jail-records-county-input"
                value={county}
                onChange={(e) => setCounty(e.target.value)}
                placeholder="County (e.g. Salt Lake)"
                className="flex-1 input-dark text-[11px]"
              />
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as 'lines' | 'csv')}
                className="select-dark text-[11px]"
              >
                <option value="lines">Lines (Name - charges)</option>
                <option value="csv">CSV (name,dob,booking_date,charges)</option>
              </select>
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              placeholder={format === 'csv'
                ? 'name,dob,booking_date,charges\nJohn Smith,1990-01-02,2026-06-10,Theft'
                : 'John Smith - Theft, Trespass\nJane Doe - DUI'}
              className="w-full input-dark text-[11px] font-mono resize-y"
            />
            <button
              onClick={() => setShowIngestConfirm(true)}
              disabled={busy || !text.trim()}
              className="w-full py-1.5 text-[11px] font-semibold border border-brand-400 text-brand-400 hover:bg-surface-raised disabled:opacity-40"
            >
              {busy ? 'INGESTING…' : 'INGEST + CROSS-HIT'}
            </button>
            {result && (
              <div className="text-[11px] text-rmpg-200">
                Parsed {result.parsed} · ingested {result.ingested} · matched {result.matched} known subject(s)
                {result.alerts > 0 && <span className="text-red-500 font-semibold"> · {result.alerts} FLAGGED HIT(S)</span>}
              </div>
            )}
          </>
        )}
      </div>

      {/* Recent bookings */}
      <div className="bg-surface-raised border border-rmpg-700">
        <div className="px-2 py-[3px] border-b border-border-subtle flex items-center gap-2">
          <span className="text-[9px] font-semibold flex-1" style={{ color: 'var(--panel-header-color)' }}>RECENT BOOKINGS</span>
          <select
            aria-label="Filter by county"
            className="bg-surface-overlay border border-border-default text-[10px] text-rmpg-200"
            value={bookingCounty}
            onChange={(e) => setBookingCounty(e.target.value)}
          >
            <option value="ALL">All counties</option>
            {counties.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button type="button" className="text-[9px] border border-border-default px-1.5" onClick={() => setNewestFirst((v) => !v)}>
            {newestFirst ? 'Newest' : 'Oldest'}
          </button>
          <button
            type="button"
            className="text-[9px] border border-border-default px-1.5"
            disabled={filteredBookings.length === 0}
            onClick={() => downloadTextFile('jail-bookings.csv', jailBookingsToCsv(filteredBookings))}
          >CSV</button>
          <div className="relative">
            <Search size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-rmpg-500 pointer-events-none" />
            <input
              type="search"
              value={bookingSearch}
              onChange={(e) => setBookingSearch(e.target.value)}
              placeholder="Filter bookings…"
              className="input-dark pl-6 pr-2 text-[10px]"
              style={{ height: 22, width: 160 }}
              aria-label="Filter bookings"
            />
          </div>
          {bookingSearch && (
            <button
              type="button"
              onClick={() => setBookingSearch('')}
              className="toolbar-btn px-1.5"
              style={{ height: 22 }}
              title="Clear filter (Esc)"
            >
              <X size={10} />
            </button>
          )}
        </div>
        {bookingsError && (
          <div className="p-2 text-[11px] text-red-300 flex items-center justify-between">
            <span>{bookingsError}</span>
            <button type="button" className="text-[9px] border border-border-default px-2" onClick={() => void loadBookings()}>Retry</button>
          </div>
        )}
        {!loading && bookingsEmpty && (
          <div className="p-2 text-[11px] text-rmpg-500">No bookings yet — ingest a roster above.</div>
        )}
        {!loading && bookingsFiltered && (
          <div className="p-2 text-[11px] text-rmpg-500">
            No bookings match "{bookingSearch}".{' '}
            <button type="button" onClick={() => setBookingSearch('')} className="text-brand-400 hover:underline">Clear</button>
          </div>
        )}
        {filteredBookings.map((b) => (
          <div key={b.id} className="px-2 py-[2px] text-[11px] flex items-center gap-2 border-b border-border-subtle last:border-b-0">
            <span className="text-rmpg-200 w-44 shrink-0 truncate">{b.full_name}</span>
            <button type="button" className="text-[9px] border border-border-default px-1" onClick={() => void copyToClipboard(b.full_name)}>Copy</button>
            <span className="text-rmpg-500 min-w-0 flex-1 truncate">{b.charges || ''}</span>
            <span className="text-rmpg-500">{b.county || ''}</span>
            <span className="text-rmpg-500">{fmtBookingDate(b.booking_date)}</span>
            {b.person_id
              ? <Link to={`/intel/person/${b.person_id}`} className="text-[9px] text-brand-400 border border-rmpg-700 px-1">KNOWN →</Link>
              : <span className="text-[9px] text-rmpg-500 w-12 text-right">new</span>}
          </div>
        ))}
      </div>

      {/* Source registry */}
      <div className="bg-surface-raised border border-rmpg-700">
        <div className="px-2 py-[3px] text-[9px] font-semibold border-b border-border-subtle flex items-center gap-2" style={{ color: 'var(--panel-header-color)' }}>
          <span className="flex-1">SOURCES — {active.length} active, {pending.length} pending</span>
          <button
            type="button"
            className="text-[9px] border border-border-default px-1.5"
            disabled={sources.length === 0}
            onClick={() => downloadTextFile('jail-sources.csv', jailSourcesToCsv(sources))}
          >CSV</button>
        </div>
        {loading && (
          <div className="p-2 text-[11px] text-rmpg-500">Loading sources…</div>
        )}
        {!loading && sourcesError && (
          <div className="p-2 text-[11px] text-rmpg-500 flex items-center justify-between">
            <span>Could not load sources. Check API connectivity.</span>
            <button type="button" className="text-[9px] border border-border-default px-2" onClick={() => void loadSources()}>Retry</button>
          </div>
        )}
        {!loading && !sourcesError && sources.length === 0 && (
          <div className="p-2 text-[11px] text-rmpg-500">No sources configured.</div>
        )}
        {[...active, ...pending].map((s) => (
          <div
            id={`source-row-${s.source_key}`}
            key={s.source_key}
            className="px-2 py-[2px] text-[11px] flex items-center gap-2 border-b border-border-subtle last:border-b-0"
          >
            <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[s.status] || 'bg-rmpg-500'}`} />
            <span className="text-rmpg-200 min-w-0 flex-1 truncate">{s.display_name}</span>
            <span className="text-rmpg-500 text-[9px]">{formatEnumValue(s.kind)}</span>
            <span className="text-rmpg-500 text-[9px]">{s.row_count || 0} rec</span>
            {s.last_run_at && (
              <span className="text-rmpg-500 text-[9px]" title={s.last_run_at}>
                {fmtRelativeAge(s.last_run_at) ?? safeDateStr(s.last_run_at, "")}
              </span>
            )}
            <span className="text-rmpg-500 text-[9px] w-28 truncate text-right">{s.last_status || s.status}</span>
            <button type="button" className="text-[9px] border border-border-default px-1" onClick={() => void copyToClipboard(s.source_key)}>Key</button>
          </div>
        ))}
      </div>
      <div className="text-[9px] text-rmpg-500">
        Live county portals are JS-rendered and can't be auto-scraped from the edge yet — use manual ingest for those.
        UDC/VINELink adapters are wired and self-report health; authorized feeds flip a source to active.
      </div>

      <ConfirmDialog
        isOpen={showIngestConfirm}
        onClose={() => setShowIngestConfirm(false)}
        onConfirm={doIngest}
        title="Confirm Roster Ingest"
        message={`Ingest ${lineCount} entr${lineCount === 1 ? 'y' : 'ies'} and cross-hit against known subjects?`}
        details={county.trim() ? <span>County: {county.trim()}</span> : undefined}
        confirmLabel="INGEST + CROSS-HIT"
        confirmVariant="warning"
        isLoading={busy}
      />
    </div>
  );
}
