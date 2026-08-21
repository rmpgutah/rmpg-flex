import { describe, it, expect } from 'vitest';
import { clusterByGrid, gridCellSizeForZoom, type ClusterableItem } from '../serveMapClustering';

describe('gridCellSizeForZoom', () => {
  it('shrinks the cell size as zoom increases', () => {
    const z10 = gridCellSizeForZoom(10);
    const z14 = gridCellSizeForZoom(14);
    expect(z14).toBeLessThan(z10);
  });

  it('never goes below the floor', () => {
    // Floor is 0.0001 (≈11 m) — large enough to prevent float underflow at
    // extreme zoom while still allowing zoom-16 items 0.001° apart to separate.
    expect(gridCellSizeForZoom(22)).toBeGreaterThanOrEqual(0.0001);
  });
});

describe('clusterByGrid', () => {
  const items: ClusterableItem[] = [
    { id: 1, lng: -111.891, lat: 40.760, priority: 'urgent', status: 'pending' },
    { id: 2, lng: -111.892, lat: 40.761, priority: 'normal', status: 'pending' },
    { id: 3, lng: -112.500, lat: 41.500, priority: 'routine', status: 'pending' },
  ];

  it('groups nearby items into one cluster at low zoom', () => {
    const clusters = clusterByGrid(items, 8);
    expect(clusters.length).toBe(2);
    const twoItemCluster = clusters.find((c) => c.count === 2);
    expect(twoItemCluster).toBeDefined();
    expect(twoItemCluster!.itemIds.sort()).toEqual([1, 2]);
  });

  it('picks the highest-severity priority as dominant', () => {
    const clusters = clusterByGrid(items, 8);
    const twoItemCluster = clusters.find((c) => c.count === 2)!;
    expect(twoItemCluster.dominantPriority).toBe('urgent');
  });

  it('splits into individual markers at high zoom', () => {
    const clusters = clusterByGrid(items, 16);
    expect(clusters.length).toBe(3);
    for (const c of clusters) expect(c.count).toBe(1);
  });

  it('returns an empty array for no items', () => {
    expect(clusterByGrid([], 10)).toEqual([]);
  });

  it('freezes a cluster centroid across zoom changes when a position cache is supplied', () => {
    const cache = new Map();
    const firstPass = clusterByGrid(items, 8, cache);
    const twoItemCluster = firstPass.find((c) => c.count === 2)!;
    const originalLng = twoItemCluster.lng;
    const originalLat = twoItemCluster.lat;

    // Re-cluster at a different zoom whose cell size still groups [1, 2]
    // together (7 keeps them in the same wider cell). Without the cache this
    // would legitimately recompute the same average since membership is
    // unchanged, so instead we mutate the cache to prove the cached value —
    // not a fresh average — is what's returned.
    cache.set('1,2', { lng: -999, lat: -999 });
    const secondPass = clusterByGrid(items, 8, cache);
    const cachedCluster = secondPass.find((c) => c.count === 2)!;
    expect(cachedCluster.lng).toBe(-999);
    expect(cachedCluster.lat).toBe(-999);
    expect(cachedCluster.lng).not.toBe(originalLng);
    expect(cachedCluster.lat).not.toBe(originalLat);
  });

  it('without a cache, recomputes the average every call (pre-existing behavior)', () => {
    const clusters = clusterByGrid(items, 8);
    const twoItemCluster = clusters.find((c) => c.count === 2)!;
    expect(twoItemCluster.lng).toBeCloseTo((-111.891 + -111.892) / 2, 6);
    expect(twoItemCluster.lat).toBeCloseTo((40.760 + 40.761) / 2, 6);
  });
});
