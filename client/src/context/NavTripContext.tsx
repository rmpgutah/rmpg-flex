// ============================================================
// NavTripContext — app-wide vehicle trip detection
//
// Hosts ONE useNavTripDetection instance for the whole authenticated app so
// trips auto-detect + record live movement no matter which page the officer is
// on (and, critically, while they're in the full-screen Drive Mode HUD at
// /navigation, which renders OUTSIDE <Layout>). Previously detection lived only
// in NavPage, so trips were only recorded while that one page was open.
//
// The provider's GPS instance is READ-ONLY (`upload: false`): it reads the live
// position to drive detection but never POSTs breadcrumbs. The always-mounted
// uploader (Layout's tracker on normal pages, NavigationPage's on the Drive HUD)
// remains the sole writer to /dispatch/gps, so there's no double-upload. Keeping
// detection in exactly one place also removes the risk of two detectors racing
// the same `rmpg_nav_detection` localStorage key + double-POSTing /trip/start.
// ============================================================

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useGpsTracking } from '../hooks/useGpsTracking';
import { useNavTripDetection } from '../hooks/useNavTripDetection';
import { useNavGuidanceEngine, type NavGuidanceEngine } from '../hooks/useNavGuidanceEngine';
import type { NavWaypoint } from '../hooks/waypointAdvance';
import { useWebSocket } from './WebSocketContext';
import { apiFetch } from '../hooks/useApi';
import { stationPauseAction, type GeofenceAlertPayload } from './stationPauseLogic';
import { zoneEntryAlert, type ZoneAlertResult } from './zoneAlertLogic';
import { fetchWeather } from '../utils/weather';
import { weatherHazardLabel } from '../pages/navigation/weatherHazard';

type NavTripDetection = ReturnType<typeof useNavTripDetection>;

export interface NavTripContextValue extends NavTripDetection {
  /** The provider's read-only GPS state — exposed so consumers (NavPage) can
   *  render position/speed/unit without spinning up a second tracker. */
  gps: ReturnType<typeof useGpsTracking>;
  /** App-wide turn-by-turn guidance engine. Lives HERE (not in the drive HUD)
   *  so an active route keeps computing progress/ETA/reroutes while the
   *  officer is on Dispatch, Records, or any other page — leaving /navigation
   *  no longer resets navigation. The HUD only renders this engine's state. */
  guidance: NavGuidanceEngine;
  /** Load a unit's most recent saved route (built in RouteBuilderPage,
   *  /api/dispatch/routing/unit/:unitId) and hand it to the guidance engine
   *  as a multi-stop route. No-ops if the unit has no active saved route. */
  loadUnitRoute: (unitId: string) => Promise<void>;
  /** True while the active trip is paused for a station-geofence dwell (set by
   *  the auto pause/resume subscription below). Drives the HUD's "Trip Paused"
   *  badge — a locally-tracked mirror of the trip's server-side status, not a
   *  round-trip poll, since the pause/resume calls already originate here. */
  isTripPaused: boolean;
  /** Transient "entering zone" HUD notice for generic (non-station) alert
   *  geofences — set by the same geofence_alert subscription that drives
   *  station pause/resume, auto-cleared a few seconds after each enter event. */
  zoneAlert: ZoneAlertResult | null;
  /** Short hazard label ("Icy conditions" / "Snow" / "High wind" /
   *  "Low visibility") derived from the officer's current-position weather,
   *  or null when nothing hazardous is reported. Drives HudWeatherBadge. */
  weatherHazard: string | null;
}

/** Shape returned per-row by GET /api/dispatch/routing/unit/:unitId
 *  (src/routes/dispatch/routing.ts) — mirrors SavedRoute in RouteBuilderPage.
 *  Note: the row carries `waypoints_json` (the full per-stop objects with
 *  completion state), NOT `optimized_order_json` — that field is written on
 *  /save but not selected back by this endpoint. */
interface SavedUnitRoute {
  id: number;
  unit_id: string;
  waypoints_json: string;
  status: string;
  created_at: string;
}

/** One stop inside a saved route's `waypoints_json`, per
 *  src/routes/dispatch/routing.ts POST /optimize's waypoint shape. */
interface SavedRouteWaypoint {
  call_id: number;
  call_number: string;
  latitude: number;
  longitude: number;
  location_address?: string;
  completed?: boolean;
}

const NavTripContext = createContext<NavTripContextValue | null>(null);

export function NavTripProvider({ children }: { children: ReactNode }) {
  // Read-only: an active uploader (Layout, or NavigationPage in Drive Mode) owns
  // the breadcrumb POSTs. We only consume the live fix to drive trip detection.
  const gps = useGpsTracking({ upload: false });

  // CRITICAL: memoize the position object on the underlying GPS primitives.
  // useNavTripDetection's movement-detection effect depends on this object and
  // ALWAYS calls setDetection when it runs. If we passed a fresh object literal
  // every render, that setDetection would re-render the provider, produce a new
  // position ref, re-fire the effect, setDetection again… an infinite render
  // loop that pegs the main thread and makes the whole app (every click/Link)
  // unresponsive. Memoizing means the ref only changes when the GPS fix actually
  // changes, so a setDetection-driven re-render does NOT re-fire the effect.
  const position = useMemo(
    () => (gps.latitude != null && gps.longitude != null
      ? {
          latitude: gps.latitude,
          longitude: gps.longitude,
          accuracy: gps.accuracy ?? undefined,
          speed: gps.speed,
          heading: gps.headingSmoothed ?? gps.heading,
        }
      : null),
    [gps.latitude, gps.longitude, gps.accuracy, gps.speed, gps.headingSmoothed, gps.heading],
  );

  const trip = useNavTripDetection({
    position,
    isTracking: gps.isTracking,
    // App-wide detector — always treat as foreground; the GPS hook already
    // pauses/restarts the underlying watch on tab visibility changes.
    isForeground: true,
  });

  // App-wide turn-by-turn guidance. Every accepted GPS fix feeds the engine so
  // route progress, remaining ETA, off-route detection, and traffic reroutes
  // keep computing regardless of which page is mounted. updateOrigin bails
  // immediately when no destination is set, so this is a no-op off-route.
  const guidance = useNavGuidanceEngine();
  const { updateOrigin } = guidance;
  useEffect(() => {
    if (position) updateOrigin(position.latitude, position.longitude);
  }, [position, updateOrigin]);

  /** Load the unit's most recent active saved route and start multi-stop
   *  guidance from the live GPS fix (falling back to the route's saved
   *  origin if no live fix is available yet). */
  const loadUnitRoute = useCallback(async (unitId: string): Promise<void> => {
    if (!unitId) return;
    try {
      const rows = await apiFetch<SavedUnitRoute[]>(`/api/dispatch/routing/unit/${unitId}`);
      const route = Array.isArray(rows) ? rows.find((r) => r.status === 'active') : undefined;
      if (!route) return;

      let stops: SavedRouteWaypoint[] = [];
      try { stops = JSON.parse(route.waypoints_json || '[]'); } catch { stops = []; }
      const waypoints: NavWaypoint[] = stops
        .filter((s) => s.latitude != null && s.longitude != null)
        .map((s) => ({
          id: s.call_id,
          lat: s.latitude,
          lng: s.longitude,
          label: s.call_number || s.location_address || `Stop ${s.call_id}`,
          completed: s.completed === true,
        }));
      if (waypoints.length === 0) return;

      const originLat = position?.latitude ?? gps.latitude;
      const originLng = position?.longitude ?? gps.longitude;
      if (originLat == null || originLng == null) return;

      await guidance.startMultiStop(unitId, originLat, originLng, waypoints);
    } catch (err) {
      console.error('[NavTripContext] loadUnitRoute failed:', err);
    }
  }, [position, gps.latitude, gps.longitude, guidance]);

  // ── Station geofence auto pause/resume ────────────────────
  // When a unit's live GPS enters a 'station'-type geofence zone, auto-pause
  // the active nav trip; on exit, auto-resume it. Read activeTripId via a ref
  // (not the effect dependency) so the subscription isn't torn down and
  // re-created on every trip start/stop — it just needs the latest value at
  // event time.
  //
  // `geofence_alert` is broadcast to EVERY connected client (broadcastAll in
  // src/routes/dispatch/gps.ts), not scoped to a unit — every officer's app
  // receives every unit's enter/exit events. Without filtering by unit here,
  // any unit crossing a station geofence would pause/resume every OTHER
  // officer's trip too. `gps.unitId` (from the provider's own read-only GPS
  // instance, above) is this officer's own assigned unit — only act when the
  // event's unit matches it. Read via a ref for the same reason as
  // activeTripIdRef: the subscription shouldn't be torn down/recreated as
  // unitId resolves.
  const { subscribe } = useWebSocket();
  const activeTripIdRef = useRef(trip.detection.activeTripId);
  activeTripIdRef.current = trip.detection.activeTripId;
  const myUnitIdRef = useRef(gps.unitId);
  myUnitIdRef.current = gps.unitId;

  // Local mirror of the trip's paused/active status, driven by the same
  // pause/resume calls this subscription already makes — flips the badge
  // instantly without waiting for the next /trip/current poll. Reset when
  // the active trip changes (a fresh trip is never paused).
  //
  // This is OR'd with the server-truth `trip.currentTrip.status` below (now
  // that GET /trip/current's status filter includes 'paused' — see nav.ts —
  // a trip adopted on mount/foreground can itself report 'paused') so the
  // badge is correct even when this tab never fired the pause/resume call
  // itself (e.g. the app was reopened while already paused at the station).
  const [isTripPausedLocal, setIsTripPausedLocal] = useState(false);
  useEffect(() => { setIsTripPausedLocal(false); }, [trip.detection.activeTripId]);
  // Also reset if the server-truth trip has closed out from under us (e.g. the
  // stale reaper fired on this paused trip) — otherwise a local-true set by an
  // earlier pause could outlive the trip it referred to and leave the badge
  // stuck on for a trip that's actually completed/cancelled.
  useEffect(() => {
    if (trip.currentTrip?.status === 'completed' || trip.currentTrip?.status === 'cancelled') {
      setIsTripPausedLocal(false);
    }
  }, [trip.currentTrip?.status]);
  const isTripPaused = isTripPausedLocal || trip.currentTrip?.status === 'paused';

  // Transient generic zone-entry notice (alert / patrol_required zones).
  // Auto-dismissed a few seconds after each enter event, matching the
  // HudArrivedBanner/HudOverSpeedBanner auto-dismiss pattern in NavigationPage.
  const [zoneAlert, setZoneAlert] = useState<ZoneAlertResult | null>(null);
  const zoneAlertHideTimerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (zoneAlertHideTimerRef.current != null) window.clearTimeout(zoneAlertHideTimerRef.current);
  }, []);

  useEffect(() => {
    const unsubGeofence = subscribe('geofence_alert', (msg: any) => {
      const data = msg.data || msg;
      const payload: GeofenceAlertPayload = {
        unitId: data.unit_id,
        zoneId: data.zone_id,
        zoneType: data.zone_type,
        eventType: data.event_type,
      };

      // Ignore broadcasts for other units — see comment above.
      const myUnitId = myUnitIdRef.current;
      if (!myUnitId || payload.unitId !== myUnitId) return;

      const zoneAlertResult = zoneEntryAlert(payload);
      if (zoneAlertResult) {
        setZoneAlert(zoneAlertResult);
        if (zoneAlertHideTimerRef.current != null) window.clearTimeout(zoneAlertHideTimerRef.current);
        zoneAlertHideTimerRef.current = window.setTimeout(() => setZoneAlert(null), 5000);
      }

      const action = stationPauseAction(payload);
      if (!action) return;

      const tripId = activeTripIdRef.current;
      if (!tripId) return;

      apiFetch(`/nav/trip/${tripId}/${action}`, { method: 'PUT' })
        .then(() => setIsTripPausedLocal(action === 'pause'))
        .catch((err) => {
          console.error(`[NavTripContext] station geofence ${action} failed:`, err);
        });
    });

    return () => { unsubGeofence(); };
  }, [subscribe]);

  // ── Weather-aware hazard polling ──────────────────────────────────────────
  // Low-frequency poll (every 10 minutes, NOT per-GPS-tick) of the officer's
  // current-position weather via the existing fetchWeather() util — same
  // client/util as WeatherWidget.tsx, but called WITH this provider's own
  // live GPS fix (gps.latitude/gps.longitude, already tracked above for trip
  // detection) rather than fetchWeather's own no-arg one-shot geolocation
  // prompt + hardcoded SLC fallback. Falling back to that no-arg behavior only
  // when a GPS fix isn't yet available avoids silently reporting weather for
  // the wrong place while a unit patrols far from SLC. Read the coords via a
  // ref (not an effect dependency) so the polling interval isn't torn down
  // and recreated on every GPS tick — matches the interval-with-cleanup
  // pattern used by useCachedBasemap.ts and the activeTripIdRef pattern above.
  const [weatherHazard, setWeatherHazard] = useState<string | null>(null);
  const gpsPositionRef = useRef({ lat: gps.latitude, lng: gps.longitude });
  gpsPositionRef.current = { lat: gps.latitude, lng: gps.longitude };
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const { lat, lng } = gpsPositionRef.current;
        const w = lat != null && lng != null ? await fetchWeather(lat, lng) : await fetchWeather();
        if (cancelled || !w) return;
        setWeatherHazard(weatherHazardLabel({ conditionCode: w.conditionCode, windSpeed: w.windSpeed }));
      } catch (err) {
        console.error('[NavTripContext] weather poll failed:', err);
      }
    };
    poll();
    const interval = setInterval(poll, 10 * 60 * 1000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  return (
    <NavTripContext.Provider value={{ ...trip, gps, guidance, loadUnitRoute, isTripPaused, zoneAlert, weatherHazard }}>
      {children}
    </NavTripContext.Provider>
  );
}

/** Consume the app-wide trip detector. Returns null if no provider is mounted
 *  (e.g. a component rendered in isolation) so callers can degrade gracefully
 *  rather than crash a CAD surface. */
export function useNavTrip(): NavTripContextValue | null {
  return useContext(NavTripContext);
}
