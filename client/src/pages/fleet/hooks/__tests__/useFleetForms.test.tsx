import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useFleetForms } from '../useFleetForms';

vi.mock('../../../../hooks/useApi', () => ({ apiFetch: vi.fn() }));
vi.mock('../../../../components/ToastProvider', () => ({ useToast: () => ({ addToast: vi.fn() }) }));

import { apiFetch } from '../../../../hooks/useApi';

// `useFormDraft` also calls apiFetch on mount to look for a D1-mirrored draft
// (`/form-drafts/<storageKey>`). Those are not fleet writes — filter them out.
const fleetCalls = () =>
  vi.mocked(apiFetch).mock.calls.filter((c) => String(c[0]).startsWith('/fleet'));

const noop = () => {};
const args = () => ({
  selectedId: 1 as string | number | null,
  onVehicleSaved: noop, onMaintenanceSaved: noop,
  onFuelSaved: noop, onInspectionSaved: noop,
});

beforeEach(() => {
  localStorage.clear();
  vi.mocked(apiFetch).mockReset();
  vi.mocked(apiFetch).mockResolvedValue({} as never);
});

describe('useFleetForms', () => {
  it('rejects a vehicle save with a blank vehicle number', async () => {
    const { result } = renderHook(() => useFleetForms(args()));
    act(() => result.current.setModal('new_vehicle'));
    await act(async () => { await result.current.handleSaveVehicle(); });
    expect(fleetCalls()).toHaveLength(0);
  });

  it('POSTs a new vehicle and PUTs an edit', async () => {
    const { result } = renderHook(() => useFleetForms(args()));
    act(() => {
      result.current.setModal('new_vehicle');
      result.current.setVehicleForm({ ...result.current.vehicleForm, vehicle_number: 'PS-D19' });
    });
    await act(async () => { await result.current.handleSaveVehicle(); });
    expect(fleetCalls()[0][0]).toBe('/fleet');
    expect(fleetCalls()[0][1]).toMatchObject({ method: 'POST' });

    vi.mocked(apiFetch).mockClear();
    act(() => {
      result.current.setModal('edit_vehicle');
      result.current.setVehicleForm({ ...result.current.vehicleForm, vehicle_number: 'PS-D19' });
    });
    await act(async () => { await result.current.handleSaveVehicle(); });
    expect(fleetCalls()[0][0]).toBe('/fleet/1');
    expect(fleetCalls()[0][1]).toMatchObject({ method: 'PUT' });
  });

  it('calls onFuelSaved with whether the odometer changed', async () => {
    const onFuelSaved = vi.fn();
    const { result } = renderHook(() => useFleetForms({ ...args(), onFuelSaved }));
    act(() => {
      result.current.setModal('log_fuel');
      result.current.setFuelForm({ ...result.current.fuelForm, fuel_date: '2026-07-26T10:00', gallons: '12', odometer_reading: '5000' });
    });
    await act(async () => { await result.current.handleSaveFuel(); });
    await waitFor(() => expect(onFuelSaved).toHaveBeenCalledWith(true));
  });

  it('activeSaveHandler dispatches by modal mode', async () => {
    const { result } = renderHook(() => useFleetForms(args()));
    act(() => {
      result.current.setModal('new_vehicle');
      result.current.setVehicleForm({ ...result.current.vehicleForm, vehicle_number: 'PS-D20' });
    });
    await act(async () => { result.current.activeSaveHandler(); });
    await waitFor(() => expect(fleetCalls().length).toBeGreaterThan(0));
  });

  it('scopes each draft storage key to the record being edited', () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useFleetForms(args()));
      act(() => {
        result.current.setEditingFuelId('77');
        result.current.setModal('edit_fuel');
      });
      act(() => {
        result.current.setFuelForm({ ...result.current.fuelForm, station: 'Maverik' });
      });
      // useFormDraft debounces the localStorage write by 500ms.
      act(() => { vi.advanceTimersByTime(600); });
      expect(localStorage.getItem('rmpg_fleet_fuel_log_form_77')).toBeTruthy();
      expect(localStorage.getItem('rmpg_fleet_maintenance_form_new')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('isDirtyAny reflects any of the four drafts', () => {
    const { result } = renderHook(() => useFleetForms(args()));
    expect(result.current.isDirtyAny).toBe(false);
    act(() => { result.current.setModal('new_vehicle'); });
    act(() => {
      result.current.setVehicleForm({ ...result.current.vehicleForm, vehicle_number: 'PS-D21' });
    });
    expect(result.current.isDirtyAny).toBe(true);
    act(() => { result.current.activeCancelHandler(); });
    expect(result.current.isDirtyAny).toBe(false);
  });
});
