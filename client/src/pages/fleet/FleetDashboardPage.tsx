// ============================================================
// RMPG Flex — Fleet Dashboard (Fleet.io PR 7-9 client)
// ============================================================
// The only client consumer of /api/fleet-viz/*. That backend (KPI ribbon,
// vehicle dossier, readiness board, fleet map, PM timeline, MPG-by-officer,
// cost-per-mile, WO flow, fuel anomalies, calls-per-gallon, PM upcoming) was
// fully built and tested but had no page rendering it — this closes that
// gap. See docs/superpowers/specs/2026-06-21-fleetio-integration-design.md
// PRs 7-9 for the endpoint contracts this page consumes verbatim.
// ============================================================

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router';
import mapboxgl from 'mapbox-gl';
import {
  ArrowLeft, Gauge, Wrench, AlertTriangle, Fuel, DollarSign, Route,
  Loader2, X, Car, MapPin, Award, Wallet,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { apiFetch } from '../../hooks/useApi';
import { useToast } from '../../components/ToastProvider';
import PanelTitleBar from '../../components/PanelTitleBar';
import StatsCard from '../../components/StatsCard';
import IconButton from '../../components/IconButton';
import { getMapboxToken } from '../../utils/mapboxApiKey';
import { injectMapboxStyles } from '../../utils/mapboxLoader';
import { applyRmpgBasemap } from '../../utils/mapboxBasemap';
import { useWebglMapRecovery } from '../../hooks/useWebglMapRecovery';
import { toDisplayLabel } from '../../utils/formatters';
import { parseTimestamp } from '../../utils/dateUtils';
import { downloadTextFile, fleetListToCsv } from '../../utils/rmsListExport';

// ------------------------------------------------------------
// Types — mirror the JSON shapes returned by src/routes/fleetViz.ts
// ------------------------------------------------------------

type Period = '7d' | '30d' | '90d' | '365d' | 'ytd' | 'all';

interface KpiData {
  period: string;
  in_service: number;
  in_shop: number;
  overdue_pms: number;
  /** null when no full-tank-to-full-tank segment survived the derivation
   *  guards — distinct from a measured 0. Render as an em dash. */
  avg_mpg: number | null;
  /** How many fuel segments contributed to avg_mpg. 0 means "not measurable". */
  avg_mpg_samples?: number;
  cost_per_mile: number | null;
  total_cost: number;
  miles_driven: number;
}

interface ReadinessRow {
  id: number;
  vehicle_name: string | null;
  vehicle_number: string;
  status: string;
  current_mileage: number | null;
  next_service_mileage: number | null;
  miles_to_pm: number | null;
  next_service_date: string | null;
  open_work_orders: number;
  last_inspection_failed: number | null;
  last_fuel_level: number | null;
}

interface FleetMapRow {
  id: number;
  vehicle_number: string;
  status: string;
  lat: number | null;
  lng: number | null;
  gps_ts: string | null;
  readiness: 'ready' | 'attention' | 'unavailable';
}

interface PmUpcomingRow {
  id: number;
  vehicle_number: string;
  vehicle_name: string | null;
  current_mileage: number | null;
  next_service_mileage: number | null;
  next_service_date: string | null;
  miles_to_pm: number | null;
}

interface CostPerMileRow {
  vehicle_id: number;
  vehicle_number: string;
  vehicle_name: string | null;
  miles: number;
  fuel_cost: number;
  maintenance_cost: number;
  parts_cost: number;
  total: number;
  cost_per_mile: number | null;
}

interface MpgByOfficerRow {
  officer_id: number;
  officer_name: string;
  samples: number;
  mean_mpg: number;
  total_gallons: number;
  total_cost: number;
}

interface CallsPerGallonRow {
  officer_id: number;
  officer_name: string;
  total_gallons: number;
  calls_handled: number;
  calls_per_gallon: number;
}

interface WoFlowNode { name: string; count: number }

interface FuelAnomalyRow {
  id: number;
  fuel_date: string;
  gallons: number;
  total_cost: number;
  driver_name: string | null;
  vehicle_id: number;
  cost_per_gallon: number;
  z_gallons: number;
  z_cost_per_gallon: number;
  flagged: boolean;
}

interface Dossier {
  vehicle: Record<string, unknown>;
  fuel_log: Record<string, unknown>[];
  mpg_points: { fuel_date: string; mpg: number }[];
  maintenance: Record<string, unknown>[];
  open_work_orders: number;
  inspections_90d: number;
  failed_inspections_90d: number;
  calls_handled_90d: number;
}

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: '7d', label: '7 Days' }, { value: '30d', label: '30 Days' },
  { value: '90d', label: '90 Days' }, { value: '365d', label: '1 Year' },
  { value: 'ytd', label: 'YTD' }, { value: 'all', label: 'All Time' },
];

const READINESS_COLOR: Record<string, string> = {
  ready: 'var(--sev-ok)', attention: 'var(--sev-warn)', unavailable: 'var(--text-muted)',
};

const chartTooltipStyle = {
  backgroundColor: 'var(--surface-raised)',
  border: '1px solid var(--border-strong)',
  borderRadius: '2px',
  color: 'var(--text-primary)',
  fontSize: '11px',
  padding: '6px 10px',
};

export default function FleetDashboardPage() {
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [period, setPeriod] = useState<Period>('30d');
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);

  const [kpi, setKpi] = useState<KpiData | null>(null);
  const [readiness, setReadiness] = useState<ReadinessRow[]>([]);
  const [mapRows, setMapRows] = useState<FleetMapRow[]>([]);
  const [pmUpcoming, setPmUpcoming] = useState<PmUpcomingRow[]>([]);
  const [costPerMile, setCostPerMile] = useState<CostPerMileRow[]>([]);
  const [mpgByOfficer, setMpgByOfficer] = useState<MpgByOfficerRow[]>([]);
  const [callsPerGallon, setCallsPerGallon] = useState<CallsPerGallonRow[]>([]);
  const [woFlow, setWoFlow] = useState<WoFlowNode[]>([]);
  const [fuelAnomalies, setFuelAnomalies] = useState<FuelAnomalyRow[]>([]);

  const [dossierId, setDossierId] = useState<number | null>(null);
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [dossierLoading, setDossierLoading] = useState(false);

  const load = useCallback(async (p: Period) => {
    setLoading(true);
    setFetchError(false);
    try {
      const q = `?period=${p}`;
      const [
        kpiRes, readinessRes, mapRes, pmRes, cpmRes, mpgRes, cpgRes, woRes, anomRes,
      ] = await Promise.all([
        apiFetch<KpiData>(`/fleet-viz/kpi${q}`),
        apiFetch<{ data: ReadinessRow[] }>('/fleet-viz/readiness'),
        apiFetch<{ data: FleetMapRow[] }>('/fleet-viz/fleet-map'),
        apiFetch<{ data: PmUpcomingRow[] }>('/fleet-viz/pm-upcoming?limit=15'),
        apiFetch<{ data: CostPerMileRow[] }>(`/fleet-viz/cost-per-mile${q}`),
        apiFetch<{ by_officer: MpgByOfficerRow[] }>(`/fleet-viz/mpg-by-officer${q}`),
        apiFetch<{ data: CallsPerGallonRow[] }>(`/fleet-viz/calls-per-gallon${q}`),
        apiFetch<{ nodes: WoFlowNode[] }>(`/fleet-viz/work-order-flow${q}`),
        apiFetch<{ data: FuelAnomalyRow[] }>(`/fleet-viz/fuel-anomalies${q}`),
      ]);
      setKpi(kpiRes);
      setReadiness(readinessRes.data || []);
      setMapRows(mapRes.data || []);
      setPmUpcoming(pmRes.data || []);
      setCostPerMile((cpmRes.data || []).sort((a, b) => b.total - a.total).slice(0, 15));
      setMpgByOfficer((mpgRes.by_officer || []).sort((a, b) => b.mean_mpg - a.mean_mpg));
      setCallsPerGallon((cpgRes.data || []).slice(0, 15));
      setWoFlow(woRes.nodes || []);
      setFuelAnomalies((anomRes.data || []).filter((r) => r.flagged));
    } catch (err) {
      setFetchError(true);
      addToast(err instanceof Error ? `Failed to load fleet dashboard: ${err.message}` : 'Failed to load fleet dashboard', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { load(period); }, [load, period]);

  const openDossier = useCallback((id: number) => {
    setDossierId(id);
    setDossier(null);
    setDossierLoading(true);
    apiFetch<Dossier>(`/fleet-viz/dossier/${id}`)
      .then(setDossier)
      .catch((err) => addToast(err instanceof Error ? err.message : 'Failed to load vehicle dossier', 'error'))
      .finally(() => setDossierLoading(false));
  }, [addToast]);

  // PM timeline buckets (V2) — derived client-side from pmUpcoming's own
  // overdue/upcoming/future ordering isn't available on that endpoint, so
  // bucket here from the same overdue/miles_to_pm logic the server uses.
  const pmBuckets = useMemo(() => {
    const now = Date.now();
    let overdue = 0, upcoming = 0, future = 0;
    for (const r of pmUpcoming) {
      const overdueByDate = r.next_service_date ? parseTimestamp(r.next_service_date).getTime() < now : false;
      const overdueByMiles = r.miles_to_pm != null && r.miles_to_pm < 0;
      if (overdueByDate || overdueByMiles) overdue++;
      else if (r.miles_to_pm != null && r.miles_to_pm <= 1000) upcoming++;
      else future++;
    }
    return { overdue, upcoming, future };
  }, [pmUpcoming]);

  // ---- Fleet map (V1) ----
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const webglRecoveryCleanupRef = useRef<(() => void) | null>(null);
  const { rebuildNonce, attach, onMapLoaded } = useWebglMapRecovery();
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current) return;
    let cancelled = false;
    injectMapboxStyles();
    (async () => {
      try {
        const token = await getMapboxToken();
        if (!token || cancelled || !mapContainerRef.current) {
          if (!cancelled) setMapError('Mapbox token not configured');
          return;
        }
        mapboxgl.accessToken = token;
        const map = new mapboxgl.Map({
          container: mapContainerRef.current,
          style: 'mapbox://styles/mapbox/dark-v11',
          center: [-111.891, 40.7608],
          zoom: 10,
          projection: 'mercator',
          interactive: true,
          attributionControl: false,
        });
        map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');
        map.on('style.load', () => applyRmpgBasemap(map, { variant: 'dark' }));
        const markReady = () => { if (!cancelled) { onMapLoaded(map); setMapLoaded(true); } };
        map.on('load', markReady);
        map.on('idle', markReady);
        map.on('error', (e: mapboxgl.ErrorEvent) => { if (!cancelled) setMapError(e.error?.message || 'Map error'); });
        mapRef.current = map;
        webglRecoveryCleanupRef.current = attach(map, 'FleetDashboardPage');
      } catch (err) {
        if (!cancelled) setMapError(err instanceof Error ? err.message : 'Failed to load map');
      }
    })();
    return () => {
      cancelled = true;
      webglRecoveryCleanupRef.current?.();
      webglRecoveryCleanupRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      setMapLoaded(false);
    };
  }, [rebuildNonce]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    const bounds = new mapboxgl.LngLatBounds();
    let hasPoints = false;
    mapRows.filter((r) => r.lat != null && r.lng != null).forEach((r) => {
      const el = document.createElement('div');
      el.style.cssText = `width:14px;height:14px;border-radius:50%;border:2px solid var(--surface-sunken);background:${READINESS_COLOR[r.readiness] || 'var(--text-muted)'};cursor:pointer;box-shadow:0 0 4px rgb(0 0 0 / 0.6);`;
      el.title = `${r.vehicle_number} — ${toDisplayLabel(r.readiness)}`;
      el.addEventListener('click', () => openDossier(r.id));
      const marker = new mapboxgl.Marker({ element: el }).setLngLat([r.lng!, r.lat!]).addTo(map);
      markersRef.current.push(marker);
      bounds.extend([r.lng!, r.lat!]);
      hasPoints = true;
    });
    if (hasPoints) map.fitBounds(bounds, { padding: 40, maxZoom: 13, duration: 500 });
  }, [mapRows, mapLoaded, openDossier]);

  return (
    <div className="p-3 space-y-3">
      <PanelTitleBar title="FLEET DASHBOARD" icon={Gauge}>
        <IconButton aria-label="Back to Fleet" onClick={() => navigate('/fleet')} className="toolbar-btn">
          <ArrowLeft className="w-3 h-3" /> Back
        </IconButton>
        <div className="flex gap-1 ml-2">
          {PERIOD_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setPeriod(o.value)}
              className="px-2 py-0.5 text-[10px] font-mono border transition-colors"
              style={{
                background: period === o.value ? 'var(--surface-raised)' : 'transparent',
                borderColor: period === o.value ? 'var(--accent-silver-400)' : 'var(--border-default)',
                color: period === o.value ? 'var(--accent-silver-400)' : 'var(--text-muted)',
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="toolbar-btn"
          disabled={readiness.length === 0}
          onClick={() => downloadTextFile('fleet-readiness.csv', fleetListToCsv(readiness.map((r) => ({
            unit: r.vehicle_number,
            status: r.status,
            make: '',
            model: '',
            plate: '',
          }))))}
        >CSV</button>
      </PanelTitleBar>

      {fetchError && (
        <div className="p-3 text-xs text-red-400 flex items-center justify-between">
          <span>Failed to load fleet dashboard.</span>
          <button type="button" className="toolbar-btn" onClick={() => { void load(period); }}>Retry</button>
        </div>
      )}

      {loading && !kpi ? (
        <div className="flex items-center justify-center gap-2 text-fg-muted py-10 text-xs">
          <Loader2 className="w-5 h-5 animate-spin" role="status" aria-label="Loading dashboard" /> Loading fleet dashboard...
        </div>
      ) : (
        <>
          {/* F1: KPI ribbon */}
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2">
            <StatsCard icon={Car} label="In Service" value={kpi?.in_service ?? 0} accent="green" />
            <StatsCard icon={Wrench} label="In Shop" value={kpi?.in_shop ?? 0} accent="amber" />
            <StatsCard icon={AlertTriangle} label="Overdue PMs" value={kpi?.overdue_pms ?? 0} accent={kpi && kpi.overdue_pms > 0 ? 'red' : 'gray'} />
            {/* Em dash, not 0, when no full-tank-to-full-tank segment exists
                in the window — same convention as Cost / Mile beside it.
                Rendering 0 asserted a measured "0.0 MPG" that was really
                "not measurable", which is how this read 0 while the Fleet
                page showed 11.3 for the same vehicle. */}
            <StatsCard icon={Fuel} label="Avg MPG" value={kpi?.avg_mpg != null ? kpi.avg_mpg : '—'} accent="blue" />
            <StatsCard icon={DollarSign} label="Cost / Mile" value={kpi?.cost_per_mile != null ? `$${kpi.cost_per_mile.toFixed(2)}` : '—'} accent="purple" />
            <StatsCard icon={Wallet} label="Total Cost" value={`$${(kpi?.total_cost ?? 0).toLocaleString()}`} accent="gold" />
            <StatsCard icon={Route} label="Miles Driven" value={(kpi?.miles_driven ?? 0).toLocaleString()} accent="blue" />
          </div>

          {/* V1 fleet map + F3 readiness board */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="panel-beveled bg-surface-sunken p-2">
              <div className="flex items-center gap-1 text-[8px] text-fg-muted uppercase font-bold tracking-wider mb-1.5">
                <MapPin className="w-3 h-3 text-brand-400" /> Fleet Map
              </div>
              <div className="relative" style={{ height: 260 }}>
                <div ref={mapContainerRef} className="w-full h-full" />
                {!mapLoaded && !mapError && (
                  <div className="absolute inset-0 flex items-center justify-center bg-surface-base/80">
                    <Loader2 className="w-5 h-5 text-fg-muted animate-spin" />
                  </div>
                )}
                {mapError && (
                  <div className="absolute inset-0 flex items-center justify-center bg-surface-base/90 px-4 text-center">
                    <span className="text-[10px] text-fg-muted">{mapError}</span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3 mt-1.5">
                {(['ready', 'attention', 'unavailable'] as const).map((k) => (
                  <div key={k} className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full" style={{ background: READINESS_COLOR[k] }} />
                    <span className="text-[9px] text-fg-muted uppercase">{k}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel-beveled bg-surface-sunken p-2">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1 text-[8px] text-fg-muted uppercase font-bold tracking-wider">
                  <Gauge className="w-3 h-3 text-brand-400" /> Readiness Board
                </div>
                <span className="text-[9px] text-fg-muted">{readiness.length} vehicles</span>
              </div>
              <div className="overflow-y-auto" style={{ maxHeight: 260 }}>
                <table className="w-full text-[10px]">
                  <thead className="sticky top-0 bg-surface-sunken">
                    <tr className="text-fg-muted border-b border-rmpg-700">
                      <th className="text-left py-1">Vehicle</th>
                      <th className="text-left">Status</th>
                      <th className="text-right">Miles→PM</th>
                      <th className="text-right">Open WOs</th>
                      <th className="text-center">Insp.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {readiness.map((r) => (
                      <tr
                        key={r.id}
                        className="border-b border-rmpg-800 hover:bg-surface-raised/40 cursor-pointer transition-colors"
                        onClick={() => openDossier(r.id)}
                      >
                        <td className="py-1 font-mono text-rmpg-200">{r.vehicle_number}</td>
                        <td className="text-fg-muted">{toDisplayLabel(r.status)}</td>
                        <td className={`text-right font-mono ${r.miles_to_pm != null && r.miles_to_pm < 0 ? 'text-red-400' : r.miles_to_pm != null && r.miles_to_pm < 1000 ? 'text-amber-400' : 'text-fg-secondary'}`}>
                          {r.miles_to_pm != null ? r.miles_to_pm.toLocaleString() : '—'}
                        </td>
                        <td className="text-right font-mono text-fg-secondary">{r.open_work_orders}</td>
                        <td className="text-center">{r.last_inspection_failed ? <span className="text-red-400">FAIL</span> : <span className="text-green-400">OK</span>}</td>
                      </tr>
                    ))}
                    {readiness.length === 0 && (
                      <tr><td colSpan={5} className="text-center text-fg-muted py-3">No vehicles</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* V2 + V8: PM timeline / upcoming */}
          <div className="panel-beveled bg-surface-sunken p-2">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1 text-[8px] text-fg-muted uppercase font-bold tracking-wider">
                <Wrench className="w-3 h-3 text-brand-400" /> Preventive Maintenance
              </div>
              <div className="flex items-center gap-3 text-[9px]">
                <span className="text-red-400 font-bold">{pmBuckets.overdue} overdue</span>
                <span className="text-amber-400 font-bold">{pmBuckets.upcoming} upcoming</span>
                <span className="text-fg-muted">{pmBuckets.future} future</span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="text-fg-muted border-b border-rmpg-700">
                    <th className="text-left py-1">Vehicle</th>
                    <th className="text-right">Current Mi.</th>
                    <th className="text-right">Next Service Mi.</th>
                    <th className="text-right">Miles To PM</th>
                    <th className="text-right">Next Service Date</th>
                  </tr>
                </thead>
                <tbody>
                  {pmUpcoming.map((r) => (
                    <tr key={r.id} className="border-b border-rmpg-800 hover:bg-surface-raised/40 cursor-pointer" onClick={() => openDossier(r.id)}>
                      <td className="py-1 font-mono text-rmpg-200">{r.vehicle_number}</td>
                      <td className="text-right font-mono text-fg-secondary">{r.current_mileage?.toLocaleString() ?? '—'}</td>
                      <td className="text-right font-mono text-fg-secondary">{r.next_service_mileage?.toLocaleString() ?? '—'}</td>
                      <td className={`text-right font-mono ${r.miles_to_pm != null && r.miles_to_pm < 0 ? 'text-red-400 font-bold' : 'text-fg-secondary'}`}>{r.miles_to_pm?.toLocaleString() ?? '—'}</td>
                      <td className="text-right text-fg-muted">{r.next_service_date || '—'}</td>
                    </tr>
                  ))}
                  {pmUpcoming.length === 0 && (
                    <tr><td colSpan={5} className="text-center text-fg-muted py-3">No upcoming PM events</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* V4 + V3 + V7: cost/mile, MPG by officer, calls per gallon */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
            <div className="panel-beveled bg-surface-sunken p-2">
              <div className="flex items-center gap-1 text-[8px] text-fg-muted uppercase font-bold tracking-wider mb-1.5">
                <DollarSign className="w-3 h-3 text-brand-400" /> Cost Per Mile (Top 15)
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={costPerMile} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                  <XAxis dataKey="vehicle_number" tick={{ fill: 'var(--text-muted)', fontSize: 8 }} interval={0} angle={-40} textAnchor="end" height={50} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 9 }} />
                  <Tooltip contentStyle={chartTooltipStyle} formatter={(v: any, n: any) => [`$${Number(v).toFixed(2)}`, n === 'fuel_cost' ? 'Fuel' : 'Maintenance']} />
                  <Bar dataKey="fuel_cost" stackId="cost" fill="var(--stat-accent-amber)" />
                  <Bar dataKey="maintenance_cost" stackId="cost" fill="var(--stat-accent-red)" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="panel-beveled bg-surface-sunken p-2">
              <div className="flex items-center gap-1 text-[8px] text-fg-muted uppercase font-bold tracking-wider mb-1.5">
                <Fuel className="w-3 h-3 text-brand-400" /> MPG By Officer
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={mpgByOfficer.slice(0, 15)} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                  <XAxis dataKey="officer_name" tick={{ fill: 'var(--text-muted)', fontSize: 8 }} interval={0} angle={-40} textAnchor="end" height={50} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 9 }} />
                  <Tooltip contentStyle={chartTooltipStyle} formatter={(v: any) => [`${Number(v).toFixed(1)} mpg`, 'Mean MPG']} />
                  <Bar dataKey="mean_mpg" fill="var(--stat-accent-green)" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="panel-beveled bg-surface-sunken p-2">
              <div className="flex items-center gap-1 text-[8px] text-fg-muted uppercase font-bold tracking-wider mb-1.5">
                <Award className="w-3 h-3 text-brand-400" /> Calls Per Gallon
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={callsPerGallon} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                  <XAxis dataKey="officer_name" tick={{ fill: 'var(--text-muted)', fontSize: 8 }} interval={0} angle={-40} textAnchor="end" height={50} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 9 }} />
                  <Tooltip contentStyle={chartTooltipStyle} formatter={(v: any) => [Number(v).toFixed(2), 'Calls/Gal']} />
                  <Bar dataKey="calls_per_gallon" fill="var(--accent-silver-400)" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* V5 + V6: work order flow, fuel anomalies */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            <div className="panel-beveled bg-surface-sunken p-2">
              <div className="flex items-center gap-1 text-[8px] text-fg-muted uppercase font-bold tracking-wider mb-1.5">
                <Wrench className="w-3 h-3 text-brand-400" /> Work Order Flow
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={woFlow} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" horizontal={false} />
                  <XAxis type="number" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} width={90} tickFormatter={(v) => toDisplayLabel(String(v))} />
                  <Tooltip contentStyle={chartTooltipStyle} formatter={(v: any) => [v, 'Work Orders']} />
                  <Bar dataKey="count" radius={[0, 2, 2, 0]}>
                    {woFlow.map((n, i) => (
                      <Cell key={i} fill={n.name === 'cancelled' ? 'var(--stat-accent-red)' : n.name === 'completed' ? 'var(--stat-accent-green)' : 'var(--stat-accent-amber)'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="panel-beveled bg-surface-sunken p-2">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1 text-[8px] text-fg-muted uppercase font-bold tracking-wider">
                  <AlertTriangle className="w-3 h-3 text-brand-400" /> Fuel Anomalies (|z| &gt; 2)
                </div>
                <span className="text-[9px] text-fg-muted">{fuelAnomalies.length} flagged</span>
              </div>
              <div className="overflow-y-auto" style={{ maxHeight: 180 }}>
                <table className="w-full text-[10px]">
                  <thead className="sticky top-0 bg-surface-sunken">
                    <tr className="text-fg-muted border-b border-rmpg-700">
                      <th className="text-left py-1">Date</th>
                      <th className="text-left">Driver</th>
                      <th className="text-right">Gal</th>
                      <th className="text-right">$/Gal</th>
                      <th className="text-right">Z</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fuelAnomalies.map((r) => (
                      <tr key={r.id} className="border-b border-rmpg-800">
                        <td className="py-1 text-fg-muted">{r.fuel_date}</td>
                        <td className="text-fg-secondary">{r.driver_name || '—'}</td>
                        <td className="text-right font-mono text-fg-secondary">{r.gallons.toFixed(1)}</td>
                        <td className="text-right font-mono text-fg-secondary">${r.cost_per_gallon.toFixed(2)}</td>
                        <td className="text-right font-mono text-red-400 font-bold">
                          {Math.abs(r.z_gallons) > Math.abs(r.z_cost_per_gallon) ? r.z_gallons.toFixed(1) : r.z_cost_per_gallon.toFixed(1)}
                        </td>
                      </tr>
                    ))}
                    {fuelAnomalies.length === 0 && (
                      <tr><td colSpan={5} className="text-center text-fg-muted py-3">No anomalies flagged this period</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}

      {/* F2: Vehicle dossier drawer */}
      {dossierId != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/60" onClick={() => setDossierId(null)}>
          <div
            className="panel-beveled bg-surface-base h-full w-full max-w-md overflow-y-auto p-3"
            role="dialog"
            aria-modal="true"
            aria-label="Vehicle dossier"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold text-rmpg-100">Vehicle Dossier</h3>
              <IconButton aria-label="Close dossier" onClick={() => setDossierId(null)}><X className="w-4 h-4" /></IconButton>
            </div>
            {dossierLoading ? (
              <div className="flex items-center justify-center gap-2 text-fg-muted py-10 text-xs">
                <Loader2 className="w-5 h-5 animate-spin" /> Loading...
              </div>
            ) : dossier ? (
              <div className="space-y-3 text-xs">
                <div className="panel-inset p-2">
                  <p className="font-mono text-rmpg-100 text-sm font-bold">{String(dossier.vehicle.vehicle_number ?? '')}</p>
                  <p className="text-fg-muted">{[dossier.vehicle.year, dossier.vehicle.make, dossier.vehicle.model].filter(Boolean).join(' ')}</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="panel-inset p-2 text-center"><p className="field-label">Open WOs</p><p className="font-bold text-rmpg-100">{dossier.open_work_orders}</p></div>
                  <div className="panel-inset p-2 text-center"><p className="field-label">Calls (90d)</p><p className="font-bold text-rmpg-100">{dossier.calls_handled_90d}</p></div>
                  <div className="panel-inset p-2 text-center"><p className="field-label">Inspections (90d)</p><p className="font-bold text-rmpg-100">{dossier.inspections_90d}</p></div>
                  <div className="panel-inset p-2 text-center"><p className="field-label">Failed Insp.</p><p className="font-bold text-red-400">{dossier.failed_inspections_90d}</p></div>
                </div>
                <div>
                  <p className="field-label mb-1">MPG (Last 90 Days)</p>
                  {dossier.mpg_points.length === 0 ? (
                    <p className="text-fg-muted text-[10px]">No fuel entries in the last 90 days</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={100}>
                      <BarChart data={dossier.mpg_points}>
                        <XAxis dataKey="fuel_date" tick={{ fill: 'var(--text-muted)', fontSize: 7 }} hide />
                        <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 8 }} width={26} />
                        <Tooltip contentStyle={chartTooltipStyle} />
                        <Bar dataKey="mpg" fill="var(--stat-accent-green)" radius={[2, 2, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
                <div>
                  <p className="field-label mb-1">Recent Maintenance</p>
                  {dossier.maintenance.length === 0 ? (
                    <p className="text-fg-muted text-[10px]">No maintenance in the last 90 days</p>
                  ) : (
                    <div className="space-y-1">
                      {dossier.maintenance.slice(0, 10).map((m, i) => (
                        <div key={i} className="panel-inset px-2 py-1 flex justify-between">
                          <span className="text-fg-secondary">{String(m.maintenance_type ?? '')}</span>
                          <span className="font-mono text-fg-muted">{String(m.maintenance_date ?? '')}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-fg-muted text-xs">Failed to load dossier.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
