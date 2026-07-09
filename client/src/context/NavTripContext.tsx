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

import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useGpsTracking } from '../hooks/useGpsTracking';
import { useNavTripDetection } from '../hooks/useNavTripDetection';
import { useNavGuidanceEngine, type NavGuidanceEngine } from '../hooks/useNavGuidanceEngine';
import { useWebSocket } from './WebSocketContext';
import { apiFetch } from '../hooks/useApi';
import { stationPauseAction, type GeofenceAlertPayload } from './stationPauseLogic';

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

      const action = stationPauseAction(payload);
      if (!action) return;

      const tripId = activeTripIdRef.current;
      if (!tripId) return;

      apiFetch(`/nav/trip/${tripId}/${action}`, { method: 'PUT' }).catch((err) => {
        console.error(`[NavTripContext] station geofence ${action} failed:`, err);
      });
    });

    return () => { unsubGeofence(); };
  }, [subscribe]);

  return (
    <NavTripContext.Provider value={{ ...trip, gps, guidance }}>
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
