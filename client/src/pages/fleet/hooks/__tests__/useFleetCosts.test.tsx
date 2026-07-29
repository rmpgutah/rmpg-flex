import { useCallback, useRef } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useFleetCosts } from '../useFleetCosts';
import { useVehicleDetail } from '../useVehicleDetail';
import type { DetailTab } from '../../FleetDetailPanel';
import type { FleetMaintenance } from '../../../../types';

vi.mock('../../../../hooks/useApi', () => ({ apiFetch: vi.fn() }));

// addToast MUST be hoisted and stable. An inline `useToast: () => ({ addToast:
// vi.fn() })` mints a fresh function every render, which re-mints every
// useCallback that depends on it and turns any deps-driven fetch into an
// unbounded refetch loop — 638 /loans calls were measured in a single test body
// here while the test still passed. The real ToastProvider.addToast is
// useCallback([]), so an unstable one makes the harness lie about production.
const addToast = vi.fn();
vi.mock('../../../../components/ToastProvider', () => ({ useToast: () => ({ addToast }) }));

import { apiFetch } from '../../../../hooks/useApi';

// Module-level, so it is referentially stable across renders for the same reason.
const MAINTENANCE: FleetMaintenance[] = [];

/** Every request `fetchCosts` issues, as exact URLs. Exact equality matters:
 *  `stringContaining('/fleet/1/fuel')` also matches `/fleet/1/fuel-efficiency`
 *  and has previously passed against both a bug and its fix. */
const costUrls = (id: number) => [
  `/fleet/${id}/loans`,
  `/fleet/${id}/insurance`,
  `/fleet/${id}/accessories`,
  `/fleet/${id}/utilities`,
  `/fleet/${id}/other-costs`,
  `/fleet/${id}/cost-budgets`,
  `/fleet/${id}/monthly-cost-averages`,
];

const urls = () => vi.mocked(apiFetch).mock.calls.map((c) => String(c[0]));
const countOf = (url: string) => urls().filter((u) => u === url).length;

beforeEach(() => {
  localStorage.clear();
  addToast.mockReset();
  vi.mocked(apiFetch).mockReset();
  vi.mocked(apiFetch).mockImplementation((path: string) => {
    const p = String(path);
    if (/^\/fleet\/\d+$/.test(p)) return Promise.resolve({ id: 1 }) as never;
    if (p.includes('/fuel?')) return Promise.resolve({ data: [], summary: null }) as never;
    if (p.includes('/monthly-cost-averages')) return Promise.resolve({}) as never;
    if (p.includes('/cost-per-mile')) return Promise.resolve({ total_miles: 100 }) as never;
    return Promise.resolve([]) as never;
  });
});

/** Mirrors FleetPage's wiring: useVehicleDetail owns the one skip-guarded
 *  lazy-load effect, useFleetCosts supplies the Costs-tab half through it via a
 *  ref bridge (the hooks are mutually dependent — useFleetCosts needs
 *  fuelSummary/maintenance, useVehicleDetail needs the lazy-load callback). */
function useFleetPageHarness(selectedId: string | number | null) {
  const costsLazyLoadRef = useRef<(tab: string, id: string | number) => void>(() => {});
  const resetCostsRef = useRef<() => void>(() => {});
  const onLazyLoad = useCallback(
    (tab: DetailTab, id: string | number) => costsLazyLoadRef.current(tab, id),
    [],
  );
  const onCostsReset = useCallback(() => resetCostsRef.current(), []);
  const detail = useVehicleDetail(selectedId, onCostsReset, onLazyLoad);
  const costs = useFleetCosts(selectedId, detail.fuelSummary, detail.maintenance);
  costsLazyLoadRef.current = costs.onCostsLazyLoad;
  resetCostsRef.current = costs.resetCosts;
  return { ...detail, ...costs };
}

/** Let every settled promise and the follow-on renders they cause flush, so a
 *  duplicate round triggered by a re-minted callback has time to appear. */
const settle = async () => {
  for (let i = 0; i < 6; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  }
};

describe('useFleetCosts', () => {
  it('loads all five cost categories when the costs tab opens', async () => {
    localStorage.setItem('rmpg_fleet_tab', JSON.stringify('costs'));
    renderHook(() => useFleetPageHarness(1));
    await waitFor(() => {
      for (const u of costUrls(1)) expect(urls()).toContain(u);
    });
  });

  // ── The assertion class this suite was missing: HOW MANY requests. ──
  it('issues each cost endpoint EXACTLY ONCE when the Costs tab opens', async () => {
    // Regression guard for B1. When useFleetCosts owned its own effect keyed
    // [selectedId, activeTab, fetchCosts], fetchCosts's identity chained through
    // costPerMile (which fetchCosts itself loads) and fuelSummary (which
    // useVehicleDetail's costs branch loads) — both settle after the first
    // round, so each re-minted fetchCosts and re-fired the effect. 21 requests
    // where pre-Phase-2 code sent 7.
    localStorage.setItem('rmpg_fleet_tab', JSON.stringify('costs'));
    const { result } = renderHook(() => useFleetPageHarness(1));
    await waitFor(() => expect(result.current.costSummary).not.toBeNull());
    await settle();

    for (const u of costUrls(1)) expect(countOf(u)).toBe(1);
    // The fuel half of the original Costs-tab fetch is likewise fired once.
    expect(countOf('/fleet/1/fuel?per_page=10000')).toBe(1);
  });

  it('issues ZERO cost requests when the vehicle changes while on the Costs tab', async () => {
    // Regression guard for B2. The vehicle switch resets the tab to 'overview'
    // and sets skipNextLazyLoadRef; pre-Phase-2 that suppressed the costs branch
    // entirely, so a switch cost nothing. An effect living outside that guard
    // cannot see the flag and fires a full round against the new vehicle.
    localStorage.setItem('rmpg_fleet_tab', JSON.stringify('costs'));
    const { result, rerender } = renderHook(
      ({ id }) => useFleetPageHarness(id),
      { initialProps: { id: 1 as string | number | null } },
    );
    await waitFor(() => expect(result.current.costSummary).not.toBeNull());
    await settle();

    vi.mocked(apiFetch).mockClear();
    rerender({ id: 2 });
    await waitFor(() => expect(urls()).toContain('/fleet/2'));
    await settle();

    for (const u of costUrls(2)) expect(countOf(u)).toBe(0);
    // ...and nothing was re-requested for the vehicle we navigated away from.
    for (const u of costUrls(1)) expect(countOf(u)).toBe(0);
    expect(result.current.activeTab).toBe('overview');
  });

  it('does not fetch costs while a different tab is active', async () => {
    renderHook(() => useFleetPageHarness(1));
    await settle();
    expect(countOf('/fleet/1/loans')).toBe(0);
  });

  it('normalizes a recurring annual premium to a monthly commitment', async () => {
    vi.mocked(apiFetch).mockImplementation((path: string) => {
      const p = String(path);
      if (p.endsWith('/insurance')) {
        return Promise.resolve([{ id: 1, premium: 1200, premium_frequency: 'annual' }]) as never;
      }
      if (/^\/fleet\/\d+$/.test(p)) return Promise.resolve({ id: 1 }) as never;
      if (p.includes('/fuel?')) return Promise.resolve({ data: [], summary: null }) as never;
      return Promise.resolve([]) as never;
    });
    localStorage.setItem('rmpg_fleet_tab', JSON.stringify('costs'));
    const { result } = renderHook(() => useFleetPageHarness(1));
    await waitFor(() => expect(result.current.costSummary).not.toBeNull());
    expect(result.current.costSummary!.monthly_commitment!.insurance).toBe(100);
  });

  it('excludes one-time costs from the monthly run-rate', async () => {
    vi.mocked(apiFetch).mockImplementation((path: string) => {
      const p = String(path);
      if (p.endsWith('/other-costs')) {
        return Promise.resolve([{ id: 1, amount: 500, frequency: 'one_time', status: 'active' }]) as never;
      }
      if (/^\/fleet\/\d+$/.test(p)) return Promise.resolve({ id: 1 }) as never;
      if (p.includes('/fuel?')) return Promise.resolve({ data: [], summary: null }) as never;
      return Promise.resolve([]) as never;
    });
    localStorage.setItem('rmpg_fleet_tab', JSON.stringify('costs'));
    const { result } = renderHook(() => useFleetPageHarness(1));
    await waitFor(() => expect(result.current.costSummary).not.toBeNull());
    expect(result.current.costSummary!.monthly_commitment!.other).toBe(0);
  });

  it('resetCosts clears every category', async () => {
    localStorage.setItem('rmpg_fleet_tab', JSON.stringify('costs'));
    const { result } = renderHook(() => useFleetCosts(1, null, MAINTENANCE));
    act(() => result.current.onCostsLazyLoad('costs', 1));
    await waitFor(() => expect(result.current.costSummary).not.toBeNull());
    act(() => result.current.resetCosts());
    expect(result.current.loans).toEqual([]);
    expect(result.current.costSummary).toBeNull();
  });

  it('onCostsLazyLoad ignores tabs other than costs', async () => {
    const { result } = renderHook(() => useFleetCosts(1, null, MAINTENANCE));
    act(() => result.current.onCostsLazyLoad('overview', 1));
    await settle();
    expect(countOf('/fleet/1/loans')).toBe(0);
  });
});
