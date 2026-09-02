import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  X, Route, MapPin, ChevronUp, ChevronDown, CheckSquare, Square,
  Loader2, Navigation, Clock, DollarSign, Gauge, User, GripVertical,
  Printer, RotateCcw, CalendarDays, AlertTriangle, Pin, Coffee, ExternalLink,
} from 'lucide-react';
import { initMapbox, mapboxgl, MAPBOX_STYLE_DARK } from '../../utils/mapboxLoader';
import { installWebglContextRecovery } from '../../utils/webglRecovery';
import { getMapboxAccessToken } from '../../utils/mapboxApiKey';
import { fetchMapboxDrivingRoute } from '../../utils/mapboxDepartAt';
import { whenStyleReady } from '../../pages/map/utils/safeAddSource';
import { apiFetch } from '../../hooks/useApi';
import { useToast } from '../../components/ToastProvider';
import { useGpsTracking } from '../../hooks/useGpsTracking';
import type { ServeJob } from '../../types';
import { hasLayer, hasSource, safeRemoveLayer, safeRemoveSource } from '../../utils/mapboxSafeLayer';
import { parseTimestamp, safeDateStr } from '../../utils/dateUtils';
import { applyRmpgBasemap } from '../../utils/mapboxBasemap';
import {
  resolveRouteOrigin, describeOrigin, describeOriginProblem,
  type LastKnownFix,
} from '../../utils/serveRouteOrigin';
import { exportServeMapSheet } from '../../utils/serveMapExport';
import { runServeOptimizationV2, v2EtasToArrivalMs } from '../../utils/mapboxOptimizationV2';
import { clampDwellSeconds, formatWindowLabel, resolveServeWindow } from '../../utils/serveStopTiming';
import {
  applyLunchBreak,
  denverHourFromMs,
  dwellTypeShort,
  formatRunBreakdown,
  gallonsForMiles,
  googleMapsNavUrl,
  hasEveningWindow,
  hoursUntilDeadline,
  mergeLockedVisitOrder,
  splitIdsByShiftMinutes,
} from '../../utils/routePlannerEngine';

// ─── Types ──────────────────────────────────────────────────────────────

interface RouteStopPayload {
  jobId: number;
  lat: number;
  lng: number;
  geocodeSource: 'point' | 'centroid' | null;
  deadlineAt: string | null;
  defendantType: 'individual' | 'apartment' | 'business';
  addressHash: string;
  defendant: string;
  address: string;
  locationNote: { serveStart: string | null; serveEnd: string | null } | null;
}

interface GeocodeWarning {
  jobId: number;
  defendant: string;
  address: string;
  quality: 'low' | 'none';
}

interface OfficerOption {
  id: number;
  name: string;
}

interface ServeRoutePlannerProps {
  isOpen: boolean;
  onClose: () => void;
  jobs: ServeJob[];
  officers?: OfficerOption[];
  currentUserId?: number;
  onRouteOptimized: (orderedJobIds: number[], routeData: {
    totalDistance: number;
    totalDuration: number;
    fuelCost: number;
    routeDate: string;
  }) => void;
  /**
   * When set (e.g. opened via "Add to route" on a map marker), only these
   * job ids start selected — every other job still appears in the list, just
   * unchecked, so the officer can add more manually. Without this prop the
   * default selection (every non-served/failed geocoded job) is unchanged,
   * which is what the toolbar's "Plan Route" button still wants.
   */
  preselectedJobIds?: Set<number>;
  onVerifyAddress?: (jobId: number) => void;
  mileageRate?: number;
  /** YYYY-MM-DD date the parent page is currently viewing. Initializes the
   *  date picker so the planner and Route tab always operate on the same date
   *  by default. Defaults to today when omitted. */
  initialDate?: string;
}

interface StopItem {
  job: ServeJob;
  selected: boolean;
  order: number;
}

function clientGeocodeWarnings(items: StopItem[]): GeocodeWarning[] {
  return items
    .filter((s) => {
      const src = s.job.geocode_source;
      return !src || src === 'centroid';
    })
    .map((s) => ({
      jobId: s.job.id,
      defendant: s.job.recipient_name ?? '',
      address: s.job.recipient_address ?? '',
      quality: 'low' as const,
    }));
}

// ─── Marker Colors ──────────────────────────────────────────────────────

function markerColor(status: ServeJob['status']): string {
  switch (status) {
    case 'served': return '#22c55e';
    case 'in_progress': return '#eab308';
    case 'failed': return '#ef4444';
    default: return '#888888';
  }
}

// ─── Time Window Sorting ────────────────────────────────────────────────

function timeWindowPriority(tw: ServeJob['time_window'], plannedStartMs: number): number {
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    hour: 'numeric',
    hourCycle: 'h23',
  }).format(new Date(plannedStartMs))); // new-date-ok — epoch ms
  const order: ServeJob['time_window'][] =
    hour < 12
      ? ['morning', 'anytime', 'afternoon', 'evening']
      : hour < 17
        ? ['afternoon', 'anytime', 'evening', 'morning']
        : ['evening', 'anytime', 'morning', 'afternoon'];
  const idx = order.indexOf(tw);
  return idx < 0 ? order.length : idx;
}

function humanizeMatrixFallback(reason?: string): string | undefined {
  if (!reason) return undefined;
  if (reason === 'no token configured') {
    return 'Worker Mapbox directions token is unset — the map token still works for drawing the line';
  }
  return reason;
}

function priorityWeight(p: ServeJob['priority']): number {
  // Lower weight sorts first (most urgent). Matches serve_queue priority enum.
  switch (p) {
    case 'urgent': return 0;
    case 'rush': return 1;
    case 'normal': return 2;
    case 'routine': return 3;
    default: return 2;
  }
}

// ─── Geographic Clustering for >25 Stops ────────────────────────────────

// Mapbox Directions allows 25 COORDINATES per request, not 25 waypoints. The
// first cluster also carries the officer's GPS position as its origin, so a
// cluster may hold at most 24 stops or the request is built with 26+ points
// and 422s. Clustering at 25 looked right and silently broke the largest runs
// — exactly the ones that most need optimizing.
const MAX_DIRECTIONS_COORDS = 25;
const MAX_CLUSTER_STOPS = MAX_DIRECTIONS_COORDS - 1; // reserve one for the origin

function clusterStops(stops: StopItem[]): StopItem[][] {
  if (stops.length <= MAX_CLUSTER_STOPS) return [stops];
  if (stops.length === 0) return [];
  const lats = stops.map(s => s.job.recipient_lat!);
  const lngs = stops.map(s => s.job.recipient_lng!);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const midLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
  const quadrants: StopItem[][] = [[], [], [], []];
  for (const stop of stops) {
    const qi = (stop.job.recipient_lat! >= midLat ? 0 : 2) + (stop.job.recipient_lng! >= midLng ? 0 : 1);
    quadrants[qi].push(stop);
  }
  const result: StopItem[][] = [];
  for (const q of quadrants) {
    if (q.length === 0) continue;
    if (q.length <= MAX_CLUSTER_STOPS) result.push(q);
    else result.push(...clusterStops(q));
  }
  return result;
}

function chainClusters(clusters: StopItem[][]): StopItem[][] {
  if (clusters.length <= 1) return clusters;
  const clusterCenters = clusters.map(c => {
    const avgLat = c.reduce((s, st) => s + st.job.recipient_lat!, 0) / c.length;
    const avgLng = c.reduce((s, st) => s + st.job.recipient_lng!, 0) / c.length;
    return { lat: avgLat, lng: avgLng };
  });
  const ordered: number[] = [0];
  const used = new Set([0]);
  while (ordered.length < clusters.length) {
    const last = clusterCenters[ordered[ordered.length - 1]];
    let bestDist = Infinity, bestIdx = -1;
    for (let i = 0; i < clusters.length; i++) {
      if (used.has(i)) continue;
      const d = Math.hypot(clusterCenters[i].lat - last.lat, clusterCenters[i].lng - last.lng);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    ordered.push(bestIdx);
    used.add(bestIdx);
  }
  return ordered.map(i => clusters[i]);
}

function chunkInOrder(stops: StopItem[], size: number): StopItem[][] {
  if (stops.length === 0) return [];
  const chunks: StopItem[][] = [];
  for (let i = 0; i < stops.length; i += size) chunks.push(stops.slice(i, i + size));
  return chunks;
}

// ─── Offline fallback: pure-geometry nearest-neighbor optimizer ─────────
// Mirrors src/utils/serveRouteOptimizer.ts's haversine + nearest-neighbor
// approach (can't import it directly — /src/ is the Worker build,
// /client/src/ is a separate build with no shared bundle). Requires no
// external API, so it's used whenever Mapbox Directions is unavailable
// (token fetch failed, network down, rate-limited, etc.) instead of
// leaving the route planner entirely non-functional.
export function denverWallClockToUtcMs(
  year: number,
  monthIndex: number,
  day: number,
  hour: number,
  minute: number,
): number {
  const pad = (n: number) => String(n).padStart(2, '0');
  const want = `${year}-${pad(monthIndex + 1)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00`;
  const fmt = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Denver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const wallAt = (ms: number) => fmt.format(new Date(ms)).replace(' ', 'T'); // new-date-ok — epoch ms
  let utc = Date.parse(want + 'Z');
  for (let i = 0; i < 4; i++) {
    const got = wallAt(utc);
    utc += Date.parse(want + 'Z') - Date.parse(got + 'Z');
  }
  return utc;
}

export function plannedStartToMs(routeDate: string, plannedStartTime: string): number {
  const [y, mo, d] = routeDate.split('-').map(Number);
  const [h, m] = plannedStartTime.split(':').map(Number);
  return denverWallClockToUtcMs(y || 1970, (mo || 1) - 1, d || 1, h || 0, m || 0);
}

export function denverYmd(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Denver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms)); // new-date-ok — epoch ms
}

export function formatEtaDenver(ms: number, routeDateYmd: string): string {
  const time = new Date(ms).toLocaleTimeString('en-US', { // new-date-ok — epoch ms
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Denver',
  });
  const ymd = denverYmd(ms);
  if (ymd === routeDateYmd) return time;
  const [y1, m1, d1] = routeDateYmd.split('-').map(Number);
  const [y2, m2, d2] = ymd.split('-').map(Number);
  const days = Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
  if (days === 1) return `${time} (+1d)`;
  if (days > 1) return `${time} (+${days}d)`;
  return time;
}

/** Same-day windows only: wait if early, go now if the band already closed. Never +1d. */
export function clampArrivalToServeWindow(
  arrivalMs: number,
  serveStart: string,
  serveEnd: string,
  routeDateYmd: string,
): number {
  const [y, mo, d] = routeDateYmd.split('-').map(Number);
  const [sh, sm] = serveStart.split(':').map(Number);
  const [eh, em] = serveEnd.split(':').map(Number);
  let windowStart = denverWallClockToUtcMs(y, (mo || 1) - 1, d || 1, sh || 0, sm || 0);
  let windowEnd = denverWallClockToUtcMs(y, (mo || 1) - 1, d || 1, eh || 0, em || 0);
  if (windowEnd <= windowStart) windowEnd += 86_400_000;
  if (arrivalMs >= windowEnd) return arrivalMs;
  if (arrivalMs < windowStart) {
    if (denverYmd(windowStart) !== routeDateYmd) return arrivalMs;
    return windowStart;
  }
  return arrivalMs;
}

const EARTH_RADIUS_MI = 3958.8;
const ROAD_WINDING_FACTOR = 1.3;
const URBAN_AVG_MPH = 25;

export function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function estimateDriveMinutes(distanceMiles: number): number {
  if (!Number.isFinite(distanceMiles) || distanceMiles <= 0) return 0;
  return (distanceMiles * ROAD_WINDING_FACTOR / URBAN_AVG_MPH) * 60;
}

// ─── Deadline-Aware Ordering ─────────────────────────────────────────────
// Extends the plain nearest-neighbor pass with a simulated clock: as the
// route is built, elapsed time advances by estimated drive time plus a
// fixed per-stop dwell (knock/serve/paperwork). A stop whose deadline sits
// within DEADLINE_URGENCY_BUFFER_MS of its estimated arrival — or is already
// past it — jumps the queue ahead of purely-nearest candidates, breaking
// ties by earliest deadline. This is a greedy heuristic, NOT a proven-optimal
// solver (distance + deadline routing is a variant of TSP with time windows,
// which is NP-hard in general) — it will find a feasible ordering for
// reasonably-spaced deadlines and flag genuine infeasibility via
// missedDeadlineJobIds, but it does not guarantee a globally optimal route.
const DEADLINE_URGENCY_BUFFER_MS = 60 * 60 * 1000; // 60 minutes

function dwellMsForJob(job: ServeJob): number {
  const type = inferDefendantType(job.recipient_address, job.business_id, job.recipient_type);
  return clampDwellSeconds(type, job.learned_dwell_seconds) * 1000;
}

function serveWindowForJob(job: ServeJob, routeDate: string, shiftStartMs?: number) {
  const lastAttemptAt = job.attempts?.length
    ? job.attempts[job.attempts.length - 1]?.attempt_at
    : null;
  const win = resolveServeWindow({
    routeDate,
    nextAttemptDate: job.next_attempt_date,
    nextAttemptWindow: job.next_attempt_window,
    timeWindow: job.time_window,
    lastAttemptAt,
  });
  if (!win || shiftStartMs == null || !routeDate) return win;
  const [y, mo, d] = routeDate.split('-').map(Number);
  const [eh, em] = win.end.split(':').map(Number);
  const endMs = denverWallClockToUtcMs(y || 1970, (mo || 1) - 1, d || 1, eh || 0, em || 0);
  // A 6pm run does not wait until tomorrow for an 08:00–12:00 band.
  if (shiftStartMs >= endMs) return null;
  return win;
}

/** Greedy nearest-neighbor reorder from an optional origin, biased toward
 *  approaching deadlines. Returns the reordered stops, the total
 *  straight-line distance/time estimate (time now includes per-stop dwell),
 *  any job ids whose deadline is unavoidably missed given everything
 *  scheduled ahead of them, and the simulated clock time after the last
 *  stop (so callers building a route across multiple legs — e.g. one
 *  Directions cluster after another — can carry the clock forward).
 *
 *  With NO origin, every candidate scores distance 0 on the first iteration, so
 *  the first stop is whatever came first in the input and the chain is
 *  nearest-neighbored from there. That yields a sensibly-shaped run but a
 *  seed-dependent one, and the leg from the officer's actual position to stop 1
 *  is not counted at all — which is why ServeRoutePlanner resolves a real origin
 *  (utils/serveRouteOrigin.ts) and warns on screen when it cannot. */
export function nearestNeighborOrder(
  selected: StopItem[],
  origin: { lat: number; lng: number } | null,
  startTimeMs: number = Date.now(),
  routeDate?: string,
): {
  ordered: StopItem[];
  totalDistanceMiles: number;
  totalDurationMinutes: number;
  missedDeadlineJobIds: number[];
  finalElapsedMs: number;
  /** Arrival timestamp (ms) for each stop, parallel to `ordered`. */
  perStopArrivalMs: number[];
} {
  const remaining = [...selected];
  const ordered: StopItem[] = [];
  const perStopArrivalMs: number[] = [];
  let cursor = origin;
  let totalDistanceMiles = 0;
  let elapsedMs = startTimeMs;
  const missedDeadlineJobIds: number[] = [];
  const routeYmd = routeDate || denverYmd(startTimeMs);

  while (remaining.length > 0) {
    const candidates = remaining.map((s, idx) => {
      const distanceMiles = cursor
        ? haversineMiles(cursor.lat, cursor.lng, s.job.recipient_lat!, s.job.recipient_lng!)
        : 0;
      let arrivalMs = elapsedMs + estimateDriveMinutes(distanceMiles) * 60_000;
      const win = serveWindowForJob(s.job, routeYmd, startTimeMs);
      if (win) arrivalMs = clampArrivalToServeWindow(arrivalMs, win.start, win.end, routeYmd);
      const deadlineMs = s.job.deadline ? parseTimestamp(s.job.deadline).getTime() : NaN;
      return { idx, distanceMiles, arrivalMs, deadlineMs: Number.isNaN(deadlineMs) ? null : deadlineMs };
    });

    const urgent = candidates.filter(c => c.deadlineMs != null && (c.deadlineMs - c.arrivalMs) <= DEADLINE_URGENCY_BUFFER_MS);
    const chosen = urgent.length > 0
      ? urgent.reduce((best, c) => c.deadlineMs! < best.deadlineMs! ? c : best)
      : candidates.reduce((best, c) => (
        c.arrivalMs < best.arrivalMs
        || (c.arrivalMs === best.arrivalMs && c.distanceMiles < best.distanceMiles)
          ? c : best
      ));

    if (chosen.deadlineMs != null && chosen.arrivalMs > chosen.deadlineMs) {
      missedDeadlineJobIds.push(remaining[chosen.idx].job.id);
    }

    const [next] = remaining.splice(chosen.idx, 1);
    if (cursor) totalDistanceMiles += chosen.distanceMiles;
    cursor = { lat: next.job.recipient_lat!, lng: next.job.recipient_lng! };
    perStopArrivalMs.push(chosen.arrivalMs);
    const stopDwell = dwellMsForJob(next.job);
    elapsedMs = chosen.arrivalMs + stopDwell;
    ordered.push(next);
  }

  return {
    ordered,
    totalDistanceMiles,
    totalDurationMinutes: (elapsedMs - startTimeMs) / 60_000,
    missedDeadlineJobIds,
    finalElapsedMs: elapsedMs,
    perStopArrivalMs,
  };
}

// ─── Initial Selection ──────────────────────────────────────────────────

/**
 * Whether a job starts checked when the planner opens. A non-empty
 * `preselectedJobIds` (e.g. from the map's "Add to route" context menu)
 * takes over selection entirely — every job NOT in the set starts
 * unchecked, even ones the default rule would have picked — because the
 * officer explicitly staged specific jobs and an unrelated one silently
 * riding along in the optimized run would be worse than requiring one
 * extra checkbox click to add it back.
 */
/**
 * Splice-and-reinsert reorder, generic over the stop-list item type so it's
 * plain-data testable without constructing a full StopItem/ServeJob. Splice
 * (not swap) so dragging item 0 onto item 4 shifts 1-4 up by one — matching
 * how a drag-and-drop list visually reorders — rather than just trading
 * places with whatever sits at the drop index.
 */
export function reorderList<T>(list: T[], fromIdx: number, toIdx: number): T[] {
  if (fromIdx === toIdx || fromIdx < 0 || fromIdx >= list.length || toIdx < 0 || toIdx >= list.length) return list;
  const next = [...list];
  const [moved] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, moved);
  return next;
}

export function isJobPreselected(
  jobStatus: ServeJob['status'],
  preselectedJobIds: Set<number> | undefined,
  jobId: number,
): boolean {
  if (preselectedJobIds && preselectedJobIds.size > 0) return preselectedJobIds.has(jobId);
  return jobStatus !== 'served' && jobStatus !== 'failed';
}

/** Turns nearestNeighborOrder's missedDeadlineJobIds into a single warning
 *  sentence naming the affected recipients, or null when nothing is missed.
 *  Deduped and looked up against `stops` since the same job id can appear in
 *  more than one nearestNeighborOrder call (e.g. a cluster's primary
 *  ordering pass and its degraded-fallback re-estimate). */
export function describeMissedDeadlines(missedDeadlineJobIds: number[], stops: StopItem[]): string | null {
  if (missedDeadlineJobIds.length === 0) return null;
  const uniqueIds = [...new Set(missedDeadlineJobIds)];
  const names = uniqueIds
    .map(id => stops.find(s => s.job.id === id)?.job.recipient_name)
    .filter((n): n is string => !!n);
  if (names.length === 0) return null;
  return `${names.length} stop${names.length === 1 ? '' : 's'} may miss their deadline: ${names.join(', ')}.`;
}

// ─── Badge Components ───────────────────────────────────────────────────

function TimeWindowBadge({ job, routeDate }: { job: ServeJob; routeDate: string }) {
  const win = serveWindowForJob(job, routeDate);
  const label = formatWindowLabel(win, job.time_window);
  const evening = win ? win.start >= '17:00' : job.time_window === 'evening';
  const morning = win ? win.end <= '12:00' : job.time_window === 'morning';
  const colors = evening
    ? 'bg-purple-900/40 text-purple-400 border-purple-700/50'
    : morning
      ? 'bg-amber-900/40 text-amber-400 border-amber-700/50'
      : win
        ? 'bg-surface-sunken/40 text-rmpg-400 border-border-default/50'
        : 'bg-rmpg-800/40 text-rmpg-400 border-rmpg-700/50';
  return <span className={`text-[10px] px-1.5 py-0.5 rounded-[2px] border font-mono ${colors}`}>{label}</span>;
}

function PriorityBadge({ p }: { p: ServeJob['priority'] }) {
  // Matches the serve_queue.priority CHECK constraint (see ServeJob['priority']
  // in types/index.ts): 'routine' | 'normal' | 'rush' | 'urgent'. The previous
  // 'high'/'low' keys never matched real data, so 'urgent' and 'routine' both
  // silently fell through to the 'normal' style — the two priorities officers
  // most need to tell apart at a glance were rendered identically.
  const colors: Record<string, string> = {
    urgent: 'bg-red-900/40 text-red-400 border-red-700/50',
    rush: 'bg-orange-900/40 text-orange-400 border-orange-700/50',
    normal: 'bg-rmpg-800/40 text-rmpg-400 border-rmpg-700/50',
    routine: 'bg-rmpg-800/30 text-fg-muted border-rmpg-700/30',
  };
  return <span className={`text-[10px] px-1.5 py-0.5 rounded-[2px] border font-mono uppercase ${colors[p] || colors.normal}`}>{p}</span>;
}

// ─── Server-Route Helpers ────────────────────────────────────────────────

const APARTMENT_RE = /\b(apt|apartment|unit|ste|suite|bldg|building|fl(?:oor)?|#)\b|\s#\d/i;

function inferDefendantType(
  address: string | null | undefined,
  businessId: number | null | undefined,
  recipientType?: string | null,
): 'individual' | 'apartment' | 'business' {
  if (businessId || recipientType === 'business') return 'business';
  if (address && APARTMENT_RE.test(address)) return 'apartment';
  return 'individual';
}

/** Convert client StopItems to the shape the server optimizer expects. */
function timeWindowToServeWindow(tw: string | null | undefined): { serveStart: string; serveEnd: string } | null {
  switch (tw) {
    case 'morning': return { serveStart: '06:00', serveEnd: '12:00' };
    case 'afternoon': return { serveStart: '12:00', serveEnd: '17:00' };
    case 'evening': return { serveStart: '17:00', serveEnd: '21:00' };
    default: return null;
  }
}

async function hashAddress(address: string): Promise<string> {
  const normalized = address.toUpperCase().trim().replace(/\s+/g, ' ');
  const data = new TextEncoder().encode(normalized);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function buildRouteStopsFromJobs(stops: StopItem[], routeDate?: string): Promise<RouteStopPayload[]> {
  const filtered = stops.filter(
    s => s.selected && s.job.recipient_lat != null && s.job.recipient_lng != null,
  );
  return Promise.all(
    filtered.map(async s => ({
      jobId: s.job.id,
      lat: s.job.recipient_lat!,
      lng: s.job.recipient_lng!,
      geocodeSource: (s.job.geocode_source as 'point' | 'centroid' | null) ?? null,
      deadlineAt: s.job.deadline ?? null,
      defendantType: inferDefendantType(s.job.recipient_address, s.job.business_id, s.job.recipient_type),
      addressHash: await hashAddress(s.job.recipient_address ?? ''),
      defendant: s.job.recipient_name ?? '',
      address: s.job.recipient_address ?? '',
      locationNote: (() => {
        const win = serveWindowForJob(s.job, routeDate || s.job.serve_date || '');
        return win ? { serveStart: win.start, serveEnd: win.end } : timeWindowToServeWindow(s.job.time_window);
      })(),
    })),
  );
}

// ─── In-Order Arrival Computation ───────────────────────────────────────
// Used by the auto-compute effect to produce per-stop ETAs that follow the
// user's CURRENT stop ordering rather than re-sorting by nearest-neighbor.
// nearestNeighborOrder stays for the "Optimize Route" action; this is the
// lighter pass that just walks the list as-is.
export function computeArrivalsInOrder(
  selected: StopItem[],
  origin: { lat: number; lng: number } | null,
  startTimeMs: number,
  routeDate?: string,
): {
  arrivals: Map<number, number>;
  totalDistanceMiles: number;
  totalDurationMinutes: number;
  missedDeadlineJobIds: number[];
  totalDwellMinutes: number;
  totalWaitMinutes: number;
  lunchMinutes: number;
} {
  let cursor = origin;
  let elapsedMs = startTimeMs;
  let totalDistanceMiles = 0;
  let totalDwellMs = 0;
  let totalWaitMs = 0;
  let lunchMs = 0;
  const arrivals = new Map<number, number>();
  const missedDeadlineJobIds: number[] = [];
  let lunchTaken = denverHourFromMs(startTimeMs) >= 12;
  const routeYmd = routeDate || denverYmd(startTimeMs);

  for (const stop of selected) {
    const distanceMiles = cursor
      ? haversineMiles(cursor.lat, cursor.lng, stop.job.recipient_lat!, stop.job.recipient_lng!)
      : 0;
    let arrivalMs = elapsedMs + estimateDriveMinutes(distanceMiles) * 60_000;
    const lunch = applyLunchBreak(arrivalMs, lunchTaken, 30);
    lunchTaken = lunch.lunchTaken;
    lunchMs += lunch.addedMs;
    arrivalMs = lunch.elapsedMs;
    const win = serveWindowForJob(stop.job, routeYmd, startTimeMs);
    const beforeWindow = arrivalMs;
    if (win) arrivalMs = clampArrivalToServeWindow(arrivalMs, win.start, win.end, routeYmd);
    totalWaitMs += Math.max(0, arrivalMs - beforeWindow);
    arrivals.set(stop.job.id, arrivalMs);

    const deadlineMs = stop.job.deadline ? parseTimestamp(stop.job.deadline).getTime() : NaN;
    if (!Number.isNaN(deadlineMs) && arrivalMs > deadlineMs) {
      missedDeadlineJobIds.push(stop.job.id);
    }

    if (cursor) totalDistanceMiles += distanceMiles;
    cursor = { lat: stop.job.recipient_lat!, lng: stop.job.recipient_lng! };
    const dwell = dwellMsForJob(stop.job);
    totalDwellMs += dwell;
    elapsedMs = arrivalMs + dwell;
  }

  return {
    arrivals,
    totalDistanceMiles,
    totalDurationMinutes: (elapsedMs - startTimeMs) / 60_000,
    missedDeadlineJobIds,
    totalDwellMinutes: totalDwellMs / 60_000,
    totalWaitMinutes: totalWaitMs / 60_000,
    lunchMinutes: lunchMs / 60_000,
  };
}

/** Walk a known visit order using per-leg driving seconds (Mapbox legs or estimates). */
export function computeArrivalsFromLegDurations(
  selected: StopItem[],
  startTimeMs: number,
  legDurationsSeconds: number[],
  routeDate?: string,
): {
  arrivals: Map<number, number>;
  totalDurationMinutes: number;
  missedDeadlineJobIds: number[];
  totalDwellMinutes: number;
  totalWaitMinutes: number;
  lunchMinutes: number;
} {
  let elapsedMs = startTimeMs;
  const arrivals = new Map<number, number>();
  const missedDeadlineJobIds: number[] = [];
  let lunchTaken = denverHourFromMs(startTimeMs) >= 12;
  let totalDwellMs = 0;
  let totalWaitMs = 0;
  let lunchMs = 0;
  const routeYmd = routeDate || denverYmd(startTimeMs);

  for (let i = 0; i < selected.length; i++) {
    const stop = selected[i];
    elapsedMs += (legDurationsSeconds[i] ?? 0) * 1000;
    const lunch = applyLunchBreak(elapsedMs, lunchTaken, 30);
    lunchTaken = lunch.lunchTaken;
    lunchMs += lunch.addedMs;
    elapsedMs = lunch.elapsedMs;
    const win = serveWindowForJob(stop.job, routeYmd, startTimeMs);
    const beforeWindow = elapsedMs;
    if (win) elapsedMs = clampArrivalToServeWindow(elapsedMs, win.start, win.end, routeYmd);
    totalWaitMs += Math.max(0, elapsedMs - beforeWindow);
    arrivals.set(stop.job.id, elapsedMs);

    const deadlineMs = stop.job.deadline ? parseTimestamp(stop.job.deadline).getTime() : NaN;
    if (!Number.isNaN(deadlineMs) && elapsedMs > deadlineMs) {
      missedDeadlineJobIds.push(stop.job.id);
    }

    const dwell = dwellMsForJob(stop.job);
    totalDwellMs += dwell;
    elapsedMs += dwell;
  }

  return {
    arrivals,
    totalDurationMinutes: (elapsedMs - startTimeMs) / 60_000,
    missedDeadlineJobIds,
    totalDwellMinutes: totalDwellMs / 60_000,
    totalWaitMinutes: totalWaitMs / 60_000,
    lunchMinutes: lunchMs / 60_000,
  };
}

function clockBreakdown(a: {
  totalDurationMinutes: number;
  totalDwellMinutes: number;
  totalWaitMinutes: number;
  lunchMinutes: number;
}): { drive: number; dwell: number; wait: number; lunch: number } {
  return {
    drive: Math.max(0, a.totalDurationMinutes - a.totalDwellMinutes - a.totalWaitMinutes - a.lunchMinutes),
    dwell: a.totalDwellMinutes,
    wait: a.totalWaitMinutes,
    lunch: a.lunchMinutes,
  };
}

function orderStopsByJobIds(selected: StopItem[], jobIds: number[]): StopItem[] {
  const byId = new Map(selected.map(s => [s.job.id, s]));
  const ordered: StopItem[] = [];
  for (const id of jobIds) {
    const s = byId.get(id);
    if (s) { ordered.push(s); byId.delete(id); }
  }
  for (const s of byId.values()) ordered.push(s);
  return ordered;
}

// ─── Component ──────────────────────────────────────────────────────────

export default function ServeRoutePlanner({
  isOpen, onClose, jobs, officers, currentUserId, onRouteOptimized, preselectedJobIds, onVerifyAddress, mileageRate, initialDate,
}: ServeRoutePlannerProps) {
  const { addToast } = useToast();
  const IRS_MILEAGE_RATE = mileageRate ?? 0.67;
  const TERMINAL_STATUSES = new Set<ServeJob['status']>(['served', 'failed', 'skipped', 'archived']);
  // All non-terminal jobs appear in the list. Un-geocoded ones are visible but
  // unselectable so officers can see what's missing from their route and why.
  const visibleJobs = jobs.filter(j => !TERMINAL_STATUSES.has(j.status));
  const geocodedJobs = visibleJobs.filter(j => j.recipient_lat != null && j.recipient_lng != null);

  const [stops, setStops] = useState<StopItem[]>([]);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [totalDistance, setTotalDistance] = useState(0);
  const [totalDuration, setTotalDuration] = useState(0);
  const [vehicleMpg, setVehicleMpg] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [selectedOfficerId, setSelectedOfficerId] = useState<number>(currentUserId || 0);
  const [routeDate, setRouteDate] = useState(
    () => initialDate ?? (() => {
      const d = new Date(); // new-date-ok — default to today matching the page's date
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    })(),
  );
  const [plannedStartTime, setPlannedStartTime] = useState(() => {
    const stored = localStorage.getItem('rmpg_route_start_time');
    if (stored) return stored;
    // Default to current wall-clock time so ETAs are anchored to NOW.
    const now = new Date(); // new-date-ok — local wall-clock for initial default
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  });
  const [savedRouteLoaded, setSavedRouteLoaded] = useState(false);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  // Fingerprint of the stop selection+order when Directions last ran.
  // Auto-compute skips when this matches the current order to avoid
  // overwriting precise routed stats with haversine estimates.
  const lastDirectionsOrderKeyRef = useRef<string>('');
  const lastBakedStartMsRef = useRef<number>(0);
  // WebGL context-loss recovery (rebuilds the map after a GPU context drop).
  const [routeMapRecoverNonce, setRouteMapRecoverNonce] = useState(0);
  const [isRouteMapRecovering, setIsRouteMapRecovering] = useState(false);
  const [routeMapNeedsManualReload, setRouteMapNeedsManualReload] = useState(false);
  const routeMapRecoveryCleanupRef = useRef<(() => void) | null>(null);
  const currentLocMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const routeSourceIdRef = useRef<string | null>(null);
  const returnRouteSourceIdRef = useRef<string | null>(null);
  const [returnLegMiles, setReturnLegMiles] = useState(0);
  // F1: per-stop arrival estimates (job.id → timestamp ms)
  const [stopArrivalTimes, setStopArrivalTimes] = useState<Map<number, number>>(new Map());
  // F2: circular route toggle (default on — matches existing always-circular behavior)
  const [returnToStart, setReturnToStart] = useState(true);
  // F4: multi-day split banner (shown when total estimated time > 8 h)
  const [showSplitBanner, setShowSplitBanner] = useState(false);
  const [splitSaving, setSplitSaving] = useState(false);
  // F5: missed-deadline confirm before applying
  const [missedDeadlineIds, setMissedDeadlineIds] = useState<number[]>([]);
  const [showDeadlineConfirm, setShowDeadlineConfirm] = useState(false);
  // Server-optimizer results: ETAs and geocode warnings
  const [serverEtas, setServerEtas] = useState<string[]>([]);
  const [serverEtaJobIds, setServerEtaJobIds] = useState<number[]>([]);
  const [geocodeWarnings, setGeocodeWarnings] = useState<GeocodeWarning[]>([]);
  const [matrixFallback, setMatrixFallback] = useState(false);
  const [matrixFallbackReason, setMatrixFallbackReason] = useState<string | undefined>(undefined);
  const [matrixFallbackDismissed, setMatrixFallbackDismissed] = useState(false);
  const [geocodeWarningDismissed, setGeocodeWarningDismissed] = useState(false);
  // Traffic polling state
  const [trafficSuggestion, setTrafficSuggestion] = useState<{
    addedMinutes: number;
    newOrderJobIds: number[];
    newEtas: string[];
  } | null>(null);
  const [routeAccepted, setRouteAccepted] = useState(false);
  // true = stats came from haversine estimate; false = from Mapbox Directions
  const [statsIsEstimate, setStatsIsEstimate] = useState(true);
  const [lockedIds, setLockedIds] = useState<Set<number>>(() => new Set());
  const [runBreakdown, setRunBreakdown] = useState({ drive: 0, dwell: 0, wait: 0, lunch: 0 });

  // Reset derived stats when planner opens; sync date to the page's current date.
  // Re-anchor the start time to now so ETAs always start from the current moment
  // rather than a stale stored value from a previous session.
  useEffect(() => {
    if (!isOpen) return;
    if (initialDate) setRouteDate(initialDate);
    setPlannedStartTime(() => {
      const stored = localStorage.getItem('rmpg_route_start_time');
      if (stored) return stored;
      const now = new Date(); // new-date-ok — local wall-clock on planner open
      return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    });
    setReturnLegMiles(0);
    setStopArrivalTimes(new Map());
    setShowSplitBanner(false);
    setMissedDeadlineIds([]);
    setShowDeadlineConfirm(false);
    setSavedRouteLoaded(false); // Fix #3: always re-fetch saved route on re-open
    setServerEtas([]);
    setServerEtaJobIds([]);
    setGeocodeWarnings([]);
    setMatrixFallback(false);
    setMatrixFallbackReason(undefined);
    setMatrixFallbackDismissed(false);
    setGeocodeWarningDismissed(false);
    setTrafficSuggestion(null);
    setRouteAccepted(false);
  }, [isOpen]);

  // Track whether stops have been initialized for the current open session.
  const stopsInitializedRef = useRef(false);

  // Initialize stops when the modal first opens.
  useEffect(() => {
    if (!isOpen) {
      stopsInitializedRef.current = false;
      return;
    }
    if (stopsInitializedRef.current) return;
    stopsInitializedRef.current = true;
    const items: StopItem[] = visibleJobs.map((job, i) => ({
      job,
      // Un-geocoded jobs are never pre-selected — they can't be routed.
      selected: (job.recipient_lat != null && job.recipient_lng != null)
        && isJobPreselected(job.status, preselectedJobIds, job.id),
      order: i,
    }));
    items.sort((a, b) => {
      const twDiff = timeWindowPriority(a.job.time_window, plannedStartMs) - timeWindowPriority(b.job.time_window, plannedStartMs);
      if (twDiff !== 0) return twDiff;
      return priorityWeight(a.job.priority) - priorityWeight(b.job.priority);
    });
    items.forEach((item, i) => { item.order = i; });
    setStops(items);
    setTotalDistance(0);
    setTotalDuration(0);
    setError(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // While the modal is open, reconcile job list changes (polling) without
  // touching existing selections. New jobs are appended unselected; jobs
  // that disappeared are removed.
  useEffect(() => {
    if (!isOpen || !stopsInitializedRef.current) return;
    setStops(prev => {
      const prevById = new Map(prev.map(s => [s.job.id, s]));
      const incoming = new Set(visibleJobs.map(j => j.id));
      // Remove jobs that are no longer in the visible list.
      const kept = prev.filter(s => incoming.has(s.job.id)).map(s => ({
        ...s,
        // Refresh the job data (status/fields may have changed) but keep selected.
        job: visibleJobs.find(j => j.id === s.job.id) ?? s.job,
      }));
      const keptIds = new Set(kept.map(s => s.job.id));
      // Append genuinely new jobs at the end, unselected.
      const added: StopItem[] = visibleJobs
        .filter(j => !keptIds.has(j.id) && !prevById.has(j.id))
        .map((job, i) => ({
          job,
          selected: false,
          order: kept.length + i,
        }));
      if (added.length === 0 && kept.length === prev.length
          && kept.every((s, i) => s.job === prev[i].job)) return prev;
      return [...kept, ...added];
    });
  }, [isOpen, jobs]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Live GPS tracking ───
  // The app already runs a single mandatory, hardened location tracker
  // app-wide (Layout mounts useGpsTracking — Toughbook internal GPS,
  // WiFi-jump smoothing, IP fallback, heartbeat restart). This component
  // used to spin up its OWN bare navigator.geolocation.watchPosition,
  // duplicating the permission prompt/battery cost and getting none of
  // that hardening — on a Toughbook it would fight the internal-GPS
  // reader for the same COM port. Read the shared tracker instead
  // (upload: false — Layout's instance already owns breadcrumb uploads).
  const gps = useGpsTracking({ upload: false });
  const currentLocation = isOpen && gps.latitude != null && gps.longitude != null
    ? { lat: gps.latitude, lng: gps.longitude }
    : null;
  const gpsAccuracy = gps.accuracy;

  // ─── Route starting location (origin) ───
  // Optimization is only meaningful relative to an origin — see
  // utils/serveRouteOrigin.ts for why, and for the freshness policy. The live
  // browser fix is only valid when the planner IS the officer being planned
  // for; a supervisor using the officer dropdown needs THAT officer's own last
  // known position instead.
  const [lastKnownFix, setLastKnownFix] = useState<LastKnownFix | null>(null);
  const plannedOfficerId = selectedOfficerId || currentUserId;
  const planningForSelf = plannedOfficerId != null && plannedOfficerId === currentUserId;

  useEffect(() => {
    if (!isOpen || plannedOfficerId == null) { setLastKnownFix(null); return; }
    // Skip the round-trip when a live fix already settles it.
    if (planningForSelf && currentLocation) { setLastKnownFix(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const fix = await apiFetch<LastKnownFix>(`/process-server/officer-start/${plannedOfficerId}`);
        if (!cancelled) setLastKnownFix(fix ?? null);
      } catch {
        // Non-fatal: the planner still works unanchored, and the UI says so
        // rather than pretending an origin exists.
        if (!cancelled) setLastKnownFix({ found: false });
      }
    })();
    return () => { cancelled = true; };
    // currentLocation is intentionally reduced to a presence check — re-fetching
    // on every GPS tick would hammer the endpoint once a fix starts streaming.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, plannedOfficerId, planningForSelf, currentLocation != null]);

  const originResolution = resolveRouteOrigin({
    planningForSelf,
    liveGps: currentLocation ? { ...currentLocation, accuracyM: gpsAccuracy ?? null } : null,
    lastKnown: lastKnownFix,
  });
  const routeOrigin = originResolution.origin;

  const plannedStartMs = useMemo(
    () => plannedStartToMs(routeDate, plannedStartTime),
    [routeDate, plannedStartTime],
  );

  const plannedOfficerName = officers?.find(o => o.id === plannedOfficerId)?.name ?? null;

  // First leg: origin → first SELECTED stop, in list order. Straight-line
  // (haversine) rather than the Directions leg distance, because this is shown
  // before any optimize run and must not depend on a network call. Labelled as
  // such in the row's tooltip so it isn't mistaken for driving distance.
  const firstSelectedStop = stops.find(s => s.selected);
  const firstLegMiles = routeOrigin
    && firstSelectedStop?.job.recipient_lat != null
    && firstSelectedStop.job.recipient_lng != null
    ? haversineMiles(
        routeOrigin.lat, routeOrigin.lng,
        firstSelectedStop.job.recipient_lat, firstSelectedStop.job.recipient_lng,
      )
    : null;

  // Auto-compute haversine stats whenever stops are reordered or selection changes.
  // Gives immediate feedback without requiring "Optimize Route". Uses the CURRENT
  // stop ordering (not NN-reordered) so ETAs track the user's manual arrangement.
  // Skips when the current order key matches lastDirectionsOrderKeyRef (Directions
  // result still valid) or when a Directions optimize is actively running.
  useEffect(() => {
    if (optimizing) return;
    const selected = stops.filter(s => s.selected);
    const currentKey = selected.map(s => s.job.id).join(',') + ':' + String(returnToStart);
    if (currentKey === lastDirectionsOrderKeyRef.current) {
      const delta = plannedStartMs - lastBakedStartMsRef.current;
      if (delta !== 0 && lastBakedStartMsRef.current !== 0) {
        setStopArrivalTimes(prev => {
          if (prev.size === 0) return prev;
          const next = new Map<number, number>();
          for (const [id, ms] of prev) next.set(id, ms + delta);
          return next;
        });
        lastBakedStartMsRef.current = plannedStartMs;
      }
      return;
    }
    if (selected.length < 1) {
      setTotalDistance(0);
      setTotalDuration(0);
      setReturnLegMiles(0);
      setStopArrivalTimes(new Map());
      setRunBreakdown({ drive: 0, dwell: 0, wait: 0, lunch: 0 });
      return;
    }
    const estimated = computeArrivalsInOrder(selected, routeOrigin, plannedStartMs, routeDate);
    const { arrivals, totalDistanceMiles, totalDurationMinutes, missedDeadlineJobIds } = estimated;
    setRunBreakdown(clockBreakdown(estimated));
    let returnMi = 0;
    if (returnToStart && routeOrigin && selected.length > 0) {
      const last = selected[selected.length - 1];
      returnMi = haversineMiles(last.job.recipient_lat!, last.job.recipient_lng!, routeOrigin.lat, routeOrigin.lng);
    }
    const totalDur = totalDurationMinutes + estimateDriveMinutes(returnMi);
    setTotalDistance(totalDistanceMiles + returnMi);
    setTotalDuration(totalDur);
    setReturnLegMiles(returnMi);
    setStatsIsEstimate(true);
    setStopArrivalTimes(arrivals);
    setMissedDeadlineIds(missedDeadlineJobIds);
    setShowSplitBanner(totalDur > 480);
    lastBakedStartMsRef.current = plannedStartMs;
  }, [stops, routeOrigin, returnToStart, optimizing, plannedStartMs]);

  useEffect(() => {
    if (!isOpen || savedRouteLoaded) return;
    const officerId = selectedOfficerId || currentUserId;
    if (!officerId) { setSavedRouteLoaded(true); return; }
    let cancelled = false;
    (async () => {
      try {
        const resp = await apiFetch<any[]>(`/process-server/routes/${routeDate}?officer_id=${officerId}`);
        const saved = Array.isArray(resp) ? resp[0] : resp;
        if (cancelled || !saved?.optimized_order_json) return;
        const orderJson = typeof saved.optimized_order_json === 'string' ? JSON.parse(saved.optimized_order_json) : saved.optimized_order_json;
        if (Array.isArray(orderJson) && orderJson.length > 0) {
          setStops(prev => {
            const idToStop = new Map(prev.map(s => [s.job.id, s]));
            const ordered: StopItem[] = [];
            for (const id of orderJson) {
              const s = idToStop.get(id);
              if (s) { ordered.push({ ...s, selected: true }); idToStop.delete(id); }
            }
            for (const s of idToStop.values()) ordered.push(s);
            return ordered.map((s, i) => ({ ...s, order: i }));
          });
        }
        if (saved.total_distance_miles) setTotalDistance(saved.total_distance_miles);
        if (saved.total_time_minutes) setTotalDuration(saved.total_time_minutes);
      } catch {
        // Deliberately non-fatal: a saved route that won't load must not stop
        // the officer planning a new one. But it must not be SILENT either —
        // the previous bare `catch {}` meant a failed load looked identical to
        // "no route saved for today", so an officer could re-plan a run that
        // already existed and never know the stored order had been lost.
        if (!cancelled) setError("Couldn't load the saved route for this date — showing an unordered list.");
      }
      setSavedRouteLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [isOpen, savedRouteLoaded, selectedOfficerId, currentUserId, routeDate]);

  // Initialize Mapbox
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    const initMap = () => {
      if (cancelled || !mapContainerRef.current) return;
      const centerLng = currentLocation?.lng || geocodedJobs[0]?.recipient_lng || -111.891;
      const centerLat = currentLocation?.lat || geocodedJobs[0]?.recipient_lat || 40.7608;

      const map = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: MAPBOX_STYLE_DARK,
        center: [centerLng, centerLat],
        zoom: 11,
        projection: 'mercator',
        attributionControl: false,
      });
      map.on('style.load', () => applyRmpgBasemap(map, { variant: 'dark' }));
      mapRef.current = map;
      setMapReady(true);

      // Rebuild in place if the GPU drops the context. The marker effect
      // (keyed on mapReady) re-runs and re-fits bounds to the stops.
      routeMapRecoveryCleanupRef.current = installWebglContextRecovery(map, {
        label: 'ServeRoutePlanner',
        onRebuild: () => {
          setIsRouteMapRecovering(false);
          setRouteMapNeedsManualReload(false);
          if (routeMapRecoveryCleanupRef.current) { routeMapRecoveryCleanupRef.current(); routeMapRecoveryCleanupRef.current = null; }
          markersRef.current.forEach((m) => { try { m.remove(); } catch { /* gone */ } });
          markersRef.current = [];
          if (mapRef.current) { try { mapRef.current.remove(); } catch { /* gone */ } mapRef.current = null; }
          setMapReady(false);
          setRouteMapRecoverNonce((n) => n + 1);
        },
        onContextLost: () => setIsRouteMapRecovering(true),
        onContextRestored: () => setIsRouteMapRecovering(false),
        onGiveUp: () => { setIsRouteMapRecovering(false); setRouteMapNeedsManualReload(true); },
      });
    };

    // Retry the token fetch a few times with backoff before giving up.
    // getMapboxAccessToken()'s server fallback (fetchMapboxConfig in
    // mapboxToken.ts) requires an auth token already in localStorage at
    // the exact moment it's called and returns empty with NO retry of its
    // own if that's momentarily missing (e.g. this modal opening in the
    // same tick as a fresh login) — previously that meant one unlucky
    // timing race permanently broke Mapbox for the rest of this mount,
    // with no path back to a working map short of closing and reopening.
    const MAX_ATTEMPTS = 3;
    (async () => {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const token = await getMapboxAccessToken();
          if (cancelled) return;
          initMapbox(token);
          if (cancelled) return;
          initMap();
          return;
        } catch (err) {
          if (cancelled) return;
          if (attempt >= MAX_ATTEMPTS) { setError('Failed to load Mapbox'); return; }
          await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
        }
      }
    })();

    return () => {
      cancelled = true;
      setMapReady(false);
      if (routeMapRecoveryCleanupRef.current) { routeMapRecoveryCleanupRef.current(); routeMapRecoveryCleanupRef.current = null; }
      markersRef.current.forEach((m) => { try { m.remove(); } catch { /* gone */ } });
      markersRef.current = [];
      if (mapRef.current) { try { mapRef.current.remove(); } catch { /* gone */ } mapRef.current = null; }
    };
  }, [isOpen, routeMapRecoverNonce]);

  // Update markers when stops change
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;

    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    const bounds = new mapboxgl.LngLatBounds();

    let markerSeq = 0;
    stops.forEach((stop) => {
      if (!stop.selected) return;
      markerSeq++;
      const lngLat: [number, number] = [stop.job.recipient_lng!, stop.job.recipient_lat!];
      bounds.extend(lngLat);

      const color = markerColor(stop.job.status);
      const el = document.createElement('div');
      el.style.cssText = `width:28px;height:28px;border-radius:50%;background:${color};border:2px solid #fff;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:bold;font-size:11px;box-shadow:0 2px 6px rgba(0 0 0 / 0.4);cursor:pointer;`;
      el.textContent = String(markerSeq);
      el.title = `${stop.job.recipient_name ?? 'Unknown'}\n${stop.job.recipient_address || ''}`;

      const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat(lngLat)
        .addTo(mapRef.current!);
      markersRef.current.push(marker);
    });

    if (currentLocation) {
      const cl: [number, number] = [currentLocation.lng, currentLocation.lat];
      if (currentLocMarkerRef.current) currentLocMarkerRef.current.remove();
      const el = document.createElement('div');
      el.style.cssText = 'width:16px;height:16px;border-radius:50%;background:#888888;border:2px solid #fff;box-shadow:0 1px 4px rgba(0 0 0 / 0.4);';
      currentLocMarkerRef.current = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat(cl).addTo(mapRef.current!);
      bounds.extend(cl);
    }

    if (stops.some(s => s.selected)) {
      mapRef.current.fitBounds(bounds, { padding: 60 });
    }
  }, [stops, mapReady, currentLocation]);

  // Actions
  const toggleStop = useCallback((idx: number) => {
    setStops(prev => prev.map((s, i) => {
      if (i !== idx) return s;
      // Un-geocoded jobs can never be selected — they have no coordinates to route to.
      if (s.job.recipient_lat == null || s.job.recipient_lng == null) return s;
      return { ...s, selected: !s.selected };
    }));
  }, []);
  const selectAll = useCallback(() => setStops(prev => prev.map(s => ({
    ...s,
    selected: s.job.recipient_lat != null && s.job.recipient_lng != null,
  }))), []);
  const deselectAll = useCallback(() => setStops(prev => prev.map(s => ({ ...s, selected: false }))), []);

  // Defined before moveStop/reorderStop so those callbacks can reference it.
  const clearRouteFromMap = useCallback(() => {
    if (!mapRef.current) return;
    const srcId = routeSourceIdRef.current;
    if (srcId) {
      safeRemoveLayer(mapRef.current, srcId);
      safeRemoveSource(mapRef.current, srcId);
      routeSourceIdRef.current = null;
    }
    const retSrcId = returnRouteSourceIdRef.current;
    if (retSrcId) {
      safeRemoveLayer(mapRef.current, retSrcId);
      safeRemoveSource(mapRef.current, retSrcId);
      returnRouteSourceIdRef.current = null;
    }
  }, []);

  const moveStop = useCallback((idx: number, dir: -1 | 1) => {
    setStops(prev => {
      const next = [...prev];
      const targetIdx = idx + dir;
      if (targetIdx < 0 || targetIdx >= next.length) return prev;
      [next[idx], next[targetIdx]] = [next[targetIdx], next[idx]];
      return next.map((s, i) => ({ ...s, order: i }));
    });
    // Invalidate the Directions fingerprint so auto-compute kicks in,
    // and remove the now-stale route polyline from the map.
    lastDirectionsOrderKeyRef.current = '';
    clearRouteFromMap();
  }, [clearRouteFromMap]);
  // Drag-and-drop reorder — mirrors the pattern already used for PDF page
  // thumbnails (pdf-editor/components/ThumbnailSidebar.tsx): a moved stop is
  // spliced out and reinserted at the drop index rather than swapped, so
  // dragging stop 1 onto stop 5 shifts 2-5 up by one instead of just
  // swapping 1 and 5 (what the up/down arrows do one step at a time).
  const reorderStop = useCallback((fromIdx: number, toIdx: number) => {
    setStops(prev => reorderList(prev, fromIdx, toIdx).map((s, i) => ({ ...s, order: i })));
    lastDirectionsOrderKeyRef.current = '';
    clearRouteFromMap();
  }, [clearRouteFromMap]);

  const deferStop = useCallback((idx: number) => {
    setStops(prev => {
      const next = [...prev];
      const [item] = next.splice(idx, 1);
      if (!item) return prev;
      next.push({ ...item, selected: false });
      return next.map((s, i) => ({ ...s, order: i }));
    });
    lastDirectionsOrderKeyRef.current = '';
    clearRouteFromMap();
  }, [clearRouteFromMap]);

  const optimizeRoute = useCallback(async (opts?: { remainingOnly?: boolean }) => {
    const selected = stops.filter(s => s.selected && (!opts?.remainingOnly || !TERMINAL_STATUSES.has(s.job.status)));
    if (selected.length < 2) {
      setError('Select at least 2 stops to optimize');
      return;
    }

    setOptimizing(true);
    setError(null);
    clearRouteFromMap();
    setServerEtas([]);
    setServerEtaJobIds([]);
    setGeocodeWarnings([]);
    setMatrixFallback(false);
    setMatrixFallbackReason(undefined);
    setMatrixFallbackDismissed(false);
    setGeocodeWarningDismissed(false);

    const shiftStartIso = new Date(plannedStartMs).toISOString(); // new-date-ok — epoch ms
    const shiftEndIso = new Date(plannedStartMs + 12 * 3600_000).toISOString(); // new-date-ok — 12h shift window

    const v2 = await runServeOptimizationV2({
      serve_queue_ids: selected.map(s => s.job.id),
      officer_unit_id: selectedOfficerId || currentUserId,
      shift_start: shiftStartIso,
      shift_end: shiftEndIso,
      origin: routeOrigin,
      circular: returnToStart,
    });
    const v2Ordered = v2?.orderedJobIds?.length
      ? orderStopsByJobIds(selected, v2.orderedJobIds)
      : null;
    const v2Arrivals = v2 ? v2EtasToArrivalMs(v2.etaByJobId) : new Map<number, number>();
    if (v2?.avgMpg) setVehicleMpg(v2.avgMpg);
    const droppedWarning = v2?.droppedJobIds?.length
      ? `${v2.droppedJobIds.length} stop${v2.droppedJobIds.length === 1 ? '' : 's'} could not be fit into the optimized schedule.`
      : null;

    const serverOptimizePromise: Promise<{
      orderedStops: { jobId: number }[];
      etaPerStop: string[];
      matrixFallback: boolean;
      fallbackReason?: string;
      geocodeWarnings: GeocodeWarning[];
      avg_mpg?: number | null;
    } | null> = v2Ordered
      ? Promise.resolve(null)
      : apiFetch<{
          orderedStops: { jobId: number }[];
          etaPerStop: string[];
          matrixFallback: boolean;
          fallbackReason?: string;
          geocodeWarnings: GeocodeWarning[];
          avg_mpg?: number | null;
        }>('/serve-queue/optimize-route', {
          method: 'POST',
          body: JSON.stringify({
            stops: await buildRouteStopsFromJobs(stops, routeDate),
            departAt: shiftStartIso,
            origin: routeOrigin,
            circular: returnToStart,
            officer_id: selectedOfficerId || currentUserId,
          }),
        }).catch(() => null);

    if (!mapReady || !mapRef.current) {
      const serverResult = v2Ordered ? null : await serverOptimizePromise;
      const serverOrdered = serverResult?.orderedStops?.length
        ? orderStopsByJobIds(selected, serverResult.orderedStops.map(s => s.jobId))
        : null;
      const nn = nearestNeighborOrder(selected, routeOrigin, plannedStartMs, routeDate);
      const ordered = v2Ordered ?? serverOrdered ?? nn.ordered;
      const estimated = computeArrivalsInOrder(ordered, routeOrigin, plannedStartMs, routeDate);
      setRunBreakdown(clockBreakdown(estimated));
      const v2SameDay = v2Arrivals.size > 0
        && [...v2Arrivals.values()].every((ms) => denverYmd(ms) === routeDate);
      const arrivals = v2SameDay ? v2Arrivals : estimated.arrivals;
      const missedDeadlineJobIds = estimated.missedDeadlineJobIds;
      const totalDurationMinutes = v2SameDay && plannedStartMs
        ? Math.max(
          estimated.totalDurationMinutes,
          ([...v2Arrivals.values()].reduce((a, b) => Math.max(a, b), plannedStartMs) - plannedStartMs) / 60_000,
        )
        : estimated.totalDurationMinutes;
      let returnMi = 0;
      if (returnToStart && routeOrigin && ordered.length > 0) {
        const last = ordered[ordered.length - 1];
        returnMi = haversineMiles(
          last.job.recipient_lat!, last.job.recipient_lng!,
          routeOrigin.lat, routeOrigin.lng,
        );
      }
      const totalDurMin = totalDurationMinutes + estimateDriveMinutes(returnMi);
      setTotalDistance(
        (v2Ordered || serverOrdered
          ? ordered.reduce((sum, s, i) => {
              const prev = i === 0 ? routeOrigin : { lat: ordered[i - 1].job.recipient_lat!, lng: ordered[i - 1].job.recipient_lng! };
              return prev ? sum + haversineMiles(prev.lat, prev.lng, s.job.recipient_lat!, s.job.recipient_lng!) : sum;
            }, 0)
          : nn.totalDistanceMiles) + returnMi,
      );
      setReturnLegMiles(returnMi);
      setTotalDuration(totalDurMin);
      if (serverResult?.avg_mpg) setVehicleMpg(serverResult.avg_mpg);
      setStopArrivalTimes(arrivals);
      setShowSplitBanner(totalDurMin > 480);
      setMissedDeadlineIds(missedDeadlineJobIds);
      lastBakedStartMsRef.current = plannedStartMs;
      if (v2Ordered) {
        setGeocodeWarnings(clientGeocodeWarnings(selected));
        setMatrixFallback(false);
        setMatrixFallbackReason(undefined);
        setServerEtas([]);
        setServerEtaJobIds([]);
      } else if (serverResult) {
        setGeocodeWarnings(serverResult.geocodeWarnings ?? []);
        setMatrixFallback(serverResult.matrixFallback ?? true);
        setMatrixFallbackReason(serverResult.fallbackReason ?? 'no live map');
        setServerEtas([]);
        setServerEtaJobIds([]);
      }
      const unselected = stops.filter(s => !s.selected);
      setStops([
        ...ordered.map((s, i) => ({ ...s, order: i })),
        ...unselected.map((s, i) => ({ ...s, order: ordered.length + i })),
      ]);
      lastDirectionsOrderKeyRef.current = ordered.map(s => s.job.id).join(',') + ':' + String(returnToStart);
      const deadlineWarning = describeMissedDeadlines(missedDeadlineJobIds, selected);
      setError(
        [
          v2Ordered
            ? 'Map unavailable — stop order uses Mapbox Optimization V2; mileages are straight-line estimates.'
            : 'Map unavailable — used straight-line distance estimate instead of driving directions.',
          droppedWarning,
          deadlineWarning,
        ].filter(Boolean).join(' '),
      );
      setOptimizing(false);
      return;
    }

    try {
      const serverResult = v2Ordered ? null : await serverOptimizePromise;
      let selectedOrdered: StopItem[];
      if (v2Ordered) {
        selectedOrdered = v2Ordered;
        setGeocodeWarnings(clientGeocodeWarnings(selected));
        setMatrixFallback(false);
        setMatrixFallbackReason(undefined);
      } else if (serverResult?.orderedStops?.length) {
        selectedOrdered = orderStopsByJobIds(selected, serverResult.orderedStops.map(s => s.jobId));
        setGeocodeWarnings(serverResult.geocodeWarnings ?? []);
        if (serverResult.avg_mpg) setVehicleMpg(serverResult.avg_mpg);
        const newFallback = serverResult.matrixFallback ?? false;
        setMatrixFallback(newFallback);
        setMatrixFallbackReason(newFallback ? humanizeMatrixFallback(serverResult.fallbackReason) : undefined);
        if (newFallback) setMatrixFallbackDismissed(false);
      } else {
        selectedOrdered = nearestNeighborOrder(selected, routeOrigin, plannedStartMs, routeDate).ordered;
      }
      if (lockedIds.size > 0) {
        selectedOrdered = orderStopsByJobIds(
          selected,
          mergeLockedVisitOrder(selected.map(s => s.job.id), selectedOrdered.map(s => s.job.id), lockedIds),
        );
      }
      setServerEtas([]);
      setServerEtaJobIds([]);
      const preserveServerOrder = !!(v2Ordered || serverResult?.orderedStops?.length);

      const clusters = preserveServerOrder
        ? chunkInOrder(selectedOrdered, MAX_CLUSTER_STOPS)
        : chainClusters(clusterStops(selectedOrdered));
      let allOrderedStops: StopItem[] = [];
      let totalDistM = 0;
      let allGeometries: any[] = [];
      const allLegDurationsS: number[] = [];
      let degradedClusters = 0;
      let runningPosition: { lat: number; lng: number } | null = routeOrigin;
      let runningElapsedMs = plannedStartMs;
      const allMissedDeadlineJobIds: number[] = [];

      for (let ci = 0; ci < clusters.length; ci++) {
        const clusterStartElapsedMs = runningElapsedMs;
        const nn = nearestNeighborOrder(clusters[ci], runningPosition, clusterStartElapsedMs, routeDate);
        const cluster = preserveServerOrder ? clusters[ci] : nn.ordered;
        if (!preserveServerOrder) allMissedDeadlineJobIds.push(...nn.missedDeadlineJobIds);

        const originCoord = runningPosition
          ? [runningPosition.lng, runningPosition.lat] as [number, number]
          : [cluster[0].job.recipient_lng!, cluster[0].job.recipient_lat!] as [number, number];

        const waypointStops = runningPosition
          ? cluster.slice(0, -1)
          : cluster.slice(1, -1);
        const destStop = cluster[cluster.length - 1];
        const destCoord: [number, number] = [destStop.job.recipient_lng!, destStop.job.recipient_lat!];

        const allCoords = cluster.length === 1 && !runningPosition
          ? [originCoord]
          : [originCoord, ...waypointStops.map(s => [s.job.recipient_lng!, s.job.recipient_lat!] as [number, number]), destCoord];
        const token = await getMapboxAccessToken();
        if (!token) throw new Error('No Mapbox token');

        const coordStr = allCoords.map(c => c.join(',')).join(';');
        const route = allCoords.length >= 2
          ? await fetchMapboxDrivingRoute(token, coordStr, new Date(runningElapsedMs).toISOString()) // new-date-ok — epoch ms
          : null;

        const pushEstimatedLegs = () => {
          let cursor = runningPosition;
          for (const stop of cluster) {
            const mi = cursor
              ? haversineMiles(cursor.lat, cursor.lng, stop.job.recipient_lat!, stop.job.recipient_lng!)
              : 0;
            allLegDurationsS.push(estimateDriveMinutes(mi) * 60);
            cursor = { lat: stop.job.recipient_lat!, lng: stop.job.recipient_lng! };
          }
        };

        if (!route) {
          degradedClusters++;
          const est = nearestNeighborOrder(cluster, runningPosition, clusterStartElapsedMs, routeDate);
          allMissedDeadlineJobIds.push(...est.missedDeadlineJobIds);
          totalDistM += est.totalDistanceMiles / 0.000621371;
          pushEstimatedLegs();
          allOrderedStops.push(...cluster);
          runningPosition = { lat: destStop.job.recipient_lat!, lng: destStop.job.recipient_lng! };
          runningElapsedMs = est.finalElapsedMs;
          continue;
        }

        if (route.geometry) allGeometries.push(route.geometry);
        const legs: Array<{ distance?: number; duration?: number }> = route.legs || [];
        for (const leg of legs) totalDistM += leg.distance || 0;
        if (runningPosition) {
          for (let i = 0; i < cluster.length; i++) allLegDurationsS.push(legs[i]?.duration ?? 0);
        } else {
          allLegDurationsS.push(0);
          for (let i = 0; i < cluster.length - 1; i++) allLegDurationsS.push(legs[i]?.duration ?? 0);
        }

        allOrderedStops.push(...cluster);
        runningPosition = { lat: destStop.job.recipient_lat!, lng: destStop.job.recipient_lng! };
        const clusterLegs = allLegDurationsS.slice(-cluster.length);
        runningElapsedMs = clusterStartElapsedMs
          + computeArrivalsFromLegDurations(cluster, clusterStartElapsedMs, clusterLegs, routeDate).totalDurationMinutes * 60_000;
      }

      const baked = computeArrivalsFromLegDurations(allOrderedStops, plannedStartMs, allLegDurationsS, routeDate);
      setStopArrivalTimes(baked.arrivals);
      lastBakedStartMsRef.current = plannedStartMs;
      allMissedDeadlineJobIds.push(...baked.missedDeadlineJobIds);

      // Return leg: last stop → origin, to make mileage circular.
      let returnLegM = 0;
      let returnLegDurS = 0;
      if (returnToStart && routeOrigin && allOrderedStops.length > 0) {
        const lastStop = allOrderedStops[allOrderedStops.length - 1];
        const retStart: [number, number] = [lastStop.job.recipient_lng!, lastStop.job.recipient_lat!];
        const retEnd: [number, number] = [routeOrigin.lng, routeOrigin.lat];
        try {
          const token = await getMapboxAccessToken();
          const retRoute = await fetchMapboxDrivingRoute(
            token,
            `${retStart.join(',')};${retEnd.join(',')}`,
            new Date(runningElapsedMs).toISOString(), // new-date-ok — epoch ms
          );
          if (retRoute) {
            returnLegM = retRoute.distance || 0;
            returnLegDurS = retRoute.duration || 0;
            if (retRoute.geometry && mapRef.current) {
              const retSrcId = `serve-route-return-${Date.now()}`;
              returnRouteSourceIdRef.current = retSrcId;
              const retCoords = retRoute.geometry.coordinates || [];
              if (retCoords.length > 1) {
                whenStyleReady(mapRef.current, () => {
                  if (!mapRef.current || hasSource(mapRef.current, retSrcId)) return;
                  mapRef.current.addSource(retSrcId, {
                    type: 'geojson',
                    data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: retCoords } },
                  });
                  mapRef.current.addLayer({
                    id: retSrcId,
                    type: 'line',
                    source: retSrcId,
                    paint: { 'line-color': '#888888', 'line-width': 3, 'line-opacity': 0.5, 'line-dasharray': [4, 4] },
                  });
                });
              }
            }
          }
        } catch { /* non-fatal; fall through to haversine */ }
        if (returnLegM === 0) {
          const fallbackMi = haversineMiles(
            lastStop.job.recipient_lat!, lastStop.job.recipient_lng!,
            routeOrigin.lat, routeOrigin.lng,
          );
          returnLegM = fallbackMi / 0.000621371;
          returnLegDurS = estimateDriveMinutes(fallbackMi) * 60;
        }
      }
      totalDistM += returnLegM;

      // Render forward route on map
      if (allGeometries.length > 0 && mapRef.current) {
        const sourceId = `serve-route-${Date.now()}`;
        routeSourceIdRef.current = sourceId;

        const combinedCoords = allGeometries.flatMap(g => g.coordinates || []);
        if (combinedCoords.length > 1) {
          mapRef.current.addSource(sourceId, {
            type: 'geojson',
            data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: combinedCoords } },
          });
          mapRef.current.addLayer({
            id: sourceId,
            type: 'line',
            source: sourceId,
            paint: { 'line-color': '#888888', 'line-width': 4, 'line-opacity': 0.8 },
          });
        }
      }

      const distMiles = totalDistM * 0.000621371;
      const durMinutes = baked.totalDurationMinutes + returnLegDurS / 60;
      setReturnLegMiles(returnLegM * 0.000621371);
      setTotalDistance(distMiles);
      setTotalDuration(durMinutes);
      setRunBreakdown(clockBreakdown(baked));
      setStatsIsEstimate(degradedClusters > 0);
      setShowSplitBanner(durMinutes > 480);
      setMissedDeadlineIds([...new Set(allMissedDeadlineJobIds)]);

      const unselected = stops.filter(s => !s.selected);
      const newStops: StopItem[] = [
        ...allOrderedStops.map((s, i) => ({ ...s, order: i })),
        ...unselected.map((s, i) => ({ ...s, order: allOrderedStops.length + i })),
      ];
      setStops(newStops);
      lastDirectionsOrderKeyRef.current = allOrderedStops.map(s => s.job.id).join(',') + ':' + String(returnToStart);

      // Never report a partly-estimated route as if it were fully routed —
      // the distance drives the mileage figure the officer bills against.
      // Similarly, a route that can't fit every deadline must say so rather
      // than hand the officer a plausible-looking run that quietly blows one.
      const degradedWarning = degradedClusters > 0
        ? `${degradedClusters} of ${clusters.length} route segments used a straight-line estimate `
          + '— driving directions were unavailable for those stops.'
        : null;
      const deadlineWarning = describeMissedDeadlines(allMissedDeadlineJobIds, newStops);
      if (degradedWarning || deadlineWarning || droppedWarning) {
        setError([degradedWarning, droppedWarning, deadlineWarning].filter(Boolean).join(' '));
      }
    } catch (err: any) {
      setError(err?.message || 'Route optimization failed');
    } finally {
      setOptimizing(false);
    }
  }, [stops, mapReady, routeOrigin, returnToStart, clearRouteFromMap, plannedStartMs, selectedOfficerId, currentUserId, routeDate, lockedIds]);

  // Mid-shift traffic polling — 10-min interval while route is active
  useEffect(() => {
    if (!routeAccepted || !isOpen) return;
    const selectedStops = stops.filter(s => s.selected);
    if (selectedStops.length === 0) return;
    const TERMINAL: Set<string> = new Set(['served', 'failed', 'skipped', 'archived']);
    const allDone = selectedStops.every(s => TERMINAL.has(s.job.status));
    if (allDone) return;

    const check = async () => {
      try {
        const position = await new Promise<GeolocationPosition>((res, rej) =>
          navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000 }),
        );
        const remainingItems = selectedStops.filter(s => !TERMINAL.has(s.job.status));
        const remainingStops = await buildRouteStopsFromJobs(remainingItems, routeDate);
        const currentOrder = remainingStops.map((_, i) => i);
        const originalEtas = remainingItems.map(s => {
          const ms = stopArrivalTimes.get(s.job.id);
          return ms != null ? new Date(ms).toISOString() : new Date().toISOString(); // new-date-ok — epoch ms / live clock
        });
        const result = await apiFetch<{
          degraded: boolean;
          addedMinutes: number;
          newOrder: { jobId: number }[];
          newEtas: string[];
          matrixFallback: boolean;
        }>('/serve-queue/route/traffic-check', {
          method: 'POST',
          body: JSON.stringify({
            remainingStops,
            currentOrder,
            currentPosition: { lat: position.coords.latitude, lng: position.coords.longitude },
            originalEtas,
            departAt: new Date().toISOString(), // new-date-ok — live clock for mid-shift traffic check
          }),
        });
        if (result.degraded && !result.matrixFallback) {
          setTrafficSuggestion({
            addedMinutes: result.addedMinutes,
            newOrderJobIds: (result.newOrder ?? []).map((s: { jobId: number }) => s.jobId),
            newEtas: result.newEtas ?? [],
          });
        }
      } catch {
        // geolocation denied or network error — skip silently
      }
    };

    const id = setInterval(check, 600_000);
    return () => clearInterval(id);
  }, [routeAccepted, isOpen, stops, stopArrivalTimes]);

  // F3: print route sheet — delegates to the unified exportServeMapSheet
  const printRouteSheet = useCallback(() => {
    const selected = stops.filter(s => s.selected);
    exportServeMapSheet(selected.map((stop) => {
      const arrivalMs = stopArrivalTimes.get(stop.job.id);
      const etaStr = arrivalMs
        ? formatEtaDenver(arrivalMs, routeDate)
        : null;
      const dwellMin = Math.round(dwellMsForJob(stop.job) / 60_000);
      return {
        id: stop.job.id,
        recipient_name: stop.job.recipient_name,
        recipient_address: stop.job.recipient_address,
        priority: stop.job.priority ?? 'normal',
        deadline: stop.job.deadline ?? null,
        status: stop.job.status,
        eta: etaStr,
        bufferMinutes: dwellMin,
      };
    })).catch(() => { addToast('Failed to export route sheet.', 'error'); });
  }, [stops, stopArrivalTimes, routeDate, addToast]);

  // F4: split into two days
  const saveSplitRoute = useCallback(async () => {
    const selected = stops.filter(s => s.selected);
    if (selected.length < 2) return;
    const ids = selected.map(s => s.job.id);
    const start = plannedStartMs;
    const cumul: number[] = [];
    let last = start;
    for (const s of selected) {
      const arr = stopArrivalTimes.get(s.job.id) ?? last;
      cumul.push((arr - start) / 60_000 + dwellMsForJob(s.job) / 60_000);
      last = arr;
    }
    const { day1, day2 } = splitIdsByShiftMinutes(ids, cumul, 480);
    const day1Stops = day1.map(id => selected.find(s => s.job.id === id)!).filter(Boolean);
    const day2Stops = day2.map(id => selected.find(s => s.job.id === id)!).filter(Boolean);
    const officerId = selectedOfficerId || currentUserId;
    if (!officerId) return;
    setSplitSaving(true);
    try {
      const tomorrow = new Date(); // new-date-ok — local wall-clock for "next calendar day"
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
      // Sequential saves so a day2 failure is clearly surfaced without silently
      // leaving a partial write where day1 succeeded but day2 was lost.
      let day1Saved = false;
      try {
        await apiFetch('/process-server/routes', {
          method: 'POST',
          body: JSON.stringify({ officer_id: officerId, route_date: routeDate, optimized_order_json: JSON.stringify(day1Stops.map(s => s.job.id)), waypoints_json: JSON.stringify([]), total_distance_miles: totalDistance * (day1Stops.length / Math.max(1, selected.length)), total_time_minutes: totalDuration * (day1Stops.length / Math.max(1, selected.length)) }),
        });
        day1Saved = true;
        await apiFetch('/process-server/routes', {
          method: 'POST',
          body: JSON.stringify({ officer_id: officerId, route_date: tomorrowStr, optimized_order_json: JSON.stringify(day2Stops.map(s => s.job.id)), waypoints_json: JSON.stringify([]), total_distance_miles: totalDistance * (day2Stops.length / Math.max(1, selected.length)), total_time_minutes: totalDuration * (day2Stops.length / Math.max(1, selected.length)) }),
        });
        setShowSplitBanner(false);
        setError(`Split: ${day1Stops.length} stops saved for today, ${day2Stops.length} for tomorrow (${tomorrowStr}).`);
      } catch {
        setError(day1Saved
          ? `Today's ${day1Stops.length} stops saved, but tomorrow's ${day2Stops.length} stops failed to save — try again.`
          : 'Failed to save split route.');
      }
    } finally {
      setSplitSaving(false);
    }
  }, [stops, selectedOfficerId, currentUserId, routeDate, totalDistance, totalDuration, stopArrivalTimes, plannedStartMs]);

  const handleApplyAndClose = useCallback(async () => {
    // F5: gate on deadline confirmation when missed deadlines exist
    if (missedDeadlineIds.length > 0 && !showDeadlineConfirm) {
      setShowDeadlineConfirm(true);
      return;
    }
    setShowDeadlineConfirm(false);
    const selectedStops = stops.filter(s => s.selected);
    const selectedIds = selectedStops.map(s => s.job.id);

    // Persist BEFORE notifying the parent. onRouteOptimized re-fetches
    // GET /routes/:date to refresh the Route tab, so firing it first raced the
    // INSERT below and reliably read the pre-save state — the freshly applied
    // route did not appear until the operator changed the date and came back.
    const officerId = selectedOfficerId || currentUserId;
    if (officerId && selectedIds.length > 0) {
      try {
        const waypoints = selectedStops
          .filter(s => s.job.recipient_lat != null && s.job.recipient_lng != null)
          .map(s => ({ id: s.job.id, lat: s.job.recipient_lat, lng: s.job.recipient_lng, name: s.job.recipient_name }));
        await apiFetch('/process-server/routes', {
          method: 'POST',
          body: JSON.stringify({
            officer_id: officerId, route_date: routeDate,
            planned_start_time: plannedStartTime,
            optimized_order_json: JSON.stringify(selectedIds),
            waypoints_json: JSON.stringify(waypoints),
            total_distance_miles: totalDistance, total_time_minutes: totalDuration,
            start_lat: routeOrigin?.lat ?? null,
            start_lng: routeOrigin?.lng ?? null,
            end_lat: selectedStops.length > 0 ? selectedStops[selectedStops.length - 1].job.recipient_lat ?? null : null,
            end_lng: selectedStops.length > 0 ? selectedStops[selectedStops.length - 1].job.recipient_lng ?? null : null,
          }),
        });
      } catch {
        setError('Route saved locally but failed to persist to server');
      }
    }

    setRouteAccepted(true);
    onRouteOptimized(selectedIds, { totalDistance, totalDuration, fuelCost: totalDistance * IRS_MILEAGE_RATE, routeDate });
    onClose();
  }, [stops, missedDeadlineIds, showDeadlineConfirm, totalDistance, totalDuration, selectedOfficerId, currentUserId, routeDate, plannedStartTime, routeOrigin, onRouteOptimized, onClose]);

  if (!isOpen) return null;

  const selectedCount = stops.filter(s => s.selected).length;
  const fuelCost = totalDistance * IRS_MILEAGE_RATE;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-200" role="dialog" aria-modal="true" aria-label="Route Planner">
      <div className="bg-surface-base border border-rmpg-700 rounded-[2px] w-full h-full max-w-[1400px] max-h-[94dvh] flex flex-col shadow-md animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-rmpg-700 bg-surface-sunken">
          <div className="flex items-center gap-2">
            <Route size={16} className="text-accent-silver-400" />
            <h2 className="text-sm font-semibold tracking-wider" style={{ color: 'var(--panel-header-color)' }}>ROUTE PLANNER</h2>
            <span className="text-[11px] text-fg-muted ml-2">
              {selectedCount} of {stops.filter(s => s.job.recipient_lat != null && s.job.recipient_lng != null).length} routable
              {stops.some(s => s.job.recipient_lat == null || s.job.recipient_lng == null) && (
                <span className="text-amber-400 ml-1">· {stops.filter(s => s.job.recipient_lat == null || s.job.recipient_lng == null).length} missing address</span>
              )}
            </span>
            {totalDistance > 0 && (
              <span className="text-[10px] text-rmpg-400 ml-2 pl-2 border-l border-rmpg-700 font-mono">
                {totalDistance.toFixed(1)} mi · {Math.floor(totalDuration / 60)}h {Math.round(totalDuration % 60)}m
              </span>
            )}
            {/* The route's ANCHOR, not merely "where I am". Shows which position
                the optimizer started from and how trustworthy it is, so an
                unanchored or second-hand origin is never invisible. */}
            {routeOrigin ? (
              <span className={`text-[10px] ml-2 pl-2 border-l border-rmpg-700 font-mono ${
                routeOrigin.source === 'last_known' ? 'text-amber-400'
                : routeOrigin.accuracyM != null && routeOrigin.accuracyM < 20 ? 'text-green-400'
                : routeOrigin.accuracyM != null && routeOrigin.accuracyM < 50 ? 'text-amber-400'
                : 'text-rmpg-400'}`}>
                <MapPin size={10} className="inline mr-0.5" />
                START {routeOrigin.lat.toFixed(4)}, {routeOrigin.lng.toFixed(4)} · {describeOrigin(routeOrigin)}
              </span>
            ) : (
              <span className="text-[10px] ml-2 pl-2 border-l border-rmpg-700 font-mono text-red-400">
                <MapPin size={10} className="inline mr-0.5" />
                NO START LOCATION
              </span>
            )}
            {officers && officers.length > 0 && (
              <div className="flex items-center gap-1.5 ml-3 pl-3 border-l border-rmpg-700">
                <User size={12} className="text-fg-secondary" />
                <select id="ff-serverouteplanner-0"
                  value={selectedOfficerId || ''}
                  onChange={e => { setSelectedOfficerId(Number(e.target.value)); setSavedRouteLoaded(false); }}
                  className="px-2 py-0.5 text-[11px] bg-surface-sunken border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-[color:var(--accent-silver-400)] focus:outline-none focus:ring-1 focus:ring-[color:var(--accent-silver-400)]/40 transition-colors"
                >
                  {officers.map(o => (<option key={o.id} value={o.id}>{o.name}</option>))}
                </select>
              </div>
            )}
            {/* Planned start date + time — anchors all stop ETAs */}
            <div className="flex items-center gap-1 ml-3 pl-3 border-l border-rmpg-700">
              <Clock size={11} className="text-fg-secondary flex-shrink-0" />
              <input
                type="date"
                value={routeDate}
                onChange={e => { if (e.target.value) { setRouteDate(e.target.value); setSavedRouteLoaded(false); } }}
                className="px-1.5 py-0.5 text-[11px] bg-surface-sunken border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-[color:var(--accent-silver-400)] focus:outline-none focus:ring-1 focus:ring-[color:var(--accent-silver-400)]/40 transition-colors"
                title="Route date"
              />
              <input
                type="time"
                value={plannedStartTime}
                onChange={e => {
                  if (e.target.value) {
                    setPlannedStartTime(e.target.value);
                    localStorage.setItem('rmpg_route_start_time', e.target.value);
                  }
                }}
                className="px-1.5 py-0.5 text-[11px] bg-surface-sunken border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-[color:var(--accent-silver-400)] focus:outline-none focus:ring-1 focus:ring-[color:var(--accent-silver-400)]/40 transition-colors w-[78px]"
                title="Planned shift start time"
              />
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={selectAll} className="toolbar-btn text-xs px-2 py-1"><CheckSquare className="w-3 h-3" /> All</button>
            <button type="button" onClick={deselectAll} className="toolbar-btn text-xs px-2 py-1"><Square className="w-3 h-3" /> None</button>
            {/* F2: circular route toggle */}
            <button
              type="button"
              onClick={() => setReturnToStart(v => !v)}
              className={`toolbar-btn text-xs px-2 py-1 flex items-center gap-1 transition-colors ${returnToStart ? 'text-brand-400 border-brand-600/60' : 'text-fg-muted'}`}
              title={returnToStart ? 'Circular route — click to disable return leg' : 'One-way route — click to enable return to start'}
            >
              <RotateCcw className="w-3 h-3" /> {returnToStart ? 'Circular' : 'One-way'}
            </button>
            {/* F3: print route sheet (only when route has been optimized) */}
            {totalDistance > 0 && (
              <button type="button" onClick={printRouteSheet} className="toolbar-btn text-xs px-2 py-1 flex items-center gap-1" title="Print route sheet PDF">
                <Printer className="w-3 h-3" /> Print
              </button>
            )}
            <X size={20} className="text-rmpg-400 hover:text-rmpg-100 cursor-pointer transition-colors" onClick={onClose} aria-label="Close route planner" />
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Left: Stop list */}
          <div className="w-[380px] border-r border-rmpg-700 flex flex-col bg-surface-sunken">
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-rmpg-700">
              <div className="flex flex-col gap-1.5 flex-1">
                <span className="text-[9px] font-semibold tracking-wider" style={{ color: 'var(--panel-header-color)' }}>FIELD TOOLS</span>
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={() => optimizeRoute()} disabled={optimizing || selectedCount < 2}
                    className="toolbar-btn toolbar-btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-40 flex-1 justify-center">
                    {optimizing ? <><Loader2 className="w-3 h-3 animate-spin" /> Optimizing...</> : <><Route className="w-3 h-3" /> Optimize Route</>}
                  </button>
                  <button
                    type="button"
                    onClick={() => optimizeRoute({ remainingOnly: true })}
                    disabled={optimizing || stops.filter(s => s.selected && !TERMINAL_STATUSES.has(s.job.status)).length < 2}
                    className="toolbar-btn text-xs px-2 py-1.5 disabled:opacity-40"
                    title="Re-optimize only unserved stops"
                  >
                    Remaining
                  </button>
                </div>
              </div>
            </div>
            {stops.filter(s => s.selected).some(s => hasEveningWindow(s.job.time_window, s.job.next_attempt_window)) && (
              <div className="px-3 py-1.5 bg-purple-900/25 border-b border-purple-700/40 text-purple-300 text-[10px] leading-snug">
                Evening-window stops (17:00–21:00) are on this run — plan lighting, access hours, and a last-knock before 21:00.
              </div>
            )}
            {/* F4: multi-day split banner */}
            {showSplitBanner && (
              <div className="px-3 py-1.5 bg-amber-900/25 border-b border-amber-700/40 text-amber-300 text-[10px] flex items-center gap-2">
                <CalendarDays className="w-3 h-3 flex-shrink-0" />
                <span className="flex-1">This run exceeds 8 hours. Consider splitting across two days.</span>
                <button type="button" onClick={saveSplitRoute} disabled={splitSaving}
                  className="text-[9px] font-bold px-2 py-0.5 rounded-[2px] bg-amber-700/40 hover:bg-amber-600/50 border border-amber-600/50 transition-colors disabled:opacity-50 flex-shrink-0">
                  {splitSaving ? 'Saving…' : 'Split Now'}
                </button>
                <button type="button" onClick={() => setShowSplitBanner(false)} className="text-fg-muted hover:text-rmpg-100" aria-label="Dismiss split suggestion">
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* An unanchored route is a QUIET accuracy problem: the stop order is
                still produced, the mileage still looks plausible, and nothing on
                screen says the drive to the first stop was never counted. Say it. */}
            {!routeOrigin && (
              <div className="px-3 py-1.5 bg-amber-900/25 border-b border-amber-700/40 text-amber-300 text-[10px] leading-snug">
                {describeOriginProblem(originResolution)}
              </div>
            )}
            {trafficSuggestion && (
              <div className="px-3 py-2 bg-amber-900/30 border-b border-amber-700/40 text-amber-300 text-[10px] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">
                    Traffic has changed — route is now +{trafficSuggestion.addedMinutes} min behind schedule.
                  </span>
                  <button
                    type="button"
                    onClick={() => setTrafficSuggestion(null)}
                    className="ml-2 text-amber-400 hover:text-amber-200"
                    aria-label="Dismiss traffic suggestion"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      // Reorder selected stops to match the server's suggested order
                      if (trafficSuggestion.newOrderJobIds.length > 0) {
                        setStops(prev => {
                          const ordered = trafficSuggestion.newOrderJobIds
                            .map(jid => prev.find(s => s.job.id === jid))
                            .filter(Boolean) as StopItem[];
                          const unmatched = prev.filter(s => !trafficSuggestion.newOrderJobIds.includes(s.job.id));
                          return [...ordered.map((s, i) => ({ ...s, order: i })), ...unmatched.map((s, i) => ({ ...s, order: ordered.length + i }))];
                        });
                        setServerEtas(trafficSuggestion.newEtas);
                        setServerEtaJobIds(trafficSuggestion.newOrderJobIds);
                        const nextArrivals = new Map<number, number>();
                        trafficSuggestion.newOrderJobIds.forEach((id, i) => {
                          const iso = trafficSuggestion.newEtas[i];
                          const ms = iso ? new Date(iso).getTime() : NaN; // new-date-ok — ISO from optimizer
                          if (Number.isFinite(ms)) nextArrivals.set(id, ms);
                        });
                        setStopArrivalTimes(nextArrivals);
                      }
                      setTrafficSuggestion(null);
                    }}
                    className="rounded-[2px] bg-amber-700/50 hover:bg-amber-700/70 px-2 py-1 text-amber-100 font-semibold"
                  >
                    Accept Updated Route
                  </button>
                  <button
                    type="button"
                    onClick={() => setTrafficSuggestion(null)}
                    className="rounded-[2px] px-2 py-1 text-amber-400 hover:text-amber-200"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}
            {matrixFallback && !matrixFallbackDismissed && (
              <div className="px-3 py-1.5 bg-amber-900/20 border-b border-amber-700/30 text-amber-400 text-[10px] leading-snug flex items-center justify-between gap-2">
                <span>
                  Route ETAs use estimated distances — live traffic data was unavailable.
                  {matrixFallbackReason && (
                    <span className="ml-1 opacity-70">({matrixFallbackReason})</span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => setMatrixFallbackDismissed(true)}
                  className="flex-shrink-0 text-amber-500 hover:text-amber-300 leading-none"
                  aria-label="Dismiss traffic data warning"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
            {!geocodeWarningDismissed && geocodeWarnings.length > 0 && (
              <div className="px-3 py-2 bg-amber-900/25 border-b border-amber-700/40 text-amber-300 text-[10px] space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">
                    {geocodeWarnings.length} stop{geocodeWarnings.length > 1 ? 's' : ''} with unverified address{geocodeWarnings.length > 1 ? 'es' : ''} — route generated but pins may be inaccurate.
                  </span>
                  <button
                    type="button"
                    onClick={() => setGeocodeWarningDismissed(true)}
                    className="ml-2 text-amber-400 hover:text-amber-200 leading-none"
                    aria-label="Dismiss geocode warning"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
                {geocodeWarnings.map(w => (
                  <div key={w.jobId} className="flex items-center justify-between gap-2">
                    <span className="truncate">{w.defendant} — {w.address}</span>
                    {onVerifyAddress && (
                      <button
                        type="button"
                        onClick={() => onVerifyAddress(w.jobId)}
                        className="text-[color:var(--field-label-color)] hover:underline flex-shrink-0"
                      >
                        Verify →
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-rmpg-700 scrollbar-track-transparent">
              {/* Stop 0 — the origin the optimizer measured from. Rendered as a
                  real row so the sequence reads START → 1 → 2 …, matching how the
                  officer actually drives it, rather than starting at stop 1 with
                  the first leg unaccounted for. */}
              {routeOrigin && (
                <div className="flex items-center gap-2 px-3 py-2 border-b border-border-default bg-surface-overlay/40">
                  <div className="flex-shrink-0 p-0.5"><MapPin size={16} className="text-brand-400" /></div>
                  <span className="w-5 text-[10px] font-mono font-bold text-brand-400 flex-shrink-0">ST</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-rmpg-100 truncate">
                      Start{!planningForSelf && plannedOfficerName ? ` — ${plannedOfficerName}` : ''}
                    </div>
                    <div className="text-[10px] text-fg-muted truncate font-mono">
                      {routeOrigin.lat.toFixed(4)}, {routeOrigin.lng.toFixed(4)} · {describeOrigin(routeOrigin)}
                    </div>
                  </div>
                  {firstLegMiles != null && (
                    <span className="text-[10px] font-mono text-fg-secondary flex-shrink-0" title="Estimated distance to the first stop until Directions returns">
                      {firstLegMiles.toFixed(1)} mi →
                    </span>
                  )}
                </div>
              )}
              {stops.map((stop, idx) => {
                const isDragSource = dragIdx === idx;
                const isDropTarget = dropIdx === idx && dragIdx !== null && dragIdx !== idx;
                const hasCoords = stop.job.recipient_lat != null && stop.job.recipient_lng != null;
                return (
                <div key={stop.job.id}
                  draggable={hasCoords}
                  onDragStart={(e) => {
                    if (!hasCoords) return;
                    setDragIdx(idx);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', String(idx));
                  }}
                  onDragOver={(e) => {
                    if (dragIdx === null || dragIdx === idx) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    setDropIdx(idx);
                  }}
                  onDragLeave={() => { if (dropIdx === idx) setDropIdx(null); }}
                  onDrop={(e) => {
                    if (dragIdx === null) return;
                    e.preventDefault();
                    if (dragIdx !== idx) reorderStop(dragIdx, idx);
                    setDragIdx(null);
                    setDropIdx(null);
                  }}
                  onDragEnd={() => { setDragIdx(null); setDropIdx(null); }}
                  className={`flex items-center gap-2 px-3 py-2 border-b transition-colors ${
                    !hasCoords ? 'cursor-default opacity-40 bg-surface-sunken/30'
                    : isDropTarget ? 'border-b-brand-400 border-dashed bg-brand-400/10 cursor-grab active:cursor-grabbing'
                    : `cursor-grab active:cursor-grabbing ${stop.selected ? 'bg-surface-base' : 'opacity-50'}`
                  } ${isDragSource ? 'opacity-30' : ''} border-border-default`}>
                  <GripVertical size={12} className={`flex-shrink-0 ${hasCoords ? 'text-fg-muted' : 'invisible'}`} aria-hidden="true" />
                  <button
                    type="button"
                    onClick={() => toggleStop(idx)}
                    className="flex-shrink-0 p-0.5"
                    disabled={!hasCoords}
                    aria-label={!hasCoords ? 'Cannot select — no address' : stop.selected ? 'Deselect stop' : 'Select stop'}
                  >
                    {stop.selected ? <CheckSquare size={16} className="text-brand-400" /> : <Square size={16} className="text-fg-muted" />}
                  </button>
                  <span className="w-5 text-xs font-mono font-bold text-rmpg-300 flex-shrink-0">{idx + 1}</span>
                  <div className="flex-1 min-w-0 border-l border-accent-silver-400/30 pl-2">
                    <div className="text-xs font-medium text-rmpg-100 truncate">{stop.job.recipient_name}</div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-fg-muted truncate">{stop.job.recipient_address || 'No address'}</span>
                      {/* Server ETA (traffic-aware) takes priority; fall back to NN estimate */}
                      {(() => {
                        const arrivalMs = stopArrivalTimes.get(stop.job.id);
                        const serverIdx = serverEtaJobIds.indexOf(stop.job.id);
                        const serverEta = serverIdx >= 0 ? serverEtas[serverIdx] : null;
                        const ms = arrivalMs ?? (serverEta ? new Date(serverEta).getTime() : null); // new-date-ok — epoch or ISO
                        if (ms == null || !Number.isFinite(ms)) return null;
                        return (
                            <span className={`text-[9px] font-mono flex-shrink-0 ${missedDeadlineIds.includes(stop.job.id) ? 'text-red-400' : 'text-fg-secondary'}`}>
                              ETA {formatEtaDenver(ms, routeDate)}
                            </span>
                        );
                      })()}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <span className="text-[8px] font-mono uppercase text-fg-muted">
                        {dwellTypeShort(inferDefendantType(stop.job.recipient_address, stop.job.business_id, stop.job.recipient_type))}
                        {' · '}{Math.round(dwellMsForJob(stop.job) / 60_000)}m dwell
                      </span>
                      {(() => {
                        const hrs = hoursUntilDeadline(stop.job.deadline);
                        if (hrs == null) return null;
                        const late = hrs < 0;
                        return (
                          <span className={`text-[8px] font-mono ${late || missedDeadlineIds.includes(stop.job.id) ? 'text-red-400' : hrs < 8 ? 'text-amber-400' : 'text-fg-muted'}`}>
                            {late ? `${Math.abs(Math.round(hrs))}h past court` : `${hrs < 10 ? hrs.toFixed(1) : Math.round(hrs)}h to deadline`}
                          </span>
                        );
                      })()}
                    </div>
                    {(stop.job.building_access_notes || stop.job.contact_restrictions) && (
                      <div className="text-[8px] text-amber-300/90 truncate mt-0.5" title={[stop.job.contact_restrictions, stop.job.building_access_notes].filter(Boolean).join(' · ')}>
                        {stop.job.contact_restrictions ? `Restrict: ${stop.job.contact_restrictions}` : stop.job.building_access_notes}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {hasCoords && (
                      <button
                        type="button"
                        onClick={() => setLockedIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(stop.job.id)) next.delete(stop.job.id);
                          else next.add(stop.job.id);
                          return next;
                        })}
                        className={lockedIds.has(stop.job.id) ? 'text-brand-400' : 'text-fg-muted hover:text-rmpg-100'}
                        aria-label={lockedIds.has(stop.job.id) ? 'Unpin stop' : 'Pin stop so Optimize keeps this slot'}
                        title={lockedIds.has(stop.job.id) ? 'Pinned — Optimize will not move this stop' : 'Pin this stop'}
                      >
                        <Pin size={11} />
                      </button>
                    )}
                    {hasCoords && stop.selected && (
                      <button
                        type="button"
                        onClick={() => deferStop(idx)}
                        className="text-[8px] font-mono uppercase text-fg-muted hover:text-amber-300"
                        title="Defer — drop off today's run"
                      >
                        Defer
                      </button>
                    )}
                    {hasCoords && stop.job.recipient_lat != null && stop.job.recipient_lng != null && (
                      <a
                        href={googleMapsNavUrl(stop.job.recipient_lat, stop.job.recipient_lng)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-fg-muted hover:text-emerald-400"
                        aria-label={`Open maps for ${stop.job.recipient_name}`}
                      >
                        <ExternalLink size={11} />
                      </a>
                    )}
                    {stop.job.status === 'served' && (
                      <span className="text-[9px] font-semibold px-1 py-0.5 rounded-[2px] bg-green-900/40 text-green-400 border border-green-700/40 leading-none">SERVED</span>
                    )}
                    {stop.job.status === 'failed' && (
                      <span className="text-[9px] font-semibold px-1 py-0.5 rounded-[2px] bg-red-900/40 text-red-400 border border-red-700/40 leading-none">NON-SVC</span>
                    )}
                    {!hasCoords && (
                      <span className="text-[9px] font-semibold px-1 py-0.5 rounded-[2px] bg-amber-900/40 text-amber-400 border border-amber-700/40 leading-none" title="No geocoded address — cannot be added to route">
                        NO ADDR
                      </span>
                    )}
                    {!hasCoords && onVerifyAddress && (
                      <button
                        type="button"
                        onClick={() => onVerifyAddress(stop.job.id)}
                        className="text-[9px] text-[color:var(--field-label-color)] hover:underline leading-none flex-shrink-0"
                        title="Verify address to add this stop to the route"
                      >
                        Verify →
                      </button>
                    )}
                    {hasCoords && <PriorityBadge p={stop.job.priority} />}
                    {hasCoords && <TimeWindowBadge job={stop.job} routeDate={routeDate} />}
                    <div className="flex flex-col gap-0.5 ml-1">
                      <button type="button" onClick={() => moveStop(idx, -1)} disabled={idx === 0} className="text-fg-muted hover:text-rmpg-100 disabled:opacity-30" aria-label="Move stop up">
                        <ChevronUp size={10} />
                      </button>
                      <button type="button" onClick={() => moveStop(idx, 1)} disabled={idx === stops.length - 1} className="text-fg-muted hover:text-rmpg-100 disabled:opacity-30" aria-label="Move stop down">
                        <ChevronDown size={10} />
                      </button>
                    </div>
                  </div>
                </div>
                );
              })}
            </div>

            <div className="px-4 py-3 border-t border-rmpg-700 bg-surface-sunken space-y-2">
              <span className="text-[9px] font-semibold tracking-wider" style={{ color: 'var(--panel-header-color)' }}>RUN SUMMARY</span>
              {/* Start / anchor provenance, stated in the summary an operator
                  reads before committing the route — not just in the header. */}
              <div className="flex justify-between text-xs">
                <span className="text-fg-muted flex items-center gap-1.5"><Navigation size={12} /> Start:</span>
                <span className={`font-mono ${routeOrigin ? (routeOrigin.source === 'last_known' ? 'text-amber-400' : 'text-rmpg-100') : 'text-red-400'}`}>
                  {routeOrigin ? describeOrigin(routeOrigin) : 'none'}
                </span>
              </div>
              {firstLegMiles != null && (
                <div className="flex justify-between text-xs">
                  <span className="text-fg-muted flex items-center gap-1.5"><MapPin size={12} /> First leg:</span>
                  <span className="text-rmpg-100 font-mono">
                    {firstLegMiles.toFixed(1)} mi
                    {statsIsEstimate && <span className="text-rmpg-600 text-[9px] ml-1">(est. until Directions)</span>}
                  </span>
                </div>
              )}
              {returnLegMiles > 0 && (
                <div className="flex justify-between text-xs">
                  <span className="text-fg-muted flex items-center gap-1.5"><Navigation size={12} /> Return leg:</span>
                  <span className="text-amber-400 font-mono">{returnLegMiles.toFixed(1)} mi</span>
                </div>
              )}
              <div className="flex justify-between text-xs">
                <span className="text-fg-muted flex items-center gap-1.5"><MapPin size={12} /> Distance:</span>
                <span className="text-rmpg-100 font-mono flex items-center gap-1">
                  {totalDistance.toFixed(1)} mi
                  {returnLegMiles > 0 && <span className="text-fg-muted text-[9px]">(circular)</span>}
                  {statsIsEstimate && totalDistance > 0 && <span className="text-rmpg-600 text-[9px]">(est.)</span>}
                </span>
              </div>
              <div className="flex justify-between text-xs"><span className="text-fg-muted flex items-center gap-1.5"><Clock size={12} /> Est. Time:</span><span className="text-rmpg-100 font-mono">{Math.floor(totalDuration / 60)}h {Math.round(totalDuration % 60)}m</span></div>
              {(runBreakdown.drive > 0 || runBreakdown.dwell > 0) && (
                <div className="flex justify-between text-xs">
                  <span className="text-fg-muted flex items-center gap-1.5"><Clock size={12} /> Drive / dwell / wait:</span>
                  <span className="text-rmpg-100 font-mono text-[10px]">{formatRunBreakdown(runBreakdown)}</span>
                </div>
              )}
              {runBreakdown.lunch >= 1 && (
                <div className="flex justify-between text-xs">
                  <span className="text-fg-muted flex items-center gap-1.5"><Coffee size={12} /> Lunch:</span>
                  <span className="text-rmpg-100 font-mono">{Math.round(runBreakdown.lunch)} min (unpaid, noon Denver)</span>
                </div>
              )}
              {/* Planned start + projected end time */}
              <div className="flex justify-between text-xs">
                <span className="text-fg-muted flex items-center gap-1.5"><Clock size={12} /> Start → End:</span>
                <span className="text-rmpg-100 font-mono text-[10px]">
                  {formatEtaDenver(plannedStartMs, routeDate)}
                  {' → '}
                  {totalDuration > 0
                    ? formatEtaDenver(plannedStartMs + totalDuration * 60_000, routeDate)
                    : '--'}
                </span>
              </div>
              <div className="flex justify-between text-xs"><span className="text-fg-muted flex items-center gap-1.5"><DollarSign size={12} /> Fuel:</span><span className="text-rmpg-100 font-mono">${fuelCost.toFixed(2)}{vehicleMpg > 0 && gallonsForMiles(totalDistance, vehicleMpg) > 0 ? ` · ${gallonsForMiles(totalDistance, vehicleMpg).toFixed(1)} gal @ ${vehicleMpg} mpg` : gallonsForMiles(totalDistance) > 0 ? ` · ${gallonsForMiles(totalDistance).toFixed(1)} gal @ 18 mpg` : ''}</span></div>
              <div className="flex justify-between text-xs"><span className="text-fg-muted flex items-center gap-1.5"><Gauge size={12} /> Efficiency:</span><span className="text-rmpg-100 font-mono">{totalDistance > 0 ? `${(selectedCount / totalDistance).toFixed(1)} stops/mi` : '—'}</span></div>

              {/* F5: deadline miss warning */}
              {showDeadlineConfirm && (
                <div className="rounded-[2px] border border-red-700/60 bg-red-900/30 p-2 text-[10px] text-red-300 space-y-1.5">
                  <div className="flex items-center gap-1.5 font-bold">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                    {missedDeadlineIds.length} stop{missedDeadlineIds.length !== 1 ? 's' : ''} will miss their deadline at this order.
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={handleApplyAndClose}
                      className="flex-1 text-[10px] font-bold px-2 py-1 rounded-[2px] bg-red-800/50 hover:bg-red-700/60 border border-red-600/50 transition-colors">
                      Apply Anyway
                    </button>
                    <button type="button" onClick={() => setShowDeadlineConfirm(false)}
                      className="flex-1 text-[10px] px-2 py-1 rounded-[2px] bg-surface-raised border border-border-default hover:border-rmpg-500 transition-colors">
                      Go Back
                    </button>
                  </div>
                </div>
              )}
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={handleApplyAndClose} className="toolbar-btn toolbar-btn-primary text-xs px-4 py-2 flex-1 justify-center flex-col gap-0.5">
                  <span className="flex items-center gap-1.5"><Navigation size={14} /> Apply Route</span>
                  {(runBreakdown.drive > 0 || runBreakdown.dwell > 0) && (
                    <span className="text-[8px] font-normal text-rmpg-200/80">{formatRunBreakdown(runBreakdown)}</span>
                  )}
                </button>
                <button type="button" onClick={onClose} className="toolbar-btn text-xs px-4 py-2">Cancel</button>
              </div>
            </div>
          </div>

          {/* Right: Map */}
          <div className="flex-1 relative bg-surface-overlay">
            <div ref={mapContainerRef} className="absolute inset-0" />
            {(!mapReady || optimizing) && !isRouteMapRecovering && (
              <div className="absolute inset-0 flex items-center justify-center bg-[rgba(0 0 0 / 0.5)]">
                <Loader2 size={24} className="animate-spin text-brand-400" />
              </div>
            )}
            {isRouteMapRecovering && (
              <div className="absolute inset-0 z-50 flex items-center justify-center bg-surface-base/80 pointer-events-none">
                <div className="flex flex-col items-center gap-2">
                  <Loader2 size={20} className="animate-spin text-brand-400" />
                  <span className="text-rmpg-300 text-[10px] font-mono">MAP RECONNECTING…</span>
                </div>
              </div>
            )}
            {routeMapNeedsManualReload && (
              <div className="absolute inset-0 z-50 flex items-center justify-center bg-surface-base/90">
                <div className="flex flex-col items-center gap-2 text-center px-4">
                  <span className="text-rmpg-100 text-xs font-mono">MAP GPU CRASH</span>
                  <button onClick={() => window.location.reload()} className="px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white text-[10px] font-mono" style={{ borderRadius: 2 }}>
                    RELOAD PAGE
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
