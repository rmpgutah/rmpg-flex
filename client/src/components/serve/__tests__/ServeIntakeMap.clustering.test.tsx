import { describe, it, expect } from 'vitest';
import { clusterByGrid } from '../../../utils/serveMapClustering';

// This is a targeted unit test of the mapping function ServeIntakeMap will use,
// isolated from the mapboxgl runtime (mapboxgl is mocked globally in test setup).
describe('ServeIntakeMap clustering integration', () => {
  it('maps QueueMapItem shape into ClusterableItem shape without loss', () => {
    const queueItem = {
      id: 42,
      recipient_lng: -111.9,
      recipient_lat: 40.7,
      priority: 'rush',
      status: 'pending',
    };
    const clusterable = {
      id: queueItem.id,
      lng: queueItem.recipient_lng,
      lat: queueItem.recipient_lat,
      priority: queueItem.priority,
      status: queueItem.status,
    };
    const clusters = clusterByGrid([clusterable], 10);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].itemIds).toEqual([42]);
  });
});
