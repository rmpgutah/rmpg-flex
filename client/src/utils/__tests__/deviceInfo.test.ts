import { renderHook, act } from '@testing-library/react';
import { test, expect, afterEach } from 'vitest';
import { getDeviceInfo, useDeviceInfo } from '../deviceInfo';

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
}

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
}

afterEach(() => {
  setViewport(1024, 768);
  setOnline(true);
});

test('getDeviceInfo reports the current viewport', () => {
  setViewport(1235, 727);
  expect(getDeviceInfo().viewport).toBe('1235×727');
});

test('useDeviceInfo updates the viewport on resize', () => {
  // Reproduces the original bug: the window is sized to 0×0 at mount (Electron
  // / restored window) and only gets real dimensions afterwards.
  setViewport(0, 0);
  const { result } = renderHook(() => useDeviceInfo());
  expect(result.current.viewport).toBe('0×0');

  act(() => {
    setViewport(1280, 800);
    window.dispatchEvent(new Event('resize'));
  });

  expect(result.current.viewport).toBe('1280×800');
});

test('useDeviceInfo reflects going offline', () => {
  setOnline(true);
  const { result } = renderHook(() => useDeviceInfo());
  expect(result.current.online).toBe(true);

  act(() => {
    setOnline(false);
    window.dispatchEvent(new Event('offline'));
  });

  expect(result.current.online).toBe(false);
});

test('useDeviceInfo reflects coming back online', () => {
  setOnline(false);
  const { result } = renderHook(() => useDeviceInfo());
  expect(result.current.online).toBe(false);

  act(() => {
    setOnline(true);
    window.dispatchEvent(new Event('online'));
  });

  expect(result.current.online).toBe(true);
});

test('removes its listeners on unmount', () => {
  const { result, unmount } = renderHook(() => useDeviceInfo());
  unmount();

  // A resize after unmount must not attempt a state update on a dead hook.
  act(() => {
    setViewport(640, 480);
    window.dispatchEvent(new Event('resize'));
  });

  expect(result.current.viewport).not.toBe('640×480');
});
