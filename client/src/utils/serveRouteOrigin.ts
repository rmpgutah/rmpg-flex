// client/src/utils/serveRouteOrigin.ts
//
// Resolves the STARTING LOCATION a serve route is optimized from.
//
// Why this exists: route optimization is only meaningful relative to an origin.
// Without one, ServeRoutePlanner's nearest-neighbor pass scores every candidate
// as distance 0 on the first pick, so the first stop is chosen ARBITRARILY, and
// the officer's real first leg (wherever they are → stop 1) is never counted —
// the planned mileage and ETA both understate the run.
//
// Two holes this closes:
//   1. No live GPS fix (indoors, permission denied, cold start) → previously no
//      origin at all, silently.
//   2. A supervisor planning for ANOTHER officer via the planner's officer
//      dropdown → the browser's GPS is the SUPERVISOR's position, so the route
//      was anchored at the wrong place with nothing on screen to say so.
//
// Policy lives here rather than in the endpoint: the server returns the raw last
// fix plus its age, because "your last fix is 5 hours old" and "no position on
// file" are very different things for an operator to see, and collapsing them
// server-side would make the second indistinguishable from the first.

/** Where an origin came from — surfaced in the UI so the anchor is never implicit. */
export type RouteOriginSource = 'live_gps' | 'last_known';

export interface RouteOrigin {
  lat: number;
  lng: number;
  source: RouteOriginSource;
  /** GPS accuracy in meters, when reported. */
  accuracyM?: number | null;
  /** Age of the fix in minutes. 0 for a live fix. */
  ageMinutes?: number | null;
}

/** Why no origin could be resolved — drives the UI warning, never silent. */
export type RouteOriginProblem =
  | 'no_fix'          // nothing on file for this officer, and no live GPS
  | 'stale_fix';      // a fix exists but is older than the freshness window

export interface RouteOriginResolution {
  origin: RouteOrigin | null;
  problem: RouteOriginProblem | null;
  /** Age of the rejected fix, so the UI can say HOW stale rather than just "stale". */
  rejectedAgeMinutes?: number | null;
}

export interface LastKnownFix {
  found: boolean;
  lat?: number;
  lng?: number;
  accuracy_m?: number | null;
  age_minutes?: number | null;
}

/**
 * How old a stored fix may be and still anchor a route.
 *
 * 120 minutes is a deliberate compromise: long enough that an officer who
 * started their shift and has been indoors on paperwork still gets anchored at
 * a sensible place, short enough that a fix from a previous shift — potentially
 * tens of miles away — never quietly becomes the origin. A stale fix is still
 * REPORTED to the operator; it just isn't used.
 */
export const ORIGIN_MAX_AGE_MINUTES = 120;

export function resolveRouteOrigin(args: {
  /** True when the signed-in user is the officer the route is being planned for. */
  planningForSelf: boolean;
  /** Live browser/Toughbook GPS, if the shared tracker has a fix. */
  liveGps: { lat: number; lng: number; accuracyM?: number | null } | null;
  /** Result of GET /process-server/officer-start/:officerId, if fetched. */
  lastKnown: LastKnownFix | null;
  maxAgeMinutes?: number;
}): RouteOriginResolution {
  const { planningForSelf, liveGps, lastKnown } = args;
  const maxAge = args.maxAgeMinutes ?? ORIGIN_MAX_AGE_MINUTES;

  // A live fix is only the right origin when it IS this officer's position.
  // Using it while planning for someone else is the bug this guard exists for.
  if (planningForSelf && liveGps) {
    return {
      origin: {
        lat: liveGps.lat,
        lng: liveGps.lng,
        source: 'live_gps',
        accuracyM: liveGps.accuracyM ?? null,
        ageMinutes: 0,
      },
      problem: null,
    };
  }

  if (lastKnown?.found && lastKnown.lat != null && lastKnown.lng != null) {
    const age = lastKnown.age_minutes ?? null;
    // A null age means the timestamp was unparseable — treat that as unusable
    // rather than assuming it's fresh. Anchoring on an unknown-age fix is the
    // same failure as anchoring on a stale one, just harder to notice.
    if (age != null && age <= maxAge) {
      return {
        origin: {
          lat: lastKnown.lat,
          lng: lastKnown.lng,
          source: 'last_known',
          accuracyM: lastKnown.accuracy_m ?? null,
          ageMinutes: age,
        },
        problem: null,
      };
    }
    return { origin: null, problem: 'stale_fix', rejectedAgeMinutes: age };
  }

  return { origin: null, problem: 'no_fix', rejectedAgeMinutes: null };
}

/** Compact human label for the origin chip, e.g. "live GPS ±35m" / "last fix 42m ago". */
export function describeOrigin(origin: RouteOrigin): string {
  const acc = origin.accuracyM != null ? ` ±${Math.round(origin.accuracyM)}m` : '';
  if (origin.source === 'live_gps') return `live GPS${acc}`;
  const age = origin.ageMinutes;
  if (age == null) return `last known fix${acc}`;
  if (age < 60) return `last fix ${age}m ago${acc}`;
  const h = Math.floor(age / 60);
  const m = age % 60;
  return `last fix ${h}h${m > 0 ? ` ${m}m` : ''} ago${acc}`;
}

/** Human explanation of why a route has no anchor, for the planner warning line. */
export function describeOriginProblem(res: RouteOriginResolution): string {
  if (res.problem === 'stale_fix') {
    const age = res.rejectedAgeMinutes;
    const when = age == null
      ? 'an unknown time ago'
      : age < 60 ? `${age}m ago` : `${Math.floor(age / 60)}h ago`;
    return `No starting location: this officer's last GPS fix was ${when}, too old to anchor a route. Distances are measured stop-to-stop and exclude the drive to the first stop.`;
  }
  return 'No starting location: no GPS fix available for this officer. Distances are measured stop-to-stop and exclude the drive to the first stop.';
}
