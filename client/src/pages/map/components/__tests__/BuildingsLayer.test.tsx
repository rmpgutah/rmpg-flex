import { renderHook, act } from '@testing-library/react';
import { vi, test, expect, beforeEach } from 'vitest';

vi.mock('../../../../utils/mapPreferences', () => ({
  loadMapPref: vi.fn().mockReturnValue(false),
  saveMapPref: vi.fn(),
}));

import { useBuildingsLayer } from '../BuildingsLayer';

const addLayer = vi.fn();
const removeLayer = vi.fn();
const getLayer = vi.fn();
const on = vi.fn();
const once = vi.fn();
const isStyleLoaded = vi.fn().mockReturnValue(true);

const mockMap = { addLayer, removeLayer, getLayer, on, once, isStyleLoaded } as any;

beforeEach(() => { vi.clearAllMocks(); getLayer.mockReturnValue(undefined); });

test('exposes enabled state, defaulting to stored pref (false)', () => {
  const { result } = renderHook(() => useBuildingsLayer(mockMap));
  expect(result.current.enabled).toBe(false);
});

test('toggle switches enabled to true', () => {
  const { result } = renderHook(() => useBuildingsLayer(mockMap));
  act(() => { result.current.toggle(); });
  expect(result.current.enabled).toBe(true);
});
