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

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useGpsTracking } from '../hooks/useGpsTracking';
import { useNavTripDetection } from '../hooks/useNavTripDetection';

type NavTripDetection = ReturnType<typeof useNavTripDetection>;

export interface NavTripContextValue extends NavTripDetection {
  /** The provider's read-only GPS state — exposed so consumers (NavPage) can
   *  render position/speed/unit without spinning up a second tracker. */
  gps: ReturnType<typeof useGpsTracking>;
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

  return (
    <NavTripContext.Provider value={{ ...trip, gps }}>
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
