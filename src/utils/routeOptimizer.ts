// ============================================================
// Route optimizer — nearest-neighbor + 2-opt multi-stop ordering
// ============================================================
// Pure math (no D1/fetch) backing /api/dispatch/routing/optimize.
// Priority weighting is an objective-function term, not a hard sort:
// the cost of a tour is Σ (cumulative distance to stop × urgency),
// so a P1 pulls itself earlier in the order only when the detour is
// worth it. With weighting off every urgency is 1 and the objective
// degenerates to plain arrival-distance (≈ shortest path ordering).

export interface LatLng {
  lat: number;
  lng: number;
}

export interface OptimizableStop {
  id: number | string;
  latitude: number;
  longitude: number;
  /** 'P1'..'P4' — anything else counts as routine. */
  priority?: string | null;
}

export interface OptimizedRoute<T extends OptimizableStop> {
  ordered: T[];
  /** Driving-line miles for each leg: origin→s1, s1→s2, … */
  legsMiles: number[];
  totalMiles: number;
}

const EARTH_RADIUS_MILES = 3958.7613;

export function haversineMiles(a: LatLng, b: LatLng): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_MILES * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

// Urgency multipliers: higher = arriving late costs more.
const URGENCY: Record<string, number> = { P1: 4, P2: 2, P3: 1, P4: 0.7 };

function urgency(stop: OptimizableStop, weighted: boolean): number {
  if (!weighted) return 1;
  return URGENCY[String(stop.priority || '').toUpperCase()] ?? 1;
}

function toLatLng(s: OptimizableStop): LatLng {
  return { lat: s.latitude, lng: s.longitude };
}

/** Tour objective: Σ cumulativeDistance_i × urgency_i. Lower is better. */
function tourCost(origin: LatLng, stops: OptimizableStop[], weighted: boolean): number {
  let cum = 0;
  let cost = 0;
  let prev = origin;
  for (const s of stops) {
    cum += haversineMiles(prev, toLatLng(s));
    cost += cum * urgency(s, weighted);
    prev = toLatLng(s);
  }
  return cost;
}

function nearestNeighborOrder<T extends OptimizableStop>(
  origin: LatLng,
  stops: T[],
  weighted: boolean,
): T[] {
  const remaining = [...stops];
  const ordered: T[] = [];
  let prev = origin;
  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      // Greedy pick: distance discounted by urgency (a P1 "looks closer").
      const score = haversineMiles(prev, toLatLng(remaining[i])) / urgency(remaining[i], weighted);
      if (score < bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    const next = remaining.splice(bestIdx, 1)[0];
    ordered.push(next);
    prev = toLatLng(next);
  }
  return ordered;
}

/** Classic 2-opt segment reversal against the weighted tour objective. */
function twoOptImprove<T extends OptimizableStop>(
  origin: LatLng,
  stops: T[],
  weighted: boolean,
  maxPasses = 20,
): T[] {
  if (stops.length < 3) return stops;
  let best = [...stops];
  let bestCost = tourCost(origin, best, weighted);
  for (let pass = 0; pass < maxPasses; pass++) {
    let improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const candidate = [
          ...best.slice(0, i),
          ...best.slice(i, j + 1).reverse(),
          ...best.slice(j + 1),
        ];
        const cost = tourCost(origin, candidate, weighted);
        if (cost < bestCost - 1e-9) {
          best = candidate;
          bestCost = cost;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return best;
}

export function optimizeStops<T extends OptimizableStop>(
  origin: LatLng,
  stops: T[],
  priorityWeighted: boolean,
): OptimizedRoute<T> {
  if (stops.length === 0) return { ordered: [], legsMiles: [], totalMiles: 0 };
  const ordered = twoOptImprove(origin, nearestNeighborOrder(origin, stops, priorityWeighted), priorityWeighted);
  const legsMiles: number[] = [];
  let prev = origin;
  for (const s of ordered) {
    legsMiles.push(haversineMiles(prev, toLatLng(s)));
    prev = toLatLng(s);
  }
  const totalMiles = legsMiles.reduce((a, b) => a + b, 0);
  return { ordered, legsMiles, totalMiles };
}

/** ~28 mph urban average + 2 min handling per stop. Straight-line miles in,
 *  wall-clock minutes out — the client swaps in Mapbox traffic ETA when the
 *  Directions proxy responds. */
export function estimateDriveMinutes(totalMiles: number, stopCount: number): number {
  if (!Number.isFinite(totalMiles) || totalMiles <= 0) return Math.max(0, stopCount * 2);
  return Math.round((totalMiles / 28) * 60 + stopCount * 2);
}
