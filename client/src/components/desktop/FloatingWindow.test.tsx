import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import FloatingWindow from './FloatingWindow';
import { DesktopWindowManagerProvider, useDesktopWindows } from './DesktopWindowManager';
import { setSnapEnabled } from '../../utils/snapPreference';

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
});
