import { describe, it, expect } from 'vitest';
import { clusterByGrid, gridCellSizeForZoom, type ClusterableItem } from '../serveMapClustering';

describe('gridCellSizeForZoom', () => {
  it('shrinks the cell size as zoom increases', () => {
    const z10 = gridCellSizeForZoom(10);
    const z14 = gridCellSizeForZoom(14);
    expect(z14).toBeLessThan(z10);
  });

  it('never goes below the floor', () => {
    expect(gridCellSizeForZoom(22)).toBeGreaterThanOrEqual(0.002);
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
});
