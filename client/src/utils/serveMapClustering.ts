export interface ClusterableItem {
  id: number;
  lng: number;
  lat: number;
  priority: string;
  status: string;
}

export interface MapCluster {
  key: string;
  lng: number;
  lat: number;
  count: number;
  dominantPriority: string;
  itemIds: number[];
}

const PRIORITY_SEVERITY: Record<string, number> = {
  urgent: 3,
  rush: 2,
  normal: 1,
  routine: 0,
};

export function gridCellSizeForZoom(zoom: number): number {
  const base = 64; // degrees at zoom 0
  const size = base / Math.pow(2, zoom);
  // Apply the minimum cell floor at zoom ≥ 14 (where size ≈ 0.0039°).
  // The previous threshold of zoom >= 20 yielded size ≈ 0.000061°, which is
  // SMALLER than the 0.002 floor — so zooming from 19 to 20 would increase
  // cell size (0.000122 → 0.002), causing pins that were distinct at z19 to
  // merge into a cluster at z20. Apply the floor wherever the raw formula
  // would produce a cell smaller than 0.002°.
  // Floor prevents floating-point underflow at extreme zoom (≥22).
  // 0.0001° ≈ 11 m — small enough that natural zoom-based sizing drives
  // clustering at all practical zoom levels (zoom 16 → ~0.001°).
  return Math.max(size, 0.0001);
}

/**
 * Cache of `<sorted itemIds>` -> the centroid computed the FIRST time that
 * exact member set clustered together. Passed by callers (as a ref that
 * outlives re-renders) so a cluster marker's position is set once and never
 * re-averaged as the user zooms — without this, the same set of jobs can
 * still land in a different grid cell at a different zoom (grid cell size
 * shrinks with zoom), and re-averaging would visibly move the marker even
 * though its membership hadn't changed. Keying on membership (not the grid
 * cell key, which is zoom-dependent) is what makes the freeze zoom-stable:
 * the same jobs always resolve to the same cached centroid regardless of
 * which cell they currently hash into.
 */
export type ClusterPositionCache = Map<string, { lng: number; lat: number }>;

function membershipKey(itemIds: number[]): string {
  return [...itemIds].sort((a, b) => a - b).join(',');
}

export function clusterByGrid(
  items: ClusterableItem[],
  zoom: number,
  positionCache?: ClusterPositionCache,
): MapCluster[] {
  if (items.length === 0) return [];
  const cellSize = gridCellSizeForZoom(zoom);
  const buckets = new Map<string, ClusterableItem[]>();

  for (const item of items) {
    const cellX = Math.floor(item.lng / cellSize);
    const cellY = Math.floor(item.lat / cellSize);
    const key = `${cellX}:${cellY}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }

  const clusters: MapCluster[] = [];
  for (const [key, bucketItems] of buckets) {
    const itemIds = bucketItems.map((it) => it.id);
    const dominantPriority = bucketItems.reduce((best, it) =>
      (PRIORITY_SEVERITY[it.priority] ?? 0) > (PRIORITY_SEVERITY[best] ?? 0) ? it.priority : best,
      bucketItems[0].priority,
    );

    let lng: number;
    let lat: number;
    const cacheKey = membershipKey(itemIds);
    const cached = positionCache?.get(cacheKey);
    if (cached) {
      lng = cached.lng;
      lat = cached.lat;
    } else {
      lng = bucketItems.reduce((sum, it) => sum + it.lng, 0) / bucketItems.length;
      lat = bucketItems.reduce((sum, it) => sum + it.lat, 0) / bucketItems.length;
      positionCache?.set(cacheKey, { lng, lat });
    }

    clusters.push({
      key,
      lng,
      lat,
      count: bucketItems.length,
      dominantPriority,
      itemIds,
    });
  }
  return clusters;
}
