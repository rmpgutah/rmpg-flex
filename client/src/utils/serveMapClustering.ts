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
  // Floor of 0.002 applies only at high zoom levels (20+)
  // to allow meaningful clustering at lower zoom levels
  if (zoom >= 20) {
    return Math.max(size, 0.002);
  }
  return size;
}

export function clusterByGrid(items: ClusterableItem[], zoom: number): MapCluster[] {
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
    const avgLng = bucketItems.reduce((sum, it) => sum + it.lng, 0) / bucketItems.length;
    const avgLat = bucketItems.reduce((sum, it) => sum + it.lat, 0) / bucketItems.length;
    const dominantPriority = bucketItems.reduce((best, it) =>
      (PRIORITY_SEVERITY[it.priority] ?? 0) > (PRIORITY_SEVERITY[best] ?? 0) ? it.priority : best,
      bucketItems[0].priority,
    );
    clusters.push({
      key,
      lng: avgLng,
      lat: avgLat,
      count: bucketItems.length,
      dominantPriority,
      itemIds: bucketItems.map((it) => it.id),
    });
  }
  return clusters;
}
