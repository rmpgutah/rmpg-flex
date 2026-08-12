// client/src/components/desktop/DesktopWindowManager.test.tsx
import { useRef } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import { DesktopWindowManagerProvider, useDesktopWindows } from './DesktopWindowManager';
import { setDefaultWindowOpacity } from '../../utils/windowOpacityPreference';

function Harness() {
  const { windows, openWindow, closeWindow, focusWindow, minimizeWindow, updateWindowTitle, minimizeAll, restoreAll, toggleAlwaysOnTop, setWindowOpacity, moveResize, setFullscreen, mergeWindowTab, tearOffTab } = useDesktopWindows();
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
      <button onClick={() => windows[0] && moveResize(windows[0].id, { x: 1, y: 2, width: 3, height: 4 }, { persist: false })}>moveresize-first-no-persist</button>
      <button onClick={() => windows[0] && setFullscreen(windows[0].id, true)}>set-fullscreen</button>
      <button onClick={() => { if (windows.length >= 2) mergeWindowTab(windows[1].id, windows[0].id); }}>merge-tab</button>
      <button onClick={() => windows[1] && tearOffTab(windows[1].id)}>tearoff-second</button>
      <span data-testid="first-fullscreen">{windows[0]?.fullscreen ? 'fs' : 'normal'}</span>
      <span data-testid="cap-results">{capResults.current.join(',')}</span>
      <span data-testid="first-path">{windows[0]?.path ?? ''}</span>
      <span data-testid="first-pinned">{windows[0]?.alwaysOnTop ? 'pinned' : 'unpinned'}</span>
      <span data-testid="first-opacity">{windows[0]?.opacity ?? ''}</span>
      <span data-testid="first-bounds">{windows[0] ? `${windows[0].x},${windows[0].y},${windows[0].width}x${windows[0].height}` : ''}</span>
      <span data-testid="first-group">{windows[0]?.groupId ?? 'none'}</span>
      <span data-testid="second-group">{windows[1]?.groupId ?? 'none'}</span>
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

  it('setFullscreen toggles fullscreen on the correct window', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    act(() => screen.getByText('open-dispatch').click());
    expect(screen.getByTestId('first-fullscreen').textContent).toBe('normal');
    act(() => screen.getByText('set-fullscreen').click());
    expect(screen.getByText(/^Dispatch-/)).toBeInTheDocument(); // window still open
    expect(screen.getByTestId('first-fullscreen').textContent).toBe('fs');
  });

  it('mergeWindowTab assigns both windows to the same groupId', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    act(() => screen.getByText('open-dispatch').click());
    act(() => screen.getByText('open-map').click());
    act(() => screen.getByText('merge-tab').click());
    const firstGroup = screen.getByTestId('first-group').textContent;
    const secondGroup = screen.getByTestId('second-group').textContent;
    expect(firstGroup).not.toBe('none');
    expect(firstGroup).toBe(secondGroup);
  });

  it('tearOffTab removes the groupId from a window', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    act(() => screen.getByText('open-dispatch').click());
    act(() => screen.getByText('open-map').click());
    act(() => screen.getByText('merge-tab').click());
    act(() => screen.getByText('tearoff-second').click());
    expect(screen.getByTestId('second-group').textContent).toBe('none');
  });

  it('tearOffTab clears the groupId from the sole remaining member of a 2-window group', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    act(() => screen.getByText('open-dispatch').click());
    act(() => screen.getByText('open-map').click());
    act(() => screen.getByText('merge-tab').click());
    // Both windows are in the same group
    expect(screen.getByTestId('first-group').textContent).not.toBe('none');
    expect(screen.getByTestId('second-group').textContent).not.toBe('none');
    // Tear off the second window — only one member (first) would remain in the group
    act(() => screen.getByText('tearoff-second').click());
    // The torn-off window must have no groupId
    expect(screen.getByTestId('second-group').textContent).toBe('none');
    // The sole remaining window must also have its groupId cleared — it is no longer in a group
    expect(screen.getByTestId('first-group').textContent).toBe('none');
  });

  it('moveResize with { persist: false } updates window state but leaves the remembered position untouched', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    act(() => screen.getByText('open-dispatch').click());
    act(() => screen.getByText('moveresize-first').click()); // establishes a persisted 999,888,777x666
    act(() => screen.getByText('moveresize-first-no-persist').click()); // transient snap-like bounds
    // Live window state reflects the latest (non-persisted) update.
    expect(screen.getByTestId('first-bounds').textContent).toBe('1,2,3x4');
    // But the remembered position for the path is still the last persisted call, not the
    // transient one — this is the invariant that stops snap-to-edge bounds from becoming
    // the "remembered" position for a path.
    const raw = sessionStorage.getItem('rmpg_desktop_window_positions');
    expect(JSON.parse(raw!)['/dispatch']).toEqual({ x: 999, y: 888, width: 777, height: 666 });
  });
});

vi.mock('../../utils/desktopSounds', () => ({ playDesktopSound: vi.fn() }));
import { playDesktopSound } from '../../utils/desktopSounds';

describe('DesktopWindowManager — desktop sounds on window events', () => {
  beforeEach(() => { sessionStorage.clear(); vi.mocked(playDesktopSound).mockClear(); });

  it('plays a sound when a genuinely new window opens, not when an existing one is refocused', () => {
    function Harness() {
      const { openWindow } = useDesktopWindows();
      return <button onClick={() => openWindow('/dispatch', 'Dispatch')}>open</button>;
    }
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open'));
    expect(playDesktopSound).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('open')); // same path — refocus, not a new window
    expect(playDesktopSound).toHaveBeenCalledTimes(1); // still 1, not 2
  });

  it('plays a sound when a window closes', () => {
    function Harness() {
      const { openWindow, closeWindow, windows } = useDesktopWindows();
      return (
        <>
          <button onClick={() => openWindow('/dispatch', 'Dispatch')}>open</button>
          {windows.map(w => <button key={w.id} onClick={() => closeWindow(w.id)}>close</button>)}
        </>
      );
    }
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open'));
    vi.mocked(playDesktopSound).mockClear();
    fireEvent.click(screen.getByText('close'));
    expect(playDesktopSound).toHaveBeenCalledTimes(1);
  });

  it('plays a sound when a window is minimized or restored', () => {
    function Harness() {
      const { openWindow, minimizeWindow, windows } = useDesktopWindows();
      return (
        <>
          <button onClick={() => openWindow('/dispatch', 'Dispatch')}>open</button>
          {windows.map(w => <button key={w.id} onClick={() => minimizeWindow(w.id)}>toggle-min</button>)}
        </>
      );
    }
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open'));
    vi.mocked(playDesktopSound).mockClear();
    fireEvent.click(screen.getByText('toggle-min'));
    expect(playDesktopSound).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('toggle-min'));
    expect(playDesktopSound).toHaveBeenCalledTimes(2);
  });
});

describe('DesktopWindowManager — default window opacity baseline', () => {
  beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });

  it('a newly-opened window starts at the configured default opacity', () => {
    setDefaultWindowOpacity(0.7);
    function Harness() {
      const { openWindow, windows } = useDesktopWindows();
      return (
        <>
          <button onClick={() => openWindow('/dispatch', 'Dispatch')}>open</button>
          <ul>{windows.map(w => <li key={w.id}>{w.opacity}</li>)}</ul>
        </>
      );
    }
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open'));
    expect(screen.getByText('0.7')).toBeInTheDocument();
    setDefaultWindowOpacity(1); // cleanup for other tests
  });

  it('an already-open window is unaffected when the default opacity setting later changes', () => {
    setDefaultWindowOpacity(1);
    function Harness() {
      const { openWindow, windows } = useDesktopWindows();
      return (
        <>
          <button onClick={() => openWindow('/dispatch', 'Dispatch')}>open</button>
          <ul>{windows.map(w => <li key={w.id}>{w.opacity}</li>)}</ul>
        </>
      );
    }
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open'));
    expect(screen.getByText('1')).toBeInTheDocument();
    setDefaultWindowOpacity(0.5); // changing the setting AFTER the window opened
    expect(screen.getByText('1')).toBeInTheDocument(); // still 1, not retroactively changed
    setDefaultWindowOpacity(1); // cleanup
  });
});
