// ============================================================
// TRIPS drawer — the "TRIPS" overlay on the NAVIGATE screen.
//
// A unit's TRIP CHAIN: the chronological list of trips (call responses
// + patrol legs) this unit has logged, newest first, with the live
// CURRENTLY-ACTIVE trip pinned at the top (growing live). Tapping a
// trip opens its per-trip Movement Report — the SAME drawer the live
// session uses (MovementReportDrawer), fed the trip's breadcrumb points
// run through buildMovementReport(). No new report UI, no refetch by
// hand: reuses useUnitTrips / useTripDetail / useActiveTripsLive.
// ============================================================

import { useMemo, useState } from 'react';
import {
  Route as RouteIcon, X, Loader2, Radio, ChevronRight, Gauge, Clock, MapPin,
  TrendingUp, TrendingDown, CornerUpRight, Printer,
} from 'lucide-react';
import MovementReportDrawer from './MovementReportDrawer';
import { buildMovementReport, type FixPoint } from './vehicleTelemetry';
import {
  useUnitTrips, useTripDetail,
  tripLabel, tripMiles, tripMaxMph, tripDurationMin, tripHarshTotal,
  type Trip, type TripPoint,
} from '../../hooks/useTrips';
import { useActiveTripsLive } from '../../hooks/useActiveTripsLive';
import { generateTripLogPdf } from '../../utils/tripLogPdf';

interface Props {
  unitId?: number;
  open: boolean;
  onClose: () => void;
}

// Local-time formatting — mirror CallHistoryDrawer: tolerate a "YYYY-MM-DD HH:MM:SS"
// (space, no zone) shape from the API by normalizing to ISO-UTC before parsing.
function parseMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso.includes('T') || iso.includes('Z') ? iso : iso.replace(' ', 'T') + 'Z');
  return Number.isFinite(t) ? t : null;
}
function fmtClock(iso: string | null | undefined): string {
  const t = parseMs(iso);
  if (t == null) return '··';
  return new Date(t).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}
function fmtDateShort(iso: string | null | undefined): string {
  const t = parseMs(iso);
  if (t == null) return '—';
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** TripPoint (API breadcrumb) → FixPoint (telemetry engine). Only `time → timestamp` differs. */
function toFixPoints(points: TripPoint[] | undefined): FixPoint[] {
  if (!points) return [];
  return points.map((p) => ({
    lat: p.lat,
    lng: p.lng,
    speed: p.speed,
    heading: p.heading,
    accuracy: p.accuracy,
    timestamp: p.time,
  }));
}

const HARSH_META = [
  { key: 'A', icon: TrendingUp, color: '#f59e0b', title: 'Hard accel' },
  { key: 'B', icon: TrendingDown, color: '#ef4444', title: 'Hard brake' },
  { key: 'C', icon: CornerUpRight, color: '#8b5cf6', title: 'Hard corner' },
] as const;

// One trip in the timeline. `active` pins it at the top with a live badge.
// `showUnit` tags the row with its unit number — used in the agency-wide
// (no unit assigned) view so each trip says which unit ran it.
function TripRow({ trip, active, showUnit, onOpen }: { trip: Trip; active: boolean; showUnit?: boolean; onOpen: () => void }) {
  const isResponse = trip.trip_type === 'call_response';
  const accent = isResponse ? '#d4a017' : '#888888';
  const mi = tripMiles(trip);
  const durMin = tripDurationMin(trip);
  const mph = tripMaxMph(trip);
  const harsh: { key: string; n: number; color: string; Icon: typeof TrendingUp; title: string }[] = [
    { key: 'A', n: trip.harsh_accel_count, color: HARSH_META[0].color, Icon: HARSH_META[0].icon, title: HARSH_META[0].title },
    { key: 'B', n: trip.harsh_brake_count, color: HARSH_META[1].color, Icon: HARSH_META[1].icon, title: HARSH_META[1].title },
    { key: 'C', n: trip.harsh_corner_count, color: HARSH_META[2].color, Icon: HARSH_META[2].icon, title: HARSH_META[2].title },
  ];

  return (
    <button
      onClick={onOpen}
      className="w-full text-left bg-surface-raised/40 border px-2 py-1.5 hover:border-brand-600 transition-colors"
      style={{ borderRadius: 2, borderColor: active ? '#d4a01788' : 'var(--border-subtle)' }}
    >
      {/* top line: type badge + active pill + date + chevron */}
      <div className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: accent }} />
        {showUnit && trip.unit_id != null && (
          <span className="text-[8px] font-mono font-bold px-1 py-0.5 shrink-0" style={{ borderRadius: 2, color: '#d4a017', background: 'rgba(212,160,23,0.12)' }}>
            U{trip.unit_id}
          </span>
        )}
        <span className="text-[10px] font-bold uppercase tracking-wide truncate" style={{ color: accent }}>
          {tripLabel(trip)}
        </span>
        {active && (
          <span
            className="flex items-center gap-0.5 text-[7px] font-bold uppercase tracking-widest px-1 py-0.5 shrink-0 animate-pulse"
            style={{ borderRadius: 2, color: '#22c55e', background: 'rgba(34,197,94,0.15)' }}
          >
            <Radio className="w-2 h-2" /> Active
          </span>
        )}
        {isResponse && trip.call_type && (
          <span className="text-[9px] text-rmpg-400 min-w-0 truncate flex-1" title={trip.call_type}>
            {trip.call_type.replace(/_/g, ' ')}
          </span>
        )}
        <span className="text-[8px] font-mono text-rmpg-600 shrink-0 ml-auto">{fmtDateShort(trip.start_time)}</span>
        <ChevronRight className="w-3 h-3 text-rmpg-600 shrink-0" />
      </div>

      {/* time window */}
      <div className="flex items-center gap-1 mt-1 text-[9px] font-mono text-rmpg-400">
        <Clock className="w-2.5 h-2.5 text-brand-500 shrink-0" />
        <span>{fmtClock(trip.start_time)}</span>
        <span className="text-rmpg-700">→</span>
        <span style={{ color: active ? '#22c55e' : undefined }}>{active && !trip.end_time ? 'now' : fmtClock(trip.end_time)}</span>
      </div>

      {/* metrics row */}
      <div className="flex items-center gap-2 mt-1 text-[9px] font-mono text-rmpg-500">
        <span title="Distance"><MapPin className="w-2.5 h-2.5 inline mr-0.5 text-brand-500" />{mi.toFixed(1)} mi</span>
        {durMin != null && <span title="Duration"><Clock className="w-2.5 h-2.5 inline mr-0.5 text-brand-500" />{durMin} m</span>}
        <span title="Max speed"><Gauge className="w-2.5 h-2.5 inline mr-0.5 text-brand-500" />{mph} mph</span>
        {tripHarshTotal(trip) > 0 && (
          <span className="ml-auto flex items-center gap-1.5">
            {harsh.filter((h) => h.n > 0).map((h) => (
              <span key={h.key} className="flex items-center gap-0.5" style={{ color: h.color }} title={h.title}>
                <h.Icon className="w-2.5 h-2.5" />{h.key}:{h.n}
              </span>
            ))}
          </span>
        )}
      </div>
    </button>
  );
}

export default function TripsDrawer({ unitId, open, onClose }: Props) {
  const { trips, reload } = useUnitTrips(unitId);
  const { getTrip } = useActiveTripsLive();
  const [selectedTripId, setSelectedTripId] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  const liveTrip = getTrip(unitId);

  // Timeline = live active trip pinned first, then the recent (closed) chain
  // newest-first, with the active trip de-duped out of the polled list.
  const timeline = useMemo<{ trip: Trip; active: boolean }[]>(() => {
    const rows: { trip: Trip; active: boolean }[] = [];
    if (liveTrip) rows.push({ trip: liveTrip, active: true });
    for (const t of trips) {
      if (liveTrip && t.id === liveTrip.id) continue;
      rows.push({ trip: t, active: t.status === 'active' });
    }
    return rows;
  }, [trips, liveTrip]);

  // EXPORT PDF — audit Trip Log for this unit's full chain (live + closed).
  // Reuses the shared jsPDF generator (tripLogPdf.ts) — same engine/helpers
  // as every other RMPG report. Unit/officer labels come from the trip data.
  const handleExportPdf = async () => {
    if (exporting || timeline.length === 0) return;
    const tripsForPdf = timeline.map((r) => r.trip);
    const unitLabel = unitId != null ? `Unit ${unitId}` : undefined;
    const officerId = tripsForPdf.find((t) => t.officer_id != null)?.officer_id ?? null;
    const officerLabel = officerId != null ? `Officer ${officerId}` : undefined;
    try {
      setExporting(true);
      await generateTripLogPdf(tripsForPdf, { unitLabel, officerLabel });
    } catch (err) {
      console.error('[TripsDrawer] Trip Log PDF export failed:', err);
    } finally {
      setExporting(false);
    }
  };

  // Per-trip movement report — reuse the SAME drawer the live session uses.
  const detail = useTripDetail(selectedTripId ?? undefined);
  const report = useMemo(
    () => (detail ? buildMovementReport(toFixPoints(detail.points)) : null),
    [detail],
  );

  if (!open) return null;

  // When a trip is selected, swap the panel for the reused Movement Report
  // drawer. It carries its own positioning/chrome; we layer a thin BACK bar
  // on top so the officer can return to the trip list.
  if (selectedTripId != null) {
    const sel = detail ?? timeline.find((r) => r.trip.id === selectedTripId)?.trip ?? null;
    const durMs = sel?.duration_s != null ? sel.duration_s * 1000 : (report?.durationMs ?? 0);
    return (
      <>
        {report ? (
          <MovementReportDrawer
            report={report}
            liveMph={null}
            liveLongG={0}
            liveLatG={0}
            sessionMs={durMs}
            onClose={() => setSelectedTripId(null)}
          />
        ) : (
          // loading the breadcrumb points for this trip
          <div
            className="absolute z-30 panel-beveled bg-surface-deep/95 backdrop-blur-md border border-rmpg-600 shadow-2xl flex items-center justify-center"
            style={{ top: 44, bottom: 8, right: 8, width: 360, maxWidth: 'calc(100vw - 16px)', borderRadius: 2 }}
          >
            <div className="flex items-center gap-2 text-[11px] text-rmpg-500">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading trip replay…
            </div>
          </div>
        )}
        {/* BACK to trip list */}
        <button
          onClick={() => setSelectedTripId(null)}
          className="absolute z-40 flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide px-2 py-1 border border-rmpg-700 bg-surface-deep/95 text-brand-300 hover:border-brand-500 hover:text-rmpg-100"
          style={{ borderRadius: 2, top: 50, right: 376 }}
          aria-label="Back to trips list"
          title="Back to trips list"
        >
          <RouteIcon className="w-3 h-3" /> Trips
        </button>
      </>
    );
  }

  return (
    <div
      className="absolute z-30 panel-beveled bg-surface-deep/95 backdrop-blur-md border border-rmpg-600 shadow-2xl flex flex-col"
      style={{ top: 44, bottom: 8, right: 8, width: 360, maxWidth: 'calc(100vw - 16px)', borderRadius: 2 }}
    >
      {/* header */}
      <div className="relative flex items-center gap-2 px-3 py-2 border-b border-rmpg-700 shrink-0">
        <div className="absolute bottom-0 inset-x-0 h-px" style={{ background: 'linear-gradient(90deg, #d4a01766, transparent)' }} />
        <RouteIcon className="w-4 h-4 text-brand-400" />
        <span className="text-[11px] font-bold uppercase tracking-widest text-rmpg-100">Trips</span>
        <span className="text-[9px] font-mono font-bold text-brand-300">{unitId != null ? `UNIT ${unitId}` : 'ALL UNITS'}</span>
        <span className="flex-1" />
        <span className="text-[10px] font-mono text-rmpg-400">{timeline.length}</span>
        <button
          onClick={handleExportPdf}
          disabled={exporting || timeline.length === 0}
          className="flex items-center gap-1 text-[8px] font-bold uppercase tracking-wide px-1.5 py-0.5 border border-rmpg-700 text-brand-300 hover:border-brand-500 hover:text-rmpg-100 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-rmpg-700 disabled:hover:text-brand-300"
          style={{ borderRadius: 2 }}
          aria-label="Export trip log PDF"
          title="Export trip log PDF"
        >
          {exporting ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Printer className="w-2.5 h-2.5" />}
          Export PDF
        </button>
        <button onClick={onClose} className="text-rmpg-500 hover:text-rmpg-100" aria-label="Close trips"><X className="w-4 h-4" /></button>
      </div>

      {/* timeline */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-dark px-2 py-2 space-y-1.5">
        {unitId == null && (
          <div className="text-[9px] text-rmpg-600 px-2 pb-1 text-center">
            No unit assigned — showing the agency-wide trip log. Go on-duty to log your own.
          </div>
        )}
        {timeline.length === 0 && (
          <div className="flex flex-col items-center gap-2 text-[11px] text-rmpg-600 px-2 py-8 text-center">
            <RouteIcon className="w-5 h-5 text-rmpg-700" />
            {unitId != null ? 'No trips logged for this unit yet.' : 'No trips logged yet.'}
            <button
              onClick={reload}
              className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 border border-rmpg-700 text-brand-300 hover:border-brand-500 hover:text-rmpg-100"
              style={{ borderRadius: 2 }}
            >
              Refresh
            </button>
          </div>
        )}
        {timeline.map(({ trip, active }) => (
          <TripRow key={trip.id} trip={trip} active={active} showUnit={unitId == null} onOpen={() => setSelectedTripId(trip.id)} />
        ))}
      </div>
    </div>
  );
}
