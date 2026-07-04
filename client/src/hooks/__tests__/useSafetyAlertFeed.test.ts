import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSafetyAlertFeed } from '../useSafetyAlertFeed';

vi.mock('../usePanicAlerts', () => ({
  usePanicAlerts: () => ({
    alerts: [{ id: 1, user_name: 'Officer A', status: 'active', created_at: '2026-07-04T10:00:00Z' }],
    loading: false,
  }),
}));
vi.mock('../useWelfareAlerts', () => ({
  useWelfareAlerts: () => ({
    alerts: [{ user_id: 2, officer_name: 'Officer B', status: 'emergency' }],
    loading: false,
  }),
}));
vi.mock('../usePremiseAlertsList', () => ({
  usePremiseAlertsList: () => ({
    alerts: [{ id: 3, address: '123 Main St', alert_level: 'critical', title: 'Hazmat', alert_type: 'hazmat' }],
    loading: false,
  }),
}));

describe('useSafetyAlertFeed', () => {
  it('merges all 3 sources into one array sorted panic > welfare > premise', () => {
    const { result } = renderHook(() => useSafetyAlertFeed());
    expect(result.current.items).toHaveLength(3);
    expect(result.current.items.map(i => i.type)).toEqual(['panic', 'welfare', 'premise']);
  });

  it('exposes a total count for the collapsed badge', () => {
    const { result } = renderHook(() => useSafetyAlertFeed());
    expect(result.current.count).toBe(3);
  });
});
