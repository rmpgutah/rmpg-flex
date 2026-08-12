import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import FloatingWindow, { ALWAYS_ON_TOP_ZINDEX_OFFSET } from './FloatingWindow';
import { DesktopWindowManagerProvider, useDesktopWindows } from './DesktopWindowManager';
import { setSnapEnabled } from '../../utils/snapPreference';
import { getSavedPosition } from '../../utils/desktopWindowPositions';
import { setTaskbarSize } from '../../utils/taskbarPreferences';

vi.mock('../../utils/desktopSounds', () => ({ playDesktopSound: vi.fn() }));
import { playDesktopSound } from '../../utils/desktopSounds';

function Harness() {
  const { windows, openWindow } = useDesktopWindows();
  return (
    <div>
      <button onClick={() => openWindow('/dispatch', 'Dispatch')}>open</button>
      {windows.map(w => <FloatingWindow key={w.id} win={w} />)}
    </div>
  );
}

describe('FloatingWindow', () => {
  it('renders a title bar with the window title and an iframe pointed at the route', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open'));
    expect(screen.getByText('Dispatch')).toBeInTheDocument();
    const iframe = screen.getByTitle('Dispatch') as HTMLIFrameElement;
    expect(iframe.tagName).toBe('IFRAME');
    expect(iframe.src).toContain('/dispatch');
  });

  it('close button removes the window', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open'));
    fireEvent.click(screen.getByLabelText('Close Dispatch'));
    expect(screen.queryByText('Dispatch')).not.toBeInTheDocument();
  });

  it('minimize button hides the iframe but keeps the window in the taskbar-visible list', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open'));
    fireEvent.click(screen.getByLabelText('Minimize Dispatch'));
    expect(screen.queryByTitle('Dispatch')).not.toBeInTheDocument();
    expect(screen.getByText('Dispatch')).toBeInTheDocument(); // title bar itself stays mounted, per minimized styling
  });

  it('minimize button restores the window on a second real click (pointerdown-then-click ordering)', () => {
    // Regression test: a native click always fires `pointerdown` before `click`. The
    // outer window div's onPointerDown must ignore clicks that land on a button —
    // otherwise it calls focusWindow (which unconditionally sets minimized: false)
    // *before* the button's own onClick toggles minimized, and the toggle's result
    // gets fought/undone by the pointerdown. Plain fireEvent.click() alone (no
    // pointerdown) would never exercise this ordering, so we dispatch both events
    // explicitly to reproduce the real browser sequence.
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open'));

    const minimizeButton = screen.getByLabelText('Minimize Dispatch');

    // First real click: minimize.
    fireEvent.pointerDown(minimizeButton);
    fireEvent.click(minimizeButton);
    expect(screen.queryByTitle('Dispatch')).not.toBeInTheDocument();

    // Second real click: should restore (un-minimize), not re-minimize.
    fireEvent.pointerDown(minimizeButton);
    fireEvent.click(minimizeButton);
    expect(screen.getByTitle('Dispatch')).toBeInTheDocument();
  });

  it('grants microphone, camera, and fullscreen permissions to the iframe (needed by Radio push-to-talk, DL Search live camera scan, and Command Center fullscreen)', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open'));
    const iframe = screen.getByTitle('Dispatch') as HTMLIFrameElement;
    expect(iframe.getAttribute('allow')).toBe('microphone; camera; fullscreen');
  });
});

describe('FloatingWindow — title sync', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // Stubs contentWindow directly rather than relying on jsdom's iframe navigation
  // (which doesn't actually update contentWindow.location on a src change) — this
  // simulates what a real same-origin iframe reports after the app's own in-page nav
  // bar navigates it via client-side routing, with no signal reaching the parent.
  function stubIframePathname(pathname: string) {
    const iframe = screen.getByTitle('Dispatch') as HTMLIFrameElement;
    Object.defineProperty(iframe, 'contentWindow', {
      configurable: true,
      value: { location: { pathname } },
    });
    return iframe;
  }

  it('updates the title bar when the iframe navigates internally to another catalog route', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open'));
    stubIframePathname('/warrants');
    act(() => { vi.advanceTimersByTime(500); });
    expect(screen.getByText('Warrants')).toBeInTheDocument();
    expect(screen.queryByText('Dispatch')).not.toBeInTheDocument();
  });

  it('leaves the title alone when the iframe navigates to a route with no catalog entry', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open'));
    stubIframePathname('/detached/incident/123');
    act(() => { vi.advanceTimersByTime(500); });
    expect(screen.getByText('Dispatch')).toBeInTheDocument();
  });

  it('never changes the iframe src in response to polling (would force a real reload)', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open'));
    const iframe = stubIframePathname('/warrants');
    act(() => { vi.advanceTimersByTime(500); });
    expect(iframe.src).toContain('/dispatch');
    expect(iframe.src).not.toContain('/warrants');
  });
});

describe('FloatingWindow — snap to edge', () => {
  // getByText('Dispatch') is the <span> inside the title-bar div; .closest('div')
  // from a <span> returns its nearest div ancestor, which IS the title-bar div
  // itself (the span has no wrapping div of its own) — this is the element
  // onTitleBarPointerDown is actually attached to.
  function dragTitleBarTo(clientX: number, clientY: number) {
    const titleBar = screen.getByText('Dispatch').closest('div')!;
    fireEvent.pointerDown(titleBar, { clientX: 500, clientY: 300 });
    fireEvent.pointerMove(window, { clientX, clientY });
  }
  function releaseDrag() {
    fireEvent.pointerUp(window);
  }

  it('shows a snap preview and snaps to the left half when dropped near the left edge', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open'));
    dragTitleBarTo(10, 300);
    expect(screen.getByTestId('snap-preview-left')).toBeInTheDocument();
    releaseDrag();
    const windowEl = screen.getByTitle('Dispatch').parentElement as HTMLElement;
    expect(windowEl.style.left).toBe('0px');
    expect(windowEl.style.width).toBe(`${window.innerWidth / 2}px`);
  });

  it('does not snap when the drop point is away from an edge', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open'));
    dragTitleBarTo(500, 300);
    expect(screen.queryByTestId('snap-preview-left')).not.toBeInTheDocument();
    expect(screen.queryByTestId('snap-preview-right')).not.toBeInTheDocument();
    releaseDrag();
    const windowEl = screen.getByTitle('Dispatch').parentElement as HTMLElement;
    expect(windowEl.style.width).not.toBe(`${window.innerWidth / 2}px`);
  });

  it('does not snap when snapping is disabled via preference', () => {
    setSnapEnabled(false);
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open'));
    dragTitleBarTo(10, 300);
    expect(screen.queryByTestId('snap-preview-left')).not.toBeInTheDocument();
    setSnapEnabled(true);
  });

  it('does not persist the half-screen snapped bounds as the remembered position for the path', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open'));
    dragTitleBarTo(10, 300);
    releaseDrag();
    // The window itself is visibly snapped to the left half...
    const windowEl = screen.getByTitle('Dispatch').parentElement as HTMLElement;
    expect(windowEl.style.width).toBe(`${window.innerWidth / 2}px`);
    // ...but the saved/remembered position for '/dispatch' must NOT be the snapped
    // half-screen size, since that's a transient drag outcome, not a user-chosen size.
    const saved = getSavedPosition('/dispatch');
    if (saved) {
      expect(saved.width).not.toBe(window.innerWidth / 2);
    }
  });
});

describe('FloatingWindow — snap sound', () => {
  beforeEach(() => vi.mocked(playDesktopSound).mockClear());

  function dragTitleBarTo(clientX: number, clientY: number) {
    const titleBar = screen.getByText('Dispatch').closest('div')!;
    fireEvent.pointerDown(titleBar, { clientX: 500, clientY: 300 });
    fireEvent.pointerMove(window, { clientX, clientY });
  }
  function releaseDrag() {
    fireEvent.pointerUp(window);
  }

  it('plays a sound when a snap is actually applied', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open'));
    dragTitleBarTo(10, 300); // near the left edge — a snap will apply
    releaseDrag();
    expect(playDesktopSound).toHaveBeenCalledTimes(1);
  });

  it('does not play a sound on a normal drag release with no snap applied', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open'));
    dragTitleBarTo(500, 300); // away from any edge — no snap
    releaseDrag();
    expect(playDesktopSound).not.toHaveBeenCalled();
  });
});

describe('FloatingWindow — always-on-top', () => {
  it('clicking the pin button toggles the aria-label between Pin and Unpin', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open'));
    expect(screen.getByLabelText('Pin Dispatch on top')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Pin Dispatch on top'));
    expect(screen.getByLabelText('Unpin Dispatch')).toBeInTheDocument();
  });

  it('a pinned-but-unfocused window renders above an unpinned, more-recently-focused window', () => {
    function Harness2() {
      const { windows, openWindow, focusWindow } = useDesktopWindows();
      return (
        <>
          <button onClick={() => openWindow('/dispatch', 'Dispatch')}>open-a</button>
          <button onClick={() => openWindow('/map', 'Live Map')}>open-b</button>
          <button onClick={() => windows[1] && focusWindow(windows[1].id)}>focus-second</button>
          {windows.map(w => <FloatingWindow key={w.id} win={w} />)}
        </>
      );
    }
    render(<DesktopWindowManagerProvider><Harness2 /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open-a'));
    fireEvent.click(screen.getByText('open-b'));
    fireEvent.click(screen.getByLabelText('Pin Dispatch on top'));
    fireEvent.click(screen.getByText('focus-second'));
    const dispatchWindowEl = screen.getByTitle('Dispatch').parentElement as HTMLElement;
    const mapWindowEl = screen.getByTitle('Live Map').parentElement as HTMLElement;
    expect(parseInt(dispatchWindowEl.style.zIndex, 10)).toBeGreaterThan(parseInt(mapWindowEl.style.zIndex, 10));
  });

  it('a pinned window\'s effective zIndex never exceeds the overlay tier used by the snap preview / window switcher', () => {
    // Regression guard for the pinned-window-occludes-overlays bug: pinned windows render
    // at win.zIndex + ALWAYS_ON_TOP_ZINDEX_OFFSET, so any fixed-position overlay that must
    // always render above every window (snap preview, window switcher) needs a zIndex
    // strictly greater than ALWAYS_ON_TOP_ZINDEX_OFFSET plus any realistic win.zIndex.
    // Window zIndex values come from a small incrementing focus counter, so a generous
    // realistic ceiling (1000) is used here.
    const REALISTIC_MAX_WIN_ZINDEX = 999;
    const maxPinnedEffectiveZIndex = REALISTIC_MAX_WIN_ZINDEX + ALWAYS_ON_TOP_ZINDEX_OFFSET;
    const OVERLAY_ZINDEXES = [11000 /* FloatingWindow's SNAP_PREVIEW_ZINDEX */, 11001 /* DesktopWindowSwitcher's WINDOW_SWITCHER_ZINDEX */];
    for (const overlayZ of OVERLAY_ZINDEXES) {
      expect(overlayZ).toBeGreaterThan(maxPinnedEffectiveZIndex);
    }
  });
});

describe('FloatingWindow — opacity', () => {
  it('applies win.opacity to the window\'s rendered style, defaulting to 1', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open'));
    const windowEl = screen.getByTitle('Dispatch').parentElement as HTMLElement;
    expect(windowEl.style.opacity).toBe('1');
  });

  it('right-clicking the title bar opens the system menu', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open'));
    const titleBar = screen.getByTestId('title-bar');
    fireEvent.contextMenu(titleBar);
    expect(screen.getByTestId('system-menu')).toBeInTheDocument();
  });
});

describe('FloatingWindow — respects taskbar size setting for maximize/snap math', () => {
  it('maximized style leaves room for a large (56px) taskbar', () => {
    setTaskbarSize('large');
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open'));
    fireEvent.click(screen.getByLabelText('Maximize Dispatch'));
    const windowEl = screen.getByTitle('Dispatch').parentElement as HTMLElement;
    expect(windowEl.style.bottom).toBe('56px');
    setTaskbarSize('small');
  });
});

describe('FloatingWindow — system menu', () => {
  function renderWindow() {
    const result = render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open'));
    return result;
  }

  it('right-clicking title bar opens system menu with Close option', async () => {
    const { getByTestId } = renderWindow();
    const titleBar = getByTestId('title-bar');
    fireEvent.contextMenu(titleBar);
    expect(screen.getByRole('menuitem', { name: /close/i })).toBeInTheDocument();
  });

  it('system menu opacity slider changes opacity', async () => {
    const { getByTestId } = renderWindow();
    const titleBar = getByTestId('title-bar');
    fireEvent.contextMenu(titleBar);
    const slider = screen.getByRole('slider', { name: /opacity/i });
    fireEvent.change(slider, { target: { value: '0.5' } });
    const windowEl = screen.getByTitle('Dispatch').parentElement as HTMLElement;
    expect(parseFloat(windowEl.style.opacity)).toBeCloseTo(0.5, 1);
  });
});

describe('FloatingWindow — SnapLayouts trigger', () => {
  function renderWindow() {
    const result = render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open'));
    return result;
  }

  it('shows snap layouts overlay after hovering maximize button for 400ms', () => {
    vi.useFakeTimers();
    const { container } = renderWindow();
    const maxBtn = screen.getByLabelText(/maximize/i);
    fireEvent.mouseEnter(maxBtn);
    act(() => { vi.advanceTimersByTime(400); });
    expect(container.querySelector('[data-testid="snap-layouts-overlay"]')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('does NOT dismiss snap layouts overlay on mouse-leave when overlay is already open', () => {
    // Mouse-leave should only cancel the pending hover timer — once the overlay is
    // visible, SnapLayouts' own outside-click listener is the correct dismiss path.
    vi.useFakeTimers();
    const { container } = renderWindow();
    const maxBtn = screen.getByLabelText(/maximize/i);
    fireEvent.mouseEnter(maxBtn);
    act(() => { vi.advanceTimersByTime(400); });
    expect(container.querySelector('[data-testid="snap-layouts-overlay"]')).toBeInTheDocument();
    fireEvent.mouseLeave(maxBtn);
    // Overlay must still be present — mouse-leave does not dismiss it
    expect(container.querySelector('[data-testid="snap-layouts-overlay"]')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('does not show snap layouts overlay before 400ms have elapsed', () => {
    vi.useFakeTimers();
    const { container } = renderWindow();
    const maxBtn = screen.getByLabelText(/maximize/i);
    fireEvent.mouseEnter(maxBtn);
    act(() => { vi.advanceTimersByTime(300); });
    expect(container.querySelector('[data-testid="snap-layouts-overlay"]')).not.toBeInTheDocument();
    vi.useRealTimers();
  });
});
