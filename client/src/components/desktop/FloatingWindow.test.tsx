import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FloatingWindow from './FloatingWindow';
import { DesktopWindowManagerProvider, useDesktopWindows } from './DesktopWindowManager';

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

  it('grants microphone and fullscreen permissions to the iframe (needed by Radio push-to-talk and Command Center fullscreen)', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open'));
    const iframe = screen.getByTitle('Dispatch') as HTMLIFrameElement;
    expect(iframe.getAttribute('allow')).toBe('microphone; fullscreen');
  });
});
