// client/src/components/desktop/DesktopWindowManager.test.tsx
import { useRef } from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { DesktopWindowManagerProvider, useDesktopWindows } from './DesktopWindowManager';

function Harness() {
  const { windows, openWindow, closeWindow, focusWindow, minimizeWindow } = useDesktopWindows();
  const capResults = useRef<boolean[]>([]);
  return (
    <div>
      <button onClick={() => openWindow('/dispatch', 'Dispatch')}>open-dispatch</button>
      <button onClick={() => openWindow('/map', 'Live Map')}>open-map</button>
      <button onClick={() => openWindow('/records', 'Records', { width: 1100, height: 850 })}>open-records-sized</button>
      <button onClick={() => { capResults.current = Array.from({ length: 11 }, (_, i) => openWindow(`/p${i}`, `P${i}`)); }}>open-eleven</button>
      <button onClick={() => windows[0] && closeWindow(windows[0].id)}>close-first</button>
      <button onClick={() => windows[0] && focusWindow(windows[0].id)}>focus-first</button>
      <button onClick={() => windows[0] && minimizeWindow(windows[0].id)}>minimize-first</button>
      <span data-testid="cap-results">{capResults.current.join(',')}</span>
      <ul>{windows.map(w => <li key={w.id}>{w.title}-{w.zIndex}-{w.minimized ? 'min' : 'open'}-{w.width}x{w.height}</li>)}</ul>
    </div>
  );
}

describe('DesktopWindowManager', () => {
  beforeEach(() => sessionStorage.clear());

  it('opens, focuses (raising zIndex), minimizes, and closes windows', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    act(() => screen.getByText('open-dispatch').click());
    act(() => screen.getByText('open-map').click());
    expect(screen.getAllByRole('listitem').length).toBe(2);

    const beforeFocus = screen.getByText(/^Dispatch-/).textContent;
    act(() => screen.getByText('focus-first').click());
    const afterFocus = screen.getByText(/^Dispatch-/).textContent;
    expect(afterFocus).not.toBe(beforeFocus); // zIndex raised

    act(() => screen.getByText('minimize-first').click());
    expect(screen.getByText(/^Dispatch-.*-min-/)).toBeInTheDocument();

    act(() => screen.getByText('close-first').click());
    expect(screen.getAllByRole('listitem').length).toBe(1);
  });

  it('persists open windows to sessionStorage under rmpg_desktop_windows', async () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    act(() => screen.getByText('open-dispatch').click());
    await waitFor(() => {
      const raw = sessionStorage.getItem('rmpg_desktop_windows');
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw!)[0].path).toBe('/dispatch');
    });
  });

  it('opens a window at the requested size, defaulting to 900x640 when no size is given', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    act(() => screen.getByText('open-dispatch').click());
    expect(screen.getByText(/^Dispatch-.*-900x640$/)).toBeInTheDocument();
    act(() => screen.getByText('open-records-sized').click());
    expect(screen.getByText(/^Records-.*-1100x850$/)).toBeInTheDocument();
  });

  it('caps at 10 open windows: the 11th openWindow call returns false and is dropped', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    act(() => screen.getByText('open-eleven').click());
    expect(screen.getAllByRole('listitem').length).toBe(10);
    const results = screen.getByTestId('cap-results').textContent!.split(',').map(v => v === 'true');
    expect(results).toEqual([true, true, true, true, true, true, true, true, true, true, false]);
  });
});
