// ============================================================
// RMPG Flex — Plate Analytics (R2 Data Catalog / Iceberg lakehouse)
// ============================================================
// Reads the unbounded ALPR plate-read history stored as Apache Iceberg tables
// in R2 Data Catalog (written by the dual-write in src/routes/alpr.ts) and
// queried with R2 SQL via /api/analytics. This is the OLAP companion to D1:
// "everywhere a plate was seen", busiest-plate summaries, and (command staff
// only) a raw R2 SQL console.
//
// Degrades gracefully: until the operator provisions the pipeline + warehouse,
// every endpoint 503s and this page shows a clear "not provisioned yet" panel
// with the setup steps instead of scary errors.
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ScanSearch, Search, RotateCcw, AlertTriangle, Database, Loader2, Car, MapPin, Terminal, Activity, Gauge } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import StatsCard from '../components/StatsCard';
import ConfirmDialog from '../components/ConfirmDialog';
import { useAuth } from '../context/AuthContext';
import { parseTimestamp } from '../utils/dateUtils';
import { toDisplayLabel } from '../utils/formatters';
import { plateSummaryToCsv, downloadTextFile } from '../utils/rmsListExport';

interface HealthResp {
  ok: boolean; query_ready: boolean; pipeline_bound: boolean;
  warehouse_configured: boolean; token_configured: boolean; table: string;
}
interface PlateSighting {
  occurred_at?: string | null; plate?: string | null; raw_plate?: string | null;
  state?: string | null; make?: string | null; model?: string | null; color?: string | null;
  vehicle_type?: string | null; lat?: number | null; lng?: number | null;
  location_text?: string | null; source?: string | null; trust?: number | string | null;
  hit_count?: number | null; critical_hit?: boolean | number | null;
  capture_id?: number | null; call_id?: number | null;
}
interface PlateHistoryResp { plate: string; since: string; count: number; sightings: PlateSighting[] }
interface SummaryRow { plate?: string | null; reads?: number | string | null; last_seen?: string | null; ever_hit?: boolean | number | null }
interface SummaryResp { since: string; count: number; plates: SummaryRow[] }
// flex_events (system-wide) shapes
interface EventSummaryRow { event_type?: string | null; events?: number | string | null; last_at?: string | null }
interface EventRow {
  occurred_at?: string | null; event_type?: string | null; actor_id?: number | null;
  entity_type?: string | null; entity_id?: string | null; status?: string | null;
  label?: string | null; category?: string | null; priority?: string | null;
  lat?: number | null; lng?: number | null;
}
interface CfsTrendRow { call_type?: string | null; priority?: string | null; calls?: number | string | null }
interface GpsRow { unit_id?: string | null; pings?: number | string | null; last_at?: string | null; avg_speed?: number | string | null }

type Tab = 'plates' | 'activity' | 'operations';
const TABS: Array<{ key: Tab; label: string; icon: typeof ScanSearch }> = [
  { key: 'plates', label: 'Plates', icon: ScanSearch },
  { key: 'activity', label: 'Activity', icon: Activity },
  { key: 'operations', label: 'Operations', icon: Gauge },
];

const DAY_OPTIONS = [1, 7, 30, 90] as const;

const truthy = (v: unknown): boolean => v === true || v === 1 || v === '1' || v === 'true';
const fmtTrust = (v: unknown): string => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : '—';
};
const fmtTs = (v: unknown): string => {
  if (!v) return '—';
  const d = parseTimestamp(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('en-US', { timeZone: 'America/Denver' });
};
const vehDesc = (s: PlateSighting): string =>
  [s.color, s.make, s.model, s.vehicle_type].filter(Boolean).join(' ') || '—';

export default function AnalyticsPage() {
  const { user } = useAuth();
  const canQueryRaw = ['admin', 'manager', 'supervisor'].includes(user?.role ?? '');
  const canExport = ['admin', 'manager'].includes(user?.role ?? '');

  const [searchParams, setSearchParams] = useSearchParams();

  // ── Deep-link: ?report=plates|activity|operations & ?date_range=1|7|30|90 ─
  const initialTab = searchParams.get('report') as Tab | null;
  const initialDays = Number(searchParams.get('date_range') ?? 0);

  const [health, setHealth] = useState<HealthResp | null>(null);
  const [notProvisioned, setNotProvisioned] = useState(false);
  const [days, setDays] = useState<number>(
    ([1, 7, 30, 90] as number[]).includes(initialDays) ? initialDays : 7
  );
  const [tab, setTab] = useState<Tab>(
    TABS.some((t) => t.key === initialTab) ? (initialTab as Tab) : 'plates'
  );

  // Strip deep-link params after mount so they don't persist in history
  useEffect(() => {
    if (searchParams.has('report') || searchParams.has('date_range')) {
      const next = new URLSearchParams(searchParams);
      next.delete('report');
      next.delete('date_range');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Activity tab (flex_events)
  const [eventTypes, setEventTypes] = useState<EventSummaryRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [actLoading, setActLoading] = useState(false);
  const [actError, setActError] = useState<string | null>(null);

  // Operations tab (cfs trends + gps coverage)
  const [cfsTrends, setCfsTrends] = useState<CfsTrendRow[]>([]);
  const [gpsCoverage, setGpsCoverage] = useState<GpsRow[]>([]);
  const [opsLoading, setOpsLoading] = useState(false);
  const [opsError, setOpsError] = useState<string | null>(null);

  // Summary
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  // True distinct-plate/distinct-hit-plate counts (unbounded by summary's
  // top-N-by-volume LIMIT) — see buildAlprDistinctCountSql. Falls back to
  // deriving from `summary` (the old, undercounting behavior) only while
  // this hasn't loaded yet, so the cards don't flash to 0.
  const [distinctCounts, setDistinctCounts] = useState<{ distinct_plates: number; distinct_hit_plates: number } | null>(null);

  // Plate search
  const plateInputRef = useRef<HTMLInputElement>(null);
  const [plateInput, setPlateInput] = useState('');
  const [sightings, setSightings] = useState<PlateSighting[] | null>(null);
  const [plateLoading, setPlateLoading] = useState(false);
  const [plateError, setPlateError] = useState<string | null>(null);
  const [searchedPlate, setSearchedPlate] = useState('');

  // Raw query (command staff only)
  const [showRaw, setShowRaw] = useState(false);
  const [rawSql, setRawSql] = useState('SELECT * FROM default.alpr_reads ORDER BY occurred_at DESC LIMIT 50');
  const [rawRows, setRawRows] = useState<Record<string, unknown>[] | null>(null);
  const [rawLoading, setRawLoading] = useState(false);
  const [rawError, setRawError] = useState<string | null>(null);

  // ConfirmDialog — export confirmation (admin/manager only)
  const [confirmExport, setConfirmExport] = useState(false);

  // 503 from any endpoint => the warehouse isn't provisioned yet.
  const is503 = (err: unknown) => (err as { status?: number })?.status === 503;

  const loadSummary = useCallback(async (d: number) => {
    setSummaryLoading(true); setSummaryError(null);
    try {
      const res = await apiFetch<SummaryResp>(`/analytics/alpr/summary?days=${d}`);
      setSummary(res.plates || []);
      setNotProvisioned(false);
    } catch (err: any) {
      if (is503(err)) { setNotProvisioned(true); setSummary([]); }
      else setSummaryError(err?.message || 'Failed to load summary');
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  const loadDistinctCounts = useCallback(async (d: number) => {
    try {
      const res = await apiFetch<{ distinct_plates: number; distinct_hit_plates: number }>(`/analytics/alpr/distinct-count?days=${d}`);
      setDistinctCounts(res);
    } catch {
      // Best-effort — the "Distinct plates"/"Plates with a hit" cards fall
      // back to deriving from `summary` (top-N-by-volume) when this is null.
      setDistinctCounts(null);
    }
  }, []);

  const loadHealth = useCallback(async () => {
    try {
      const h = await apiFetch<HealthResp>('/analytics/health');
      setHealth(h);
      setNotProvisioned(!h.query_ready);
    } catch (err: any) {
      if (is503(err)) setNotProvisioned(true);
      // a 403 (wrong role) or other error: leave health null; the section
      // loaders surface their own messages.
    }
  }, []);

  useEffect(() => { loadHealth(); }, [loadHealth]);
  useEffect(() => { loadSummary(days); loadDistinctCounts(days); }, [days, loadSummary, loadDistinctCounts]);

  const searchPlate = useCallback(async (plateArg?: string) => {
    const plate = (plateArg ?? plateInput).toUpperCase().replace(/[^A-Z0-9-]/g, '');
    if (!plate) { setPlateError('Enter a plate'); return; }
    setPlateLoading(true); setPlateError(null); setSearchedPlate(plate);
    try {
      const res = await apiFetch<PlateHistoryResp>(`/analytics/alpr/plate/${encodeURIComponent(plate)}?days=${days}`);
      setSightings(res.sightings || []);
      setNotProvisioned(false);
    } catch (err: any) {
      if (is503(err)) { setNotProvisioned(true); setSightings(null); }
      else setPlateError(err?.message || 'Search failed');
    } finally {
      setPlateLoading(false);
    }
  }, [plateInput, days]);

  const runRaw = useCallback(async () => {
    const sql = rawSql.trim();
    if (!sql) return;
    setRawLoading(true); setRawError(null);
    try {
      const res = await apiFetch<{ count: number; rows: Record<string, unknown>[] }>('/analytics/query', {
        method: 'POST',
        body: JSON.stringify({ query: sql }),
      });
      setRawRows(res.rows || []);
    } catch (err: any) {
      if (is503(err)) setNotProvisioned(true);
      setRawError(err?.message || 'Query failed');
    } finally {
      setRawLoading(false);
    }
  }, [rawSql]);

  const loadActivity = useCallback(async (d: number) => {
    setActLoading(true); setActError(null);
    try {
      const [sum, ev] = await Promise.all([
        apiFetch<{ types: EventSummaryRow[] }>(`/analytics/events/summary?days=${d}`),
        apiFetch<{ events: EventRow[] }>(`/analytics/events?days=${d}&limit=100`),
      ]);
      setEventTypes(sum.types || []); setEvents(ev.events || []); setNotProvisioned(false);
    } catch (err: any) {
      if (is503(err)) { setNotProvisioned(true); setEventTypes([]); setEvents([]); }
      else setActError(err?.message || 'Failed to load activity');
    } finally {
      setActLoading(false);
    }
  }, []);

  const loadEventsFiltered = useCallback(async (type: string) => {
    setActLoading(true); setActError(null);
    try {
      const ev = await apiFetch<{ events: EventRow[] }>(`/analytics/events?type=${encodeURIComponent(type)}&days=${days}&limit=100`);
      setEvents(ev.events || []);
    } catch (err: any) {
      if (!is503(err)) setActError(err?.message || 'Failed to load events');
    } finally {
      setActLoading(false);
    }
  }, [days]);

  const loadOps = useCallback(async (d: number) => {
    setOpsLoading(true); setOpsError(null);
    try {
      const [cfs, gps] = await Promise.all([
        apiFetch<{ call_types: CfsTrendRow[] }>(`/analytics/cfs/trends?days=${d}`),
        apiFetch<{ units: GpsRow[] }>(`/analytics/gps/coverage?days=${d}`),
      ]);
      setCfsTrends(cfs.call_types || []); setGpsCoverage(gps.units || []); setNotProvisioned(false);
    } catch (err: any) {
      if (is503(err)) { setNotProvisioned(true); setCfsTrends([]); setGpsCoverage([]); }
      else setOpsError(err?.message || 'Failed to load operations');
    } finally {
      setOpsLoading(false);
    }
  }, []);

  // Lazy-load each tab's data when it becomes active or the window changes.
  useEffect(() => {
    if (tab === 'activity') loadActivity(days);
    else if (tab === 'operations') loadOps(days);
  }, [tab, days, loadActivity, loadOps]);

  // ── Keyboard shortcuts ────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      // N => focus the plate search input (switches to plates tab first)
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        if (tab !== 'plates') setTab('plates');
        // Use rAF so the tab switch re-render has completed
        requestAnimationFrame(() => plateInputRef.current?.focus());
        return;
      }

      // Esc => close confirm dialog first, then raw console
      if (e.key === 'Escape') {
        if (confirmExport) { e.stopPropagation(); setConfirmExport(false); return; }
        if (showRaw) { e.stopPropagation(); setShowRaw(false); return; }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [tab, confirmExport, showRaw]);

  const handleExportConfirmed = useCallback(async () => {
    setConfirmExport(false);
    try {
      const res = await apiFetch<{ url: string }>(`/analytics/alpr/export?days=${days}`);
      if (res.url) window.open(res.url, '_blank', 'noopener');
    } catch {
      // Export is best-effort; the warehouse being unavailable is already surfaced
    }
  }, [days]);

  // health drives notProvisioned only — suppress unused-var warning
  void health;

  const totalReads = summary.reduce((acc, r) => acc + (Number(r.reads) || 0), 0);
  // Prefer the real, unbounded counts from /alpr/distinct-count; fall back to
  // deriving from `summary` (top-N-by-volume rows) only until that loads —
  // the fallback undercounts whenever more than summary's LIMIT distinct
  // plates exist in the window (see buildAlprDistinctCountSql).
  const distinctPlateCount = distinctCounts?.distinct_plates ?? summary.length;
  const hitPlates = distinctCounts?.distinct_hit_plates ?? summary.filter((r) => truthy(r.ever_hit)).length;

  // Convenience: are we in the initial-load state with no data yet?
  const summaryIdle = summaryLoading && summary.length === 0;
  const actIdle = actLoading && eventTypes.length === 0 && events.length === 0;
  const opsIdle = opsLoading && cfsTrends.length === 0 && gpsCoverage.length === 0;

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="PLATE ANALYTICS" icon={ScanSearch}>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-rmpg-400 uppercase tracking-wider">R2 Data Catalog · Iceberg</span>
          {canExport && (
            <button
              onClick={() => setConfirmExport(true)}
              aria-label="Export plate data"
              className="px-2 py-1 text-[11px] font-semibold bg-surface-raised border border-border-default rounded-sm text-rmpg-300 hover:text-brand-400 transition-colors"
            >
              Export
            </button>
          )}
          <button
            type="button"
            disabled={summary.length === 0}
            onClick={() => downloadTextFile('plate-summary.csv', plateSummaryToCsv(summary))}
            className="px-2 py-1 text-[11px] font-semibold bg-surface-raised border border-border-default rounded-sm text-rmpg-300 hover:text-brand-400 transition-colors disabled:opacity-40"
            title="CSV of plate, reads, last seen — current summary window"
          >CSV</button>
          <button
            onClick={() => {
              loadHealth();
              if (tab === 'plates') { loadSummary(days); loadDistinctCounts(days); }
              else if (tab === 'activity') loadActivity(days);
              else loadOps(days);
            }}
            aria-label="Refresh analytics"
            className="p-1.5 text-rmpg-300 hover:text-brand-400 transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </PanelTitleBar>

      {notProvisioned && (
        <div className="bg-amber-900/30 border border-amber-700 rounded-sm p-4 text-sm" role="status">
          <div className="flex items-center gap-2 text-amber-300 font-semibold mb-2">
            <AlertTriangle className="w-4 h-4" /> Analytics lakehouse not provisioned yet
          </div>
          <p className="text-rmpg-300 mb-2">
            The R2 Data Catalog warehouse isn&apos;t wired up, so there&apos;s nothing to query.
            Plate reads are still captured in D1 — this view backfills once the pipeline exists.
          </p>
          <ol className="list-decimal list-inside text-rmpg-400 space-y-0.5 text-[12px]">
            <li><code>npx wrangler pipelines setup</code> — creates the R2 bucket, enables Data Catalog, writes <code>default.alpr_reads</code></li>
            <li>Uncomment <code>[[pipelines]]</code> in <code>wrangler.toml</code> + set the stream id</li>
            <li>Set <code>R2_ANALYTICS_WAREHOUSE</code> var + <code>wrangler secret put R2_SQL_TOKEN</code></li>
            <li>Redeploy — this page lights up automatically</li>
          </ol>
        </div>
      )}

      {/* Window selector */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-rmpg-400 uppercase tracking-wider">Window</span>
        <div className="inline-flex rounded-sm overflow-hidden border border-border-default">
          {DAY_OPTIONS.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1 text-[11px] font-semibold transition-colors ${
                days === d ? 'bg-brand-700 text-rmpg-100' : 'bg-surface-raised text-rmpg-300 hover:text-brand-400'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
        {(summaryLoading || actLoading || opsLoading) && <Loader2 className="w-4 h-4 animate-spin text-brand-400" />}
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border-default">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-[12px] font-semibold border-b-2 -mb-px transition-colors flex items-center gap-1.5 ${
              tab === t.key ? 'border-brand-500 text-brand-400' : 'border-transparent text-rmpg-400 hover:text-rmpg-200'
            }`}
          >
            <t.icon className="w-3.5 h-3.5" />{t.label}
          </button>
        ))}
      </div>

      {/* ── Plates tab ── */}
      {tab === 'plates' && (<>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatsCard icon={ScanSearch} label={`Reads · last ${days}d`} value={totalReads.toLocaleString()} accent="blue" />
        <StatsCard icon={Car} label="Distinct plates" value={distinctPlateCount.toLocaleString()} accent="purple" />
        <StatsCard icon={AlertTriangle} label="Plates w/ a hit" value={hitPlates.toLocaleString()} accent={hitPlates ? 'red' : 'green'} />
      </div>

      {/* Plate search */}
      <div className="bg-surface-raised border border-border-default rounded-sm p-4">
        <h3 className="text-brand-400 font-semibold text-sm mb-3 flex items-center gap-2">
          <Search className="w-4 h-4" /> Where was a plate seen?
        </h3>
        <div className="flex gap-2 mb-3">
          <input
            ref={plateInputRef}
            value={plateInput}
            onChange={(e) => setPlateInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') searchPlate(); }}
            placeholder="Plate number… (N to focus)"
            className="flex-1 bg-surface-sunken border border-border-default rounded-sm px-3 py-2 text-sm text-rmpg-200 font-mono uppercase placeholder:text-rmpg-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            aria-label="Plate number to search"
          />
          <button
            onClick={() => searchPlate()}
            disabled={plateLoading}
            className="px-4 py-2 bg-brand-700 text-rmpg-100 text-sm font-semibold rounded-sm hover:bg-brand-600 disabled:opacity-50 transition-colors"
          >
            {plateLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Search'}
          </button>
        </div>
        {plateError && <p className="text-red-400 text-[12px] mb-2">{plateError}</p>}

        {/* Empty states: loading / no-results / results */}
        {plateLoading && sightings == null && (
          <p className="text-rmpg-400 text-[12px] flex items-center gap-1.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Searching…
          </p>
        )}
        {sightings != null && !plateError && !plateLoading && (
          sightings.length === 0 ? (
            <p className="text-rmpg-400 text-[12px]">No sightings of <span className="font-mono">{searchedPlate}</span> in the last {days} days.</p>
          ) : (
            <div className="overflow-x-auto">
              <p className="text-rmpg-400 text-[11px] mb-1">
                {sightings.length} sighting{sightings.length === 1 ? '' : 's'} of <span className="font-mono text-brand-400">{searchedPlate}</span>
              </p>
              <table className="w-full text-left">
                <thead>
                  <tr className="text-[9px] uppercase tracking-wider text-rmpg-500 border-b border-border-default">
                    <th className="py-[3px] pr-2 font-semibold">When</th>
                    <th className="py-[3px] pr-2 font-semibold">State</th>
                    <th className="py-[3px] pr-2 font-semibold">Vehicle</th>
                    <th className="py-[3px] pr-2 font-semibold">Where</th>
                    <th className="py-[3px] pr-2 font-semibold">Source</th>
                    <th className="py-[3px] pr-2 font-semibold">Trust</th>
                    <th className="py-[3px] pr-2 font-semibold">Hit</th>
                  </tr>
                </thead>
                <tbody>
                  {sightings.map((s, i) => (
                    <tr key={i} className="text-[11px] text-rmpg-200 border-b border-border-subtle hover:bg-surface-sunken">
                      <td className="py-[2px] pr-2 whitespace-nowrap font-mono">{fmtTs(s.occurred_at)}</td>
                      <td className="py-[2px] pr-2">{s.state || '—'}</td>
                      <td className="py-[2px] pr-2">{vehDesc(s)}</td>
                      <td className="py-[2px] pr-2 max-w-[200px] truncate">
                        {s.location_text || (s.lat != null && s.lng != null
                          ? <span className="inline-flex items-center gap-1 text-rmpg-400"><MapPin className="w-3 h-3" />{Number(s.lat).toFixed(4)}, {Number(s.lng).toFixed(4)}</span>
                          : '—')}
                      </td>
                      <td className="py-[2px] pr-2 uppercase text-rmpg-400">{s.source || '—'}</td>
                      <td className="py-[2px] pr-2 font-mono">{fmtTrust(s.trust)}</td>
                      <td className="py-[2px] pr-2">
                        {truthy(s.critical_hit)
                          ? <span className="text-red-400 font-semibold">HIT</span>
                          : (Number(s.hit_count) > 0 ? <span className="text-amber-400">{s.hit_count}</span> : '')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      {/* Busiest plates */}
      <div className="bg-surface-raised border border-border-default rounded-sm p-4">
        <h3 className="text-brand-400 font-semibold text-sm mb-3 flex items-center gap-2">
          <Database className="w-4 h-4" /> Busiest plates · last {days} days
        </h3>
        {summaryError && (
          <p className="text-red-400 text-[12px] flex items-center justify-between gap-2">
            <span>{summaryError}</span>
            <button type="button" className="toolbar-btn text-[10px]" onClick={() => loadSummary(days)}>Retry</button>
          </p>
        )}
        {summaryIdle && (
          <p className="text-rmpg-400 text-[12px] flex items-center gap-1.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading plate summary…
          </p>
        )}
        {!summaryError && !notProvisioned && summary.length === 0 && !summaryLoading && (
          <p className="text-rmpg-400 text-[12px]">No reads recorded in this window yet.</p>
        )}
        {summary.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[9px] uppercase tracking-wider text-rmpg-500 border-b border-border-default">
                  <th className="py-[3px] pr-2 font-semibold">Plate</th>
                  <th className="py-[3px] pr-2 font-semibold text-right">Reads</th>
                  <th className="py-[3px] pr-2 font-semibold">Last seen</th>
                  <th className="py-[3px] pr-2 font-semibold">Hit</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((r, i) => (
                  <tr
                    key={i}
                    className="text-[11px] text-rmpg-200 border-b border-border-subtle hover:bg-surface-sunken cursor-pointer"
                    onClick={() => { if (r.plate) { setPlateInput(String(r.plate)); searchPlate(String(r.plate)); } }}
                  >
                    <td className="py-[2px] pr-2 font-mono text-brand-400">{r.plate || '—'}</td>
                    <td className="py-[2px] pr-2 text-right font-mono">{Number(r.reads || 0).toLocaleString()}</td>
                    <td className="py-[2px] pr-2 whitespace-nowrap font-mono">{fmtTs(r.last_seen)}</td>
                    <td className="py-[2px] pr-2">{truthy(r.ever_hit) ? <span className="text-red-400 font-semibold">HIT</span> : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </>)}

      {/* ── Activity tab — system-wide event firehose (flex_events) ── */}
      {tab === 'activity' && (
        <div className="space-y-4">
          {actError && <p className="text-red-400 text-[12px]">{actError}</p>}
          <div className="bg-surface-raised border border-border-default rounded-sm p-4">
            <h3 className="text-brand-400 font-semibold text-sm mb-3 flex items-center gap-2">
              <Activity className="w-4 h-4" /> Event volume · last {days} days
            </h3>
            {actIdle && (
              <p className="text-rmpg-400 text-[12px] flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading activity…
              </p>
            )}
            {!actLoading && eventTypes.length === 0 && (
              <p className="text-rmpg-400 text-[12px]">No events recorded in this window yet.</p>
            )}
            {eventTypes.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {eventTypes.map((t, i) => (
                  <button
                    key={i}
                    onClick={() => loadEventsFiltered(String(t.event_type ?? ''))}
                    className="text-left bg-surface-sunken border border-border-subtle rounded-sm p-2 hover:border-brand-600 transition-colors"
                  >
                    <div className="text-[10px] uppercase text-rmpg-400 truncate">{toDisplayLabel(t.event_type || '—')}</div>
                    <div className="text-lg font-mono text-brand-400">{Number(t.events || 0).toLocaleString()}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="bg-surface-raised border border-border-default rounded-sm p-4">
            <h3 className="text-brand-400 font-semibold text-sm mb-3">Recent activity</h3>
            {actIdle && (
              <p className="text-rmpg-400 text-[12px] flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading events…
              </p>
            )}
            {!actLoading && events.length === 0 && (
              <p className="text-rmpg-400 text-[12px]">No recent events.</p>
            )}
            {events.length > 0 && (
              <div className="overflow-x-auto max-h-[28rem] overflow-y-auto">
                <table className="w-full text-left">
                  <thead className="sticky top-0 bg-surface-raised">
                    <tr className="text-[9px] uppercase tracking-wider text-rmpg-500 border-b border-border-default">
                      <th className="py-[3px] pr-2 font-semibold">When</th>
                      <th className="py-[3px] pr-2 font-semibold">Event</th>
                      <th className="py-[3px] pr-2 font-semibold">Entity</th>
                      <th className="py-[3px] pr-2 font-semibold">Detail</th>
                      <th className="py-[3px] pr-2 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((e, i) => (
                      <tr key={i} className="text-[11px] text-rmpg-200 border-b border-border-subtle hover:bg-surface-sunken">
                        <td className="py-[2px] pr-2 whitespace-nowrap font-mono">{fmtTs(e.occurred_at)}</td>
                        <td className="py-[2px] pr-2 uppercase text-brand-400">{toDisplayLabel(e.event_type || '—')}</td>
                        <td className="py-[2px] pr-2">{e.entity_type ? `${e.entity_type} ${e.entity_id ?? ''}`.trim() : '—'}</td>
                        <td className="py-[2px] pr-2 max-w-[240px] truncate">{e.label || '—'}{e.priority ? ` · ${e.priority}` : ''}</td>
                        <td className="py-[2px] pr-2">{e.status || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Operations tab — CFS trends + patrol/AVL coverage ── */}
      {tab === 'operations' && (
        <div className="space-y-4">
          {opsError && <p className="text-red-400 text-[12px]">{opsError}</p>}
          <div className="bg-surface-raised border border-border-default rounded-sm p-4">
            <h3 className="text-brand-400 font-semibold text-sm mb-3 flex items-center gap-2">
              <Database className="w-4 h-4" /> Calls for service by type · last {days} days
            </h3>
            {opsIdle && (
              <p className="text-rmpg-400 text-[12px] flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading CFS trends…
              </p>
            )}
            {!opsLoading && cfsTrends.length === 0 && (
              <p className="text-rmpg-400 text-[12px]">No calls recorded in this window yet.</p>
            )}
            {cfsTrends.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-[9px] uppercase tracking-wider text-rmpg-500 border-b border-border-default">
                      <th className="py-[3px] pr-2 font-semibold">Call type</th>
                      <th className="py-[3px] pr-2 font-semibold">Priority</th>
                      <th className="py-[3px] pr-2 font-semibold text-right">Calls</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cfsTrends.map((r, i) => (
                      <tr key={i} className="text-[11px] text-rmpg-200 border-b border-border-subtle">
                        <td className="py-[2px] pr-2">{r.call_type || '—'}</td>
                        <td className="py-[2px] pr-2">{r.priority || '—'}</td>
                        <td className="py-[2px] pr-2 text-right font-mono">{Number(r.calls || 0).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="bg-surface-raised border border-border-default rounded-sm p-4">
            <h3 className="text-brand-400 font-semibold text-sm mb-3 flex items-center gap-2">
              <Gauge className="w-4 h-4" /> Patrol / AVL coverage by unit · last {days} days
            </h3>
            {opsIdle && (
              <p className="text-rmpg-400 text-[12px] flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading AVL coverage…
              </p>
            )}
            {!opsLoading && gpsCoverage.length === 0 && (
              <p className="text-rmpg-400 text-[12px]">No AVL pings in this window yet.</p>
            )}
            {gpsCoverage.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-[9px] uppercase tracking-wider text-rmpg-500 border-b border-border-default">
                      <th className="py-[3px] pr-2 font-semibold">Unit</th>
                      <th className="py-[3px] pr-2 font-semibold text-right">Pings</th>
                      <th className="py-[3px] pr-2 font-semibold">Last seen</th>
                      <th className="py-[3px] pr-2 font-semibold text-right">Avg speed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gpsCoverage.map((r, i) => (
                      <tr key={i} className="text-[11px] text-rmpg-200 border-b border-border-subtle">
                        <td className="py-[2px] pr-2 font-mono">{r.unit_id || '—'}</td>
                        <td className="py-[2px] pr-2 text-right font-mono">{Number(r.pings || 0).toLocaleString()}</td>
                        <td className="py-[2px] pr-2 whitespace-nowrap font-mono">{fmtTs(r.last_at)}</td>
                        <td className="py-[2px] pr-2 text-right font-mono">{r.avg_speed != null ? Number(r.avg_speed).toFixed(1) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Raw R2 SQL console — command staff only ── */}
      {canQueryRaw && (
        <div className="bg-surface-raised border border-border-default rounded-sm">
          <button
            onClick={() => setShowRaw((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-2 text-left"
            aria-expanded={showRaw}
          >
            <span className="text-brand-400 font-semibold text-sm flex items-center gap-2">
              <Terminal className="w-4 h-4" /> R2 SQL console
            </span>
            <span className="text-rmpg-500 text-[11px]">{showRaw ? 'Hide' : 'Show'} · read-only</span>
          </button>
          {showRaw && (
            <div className="px-4 pb-4 space-y-2">
              <textarea
                value={rawSql}
                onChange={(e) => setRawSql(e.target.value)}
                rows={3}
                spellCheck={false}
                className="w-full bg-surface-sunken border border-border-default rounded-sm px-3 py-2 text-[12px] text-rmpg-200 font-mono focus:outline-none focus:ring-1 focus:ring-brand-500"
                aria-label="R2 SQL query"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={runRaw}
                  disabled={rawLoading}
                  className="px-4 py-1.5 bg-brand-700 text-rmpg-100 text-[12px] font-semibold rounded-sm hover:bg-brand-600 disabled:opacity-50 transition-colors"
                >
                  {rawLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Run'}
                </button>
                <span className="text-rmpg-500 text-[10px]">SELECT / SHOW / DESCRIBE only — R2 SQL has no write grammar.</span>
              </div>
              {rawError && <p className="text-red-400 text-[12px]">{rawError}</p>}
              {rawRows != null && !rawError && (
                rawRows.length === 0
                  ? <p className="text-rmpg-400 text-[12px]">0 rows.</p>
                  : (
                    <div className="overflow-x-auto max-h-80 overflow-y-auto">
                      <table className="w-full text-left">
                        <thead className="sticky top-0 bg-surface-raised">
                          <tr className="text-[9px] uppercase tracking-wider text-rmpg-500 border-b border-border-default">
                            {Object.keys(rawRows[0]).map((k) => <th key={k} className="py-[3px] pr-2 font-semibold">{toDisplayLabel(k)}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {rawRows.map((row, i) => (
                            <tr key={i} className="text-[11px] text-rmpg-200 border-b border-border-subtle">
                              {Object.keys(rawRows[0]).map((k) => (
                                <td key={k} className="py-[2px] pr-2 font-mono whitespace-nowrap">
                                  {row[k] == null ? '—' : String(row[k])}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
              )}
            </div>
          )}
        </div>
      )}

      {/* Export confirmation — admin/manager only */}
      <ConfirmDialog
        isOpen={confirmExport}
        onClose={() => setConfirmExport(false)}
        onConfirm={handleExportConfirmed}
        title="Export plate analytics"
        message={`Export all plate reads from the last ${days} days as a CSV download. This may take a moment for large windows.`}
        confirmLabel="Export"
        confirmVariant="default"
      />
    </div>
  );
}
