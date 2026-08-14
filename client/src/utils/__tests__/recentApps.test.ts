import { describe, it, expect, beforeEach } from 'vitest';
import { recordAppOpen, getRecentApps } from '../recentApps';

describe('recentApps', () => {
  beforeEach(() => localStorage.clear());

  it('returns empty array initially', () => {
    expect(getRecentApps('dispatch')).toEqual([]);
  });

  it('stores and retrieves a recent entry', () => {
    recordAppOpen('dispatch', { label: 'Dispatch', route: '/dispatch', ts: 1 });
    expect(getRecentApps('dispatch')).toHaveLength(1);
    expect(getRecentApps('dispatch')[0].label).toBe('Dispatch');
  });

  it('deduplicates by route, putting the new one first', () => {
    recordAppOpen('dispatch', { label: 'Dispatch', route: '/dispatch', ts: 1 });
    recordAppOpen('dispatch', { label: 'Dispatch', route: '/dispatch', ts: 2 });
    expect(getRecentApps('dispatch')).toHaveLength(1);
  });

  it('caps at 3 entries, most recent first', () => {
    for (let i = 0; i < 5; i++)
      recordAppOpen('dispatch', { label: `Item ${i}`, route: `/r${i}`, ts: i });
    expect(getRecentApps('dispatch')).toHaveLength(3);
    expect(getRecentApps('dispatch')[0].label).toBe('Item 4');
  });

  it('keeps separate lists per appKey', () => {
    recordAppOpen('dispatch', { label: 'D', route: '/d', ts: 1 });
    recordAppOpen('map',      { label: 'M', route: '/m', ts: 2 });
    expect(getRecentApps('dispatch')).toHaveLength(1);
    expect(getRecentApps('map')).toHaveLength(1);
  });
});
