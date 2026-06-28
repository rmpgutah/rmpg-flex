import { describe, it, expect } from 'vitest';
import { computeEscalation, clusterByProximity, type WeightedEvent, type GeoEvent } from '../src/utils/intelPatterns';

const days = (n: number) => new Date(Date.now() - n * 86400000).toISOString();

describe('computeEscalation', () => {
  it('flags escalating when recent weighted activity is 2x baseline with >=3 events', () => {
    const events: WeightedEvent[] = [
      // last 30d: 2 calls + 1 warrant = 2+2+5 = 9 weighted, 3 events
      { kind: 'call', date: days(5) }, { kind: 'call', date: days(10) }, { kind: 'warrant', date: days(2) },
      // prior 90d: 1 FI = 1 weighted → baseline 1/3 per month
      { kind: 'field_interview', date: days(60) },
    ];
    const e = computeEscalation(events);
    expect(e.trend).toBe('escalating');
    expect(e.recent).toBe(9);
  });

  it('returns quiet for no recent activity', () => {
    const e = computeEscalation([{ kind: 'call', date: days(80) }]);
    expect(e.trend).toBe('quiet');
  });

  it('returns active for steady, non-spiking activity', () => {
    const events: WeightedEvent[] = [
      { kind: 'call', date: days(8) },
      { kind: 'call', date: days(40) }, { kind: 'call', date: days(60) }, { kind: 'call', date: days(85) },
    ];
    expect(computeEscalation(events).trend).toBe('active');
  });

  it('tolerates null dates', () => {
    expect(computeEscalation([{ kind: 'call', date: null }]).trend).toBe('quiet');
  });
});

describe('clusterByProximity', () => {
  it('groups events within the box threshold and ignores sparse ones', () => {
    const events: GeoEvent[] = [
      { id: 1, lat: 40.7600, lng: -111.8900, type: 'burglary' },
      { id: 2, lat: 40.7610, lng: -111.8910, type: 'burglary' },
      { id: 3, lat: 40.7605, lng: -111.8895, type: 'burglary' },
      { id: 4, lat: 40.9000, lng: -111.5000, type: 'burglary' },  // far away
    ];
    const clusters = clusterByProximity(events, 0.003, 3);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].events.map((e) => e.id).sort()).toEqual([1, 2, 3]);
    expect(clusters[0].centroid.lat).toBeCloseTo(40.7605, 3);
  });

  it('separates clusters by type', () => {
    const events: GeoEvent[] = [
      { id: 1, lat: 40.76, lng: -111.89, type: 'burglary' },
      { id: 2, lat: 40.76, lng: -111.89, type: 'theft' },
      { id: 3, lat: 40.76, lng: -111.89, type: 'burglary' },
    ];
    expect(clusterByProximity(events, 0.003, 2)).toHaveLength(1); // only burglary reaches min 2
  });
});
