// client/src/components/desktop/DesktopWindowManager.test.tsx
import { useRef } from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { DesktopWindowManagerProvider, useDesktopWindows } from './DesktopWindowManager';

function Harness() {
  const { windows, openWindow, closeWindow, focusWindow, minimizeWindow, updateWindowTitle, minimizeAll, restoreAll, toggleAlwaysOnTop, setWindowOpacity, moveResize } = useDesktopWindows();
  const capResults = useRef<boolean[]>([]);
  const lastMinimizedIds = useRef<string[]>([]);
  return (
    <div>
      <button onClick={() => openWindow('/dispatch', 'Dispatch')}>open-dispatch</button>
      <button onClick={() => openWindow('/map', 'Live Map')}>open-map</button>
      <button onClick={() => openWindow('/records', 'Records', { width: 1100, height: 850 })}>open-records-sized</button>
      <button onClick={() => { capResults.current = Array.from({ length: 11 }, (_, i) => openWindow(`/p${i}`, `P${i}`)); }}>open-eleven</button>
      <button onClick={() => windows[0] && closeWindow(windows[0].id)}>close-first</button>
      <button onClick={() => windows[0] && focusWindow(windows[0].id)}>focus-first</button>
      <button onClick={() => windows[0] && minimizeWindow(windows[0].id)}>minimize-first</button>
      <button onClick={() => windows[0] && updateWindowTitle(windows[0].id, 'Retitled')}>retitle-first</button>
      <button onClick={() => { const ids = minimizeAll(); lastMinimizedIds.current = ids; }}>minimize-all</button>
      <button onClick={() => restoreAll(lastMinimizedIds.current)}>restore-all</button>
      <button onClick={() => windows[0] && toggleAlwaysOnTop(windows[0].id)}>toggle-pin-first</button>
      <button onClick={() => windows[0] && setWindowOpacity(windows[0].id, 2)}>set-opacity-too-high</button>
      <button onClick={() => windows[0] && setWindowOpacity(windows[0].id, 0)}>set-opacity-too-low</button>
      <button onClick={() => windows[0] && setWindowOpacity(windows[0].id, 0.6)}>set-opacity-valid</button>
      <button onClick={() => windows[0] && setWindowOpacity(windows[0].id, 0.1 + 0.2)}>set-opacity-drift</button>
      <button onClick={() => windows[0] && moveResize(windows[0].id, { x: 999, y: 888, width: 777, height: 666 })}>moveresize-first</button>
      <span data-testid="cap-results">{capResults.current.join(',')}</span>
      <span data-testid="first-path">{windows[0]?.path ?? ''}</span>
      <span data-testid="first-pinned">{windows[0]?.alwaysOnTop ? 'pinned' : 'unpinned'}</span>
      <span data-testid="first-opacity">{windows[0]?.opacity ?? ''}</span>
      <span data-testid="first-bounds">{windows[0] ? `${windows[0].x},${windows[0].y},${windows[0].width}x${windows[0].height}` : ''}</span>
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

  it('opens a window at the requested size, defaulting to 1050x800 when no size is given', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    act(() => screen.getByText('open-dispatch').click());
    expect(screen.getByText(/^Dispatch-.*-1050x800$/)).toBeInTheDocument();
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

  it('updateWindowTitle changes only the title, leaving path untouched', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    act(() => screen.getByText('open-dispatch').click());
    expect(screen.getByTestId('first-path').textContent).toBe('/dispatch');

    act(() => screen.getByText('retitle-first').click());
    expect(screen.getByText(/^Retitled-/)).toBeInTheDocument();
    expect(screen.queryByText(/^Dispatch-/)).not.toBeInTheDocument();
    expect(screen.getByTestId('first-path').textContent).toBe('/dispatch');
  });

  it('minimizeAll minimizes only non-minimized windows and returns their ids; restoreAll un-minimizes exactly those', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    act(() => screen.getByText('open-dispatch').click());
    act(() => screen.getByText('open-map').click());
    act(() => screen.getByText('minimize-first').click()); // manually minimize Dispatch first
    act(() => screen.getByText('minimize-all').click());
    // Both should now be minimized (Dispatch was already, Live Map just got minimized)
    expect(screen.getAllByText(/-min-/).length).toBe(2);
    act(() => screen.getByText('restore-all').click());
    // restoreAll should only un-minimize what minimizeAll actually touched (Live Map) —
    // Dispatch, which the user had manually minimized beforehand, stays minimized.
    const items = screen.getAllByRole('listitem').map(li => li.textContent!);
    expect(items.find(t => t.startsWith('Dispatch-'))).toMatch(/-min-/);
    expect(items.find(t => t.startsWith('Live Map-'))).not.toMatch(/-min-/);
  });

  it('minimizeAll with zero open windows returns an empty array and is a no-op', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    act(() => screen.getByText('minimize-all').click());
    expect(screen.queryAllByRole('listitem').length).toBe(0);
  });

  it('toggleAlwaysOnTop flips a window\'s pinned state', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    act(() => screen.getByText('open-dispatch').click());
    expect(screen.getByTestId('first-pinned').textContent).toBe('unpinned');
    act(() => screen.getByText('toggle-pin-first').click());
    expect(screen.getByTestId('first-pinned').textContent).toBe('pinned');
    act(() => screen.getByText('toggle-pin-first').click());
    expect(screen.getByTestId('first-pinned').textContent).toBe('unpinned');
  });

  it('setWindowOpacity clamps to the 0.3–1 range', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    act(() => screen.getByText('open-dispatch').click());
    expect(screen.getByTestId('first-opacity').textContent).toBe('1');
    act(() => screen.getByText('set-opacity-too-high').click());
    expect(screen.getByTestId('first-opacity').textContent).toBe('1');
    act(() => screen.getByText('set-opacity-too-low').click());
    expect(screen.getByTestId('first-opacity').textContent).toBe('0.3');
    act(() => screen.getByText('set-opacity-valid').click());
    expect(screen.getByTestId('first-opacity').textContent).toBe('0.6');
    act(() => screen.getByText('set-opacity-drift').click());
    expect(screen.getByTestId('first-opacity').textContent).toBe('0.3');
  });

  it('opening a path with a remembered position uses it instead of the cascade default', () => {
    sessionStorage.setItem('rmpg_desktop_window_positions', JSON.stringify({ '/dispatch': { x: 300, y: 200, width: 900, height: 700 } }));
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    act(() => screen.getByText('open-dispatch').click());
    expect(screen.getByTestId('first-bounds').textContent).toBe('300,200,900x700');
  });

  it('opening a path with no remembered position falls back to the cascade default', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    act(() => screen.getByText('open-dispatch').click());
    expect(screen.getByTestId('first-bounds').textContent).toBe('80,60,1050x800');
  });

  it('moveResize persists the new bounds to sessionStorage for its path', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    act(() => screen.getByText('open-dispatch').click());
    act(() => screen.getByText('moveresize-first').click());
    const raw = sessionStorage.getItem('rmpg_desktop_window_positions');
    expect(JSON.parse(raw!)['/dispatch']).toEqual({ x: 999, y: 888, width: 777, height: 666 });
  });
});
