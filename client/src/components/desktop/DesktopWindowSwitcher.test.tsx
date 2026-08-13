import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DesktopWindowSwitcher from './DesktopWindowSwitcher';
import { DesktopWindowManagerProvider, useDesktopWindows } from './DesktopWindowManager';

function Harness() {
  const { openWindow, windows } = useDesktopWindows();
  return (
    <>
      <button onClick={() => openWindow('/dispatch', 'Dispatch')}>open-dispatch</button>
      <button onClick={() => openWindow('/map', 'Live Map')}>open-map</button>
      <button onClick={() => openWindow('/records', 'Records')}>open-records</button>
      <DesktopWindowSwitcher />
      <ul>{windows.map(w => <li key={w.id}>{w.title}-{w.zIndex}</li>)}</ul>
    </>
  );
}

function ctrlBacktickDown(shift = false) {
  fireEvent.keyDown(window, { key: '`', ctrlKey: true, shiftKey: shift });
}
function ctrlUp() {
  fireEvent.keyUp(window, { key: 'Control' });
}
function altTabDown(shift = false) {
  fireEvent.keyDown(window, { key: 'Tab', altKey: true, shiftKey: shift });
}
function altUp() {
  fireEvent.keyUp(window, { key: 'Alt' });
}

function zIndexOf(items: string[], titlePrefix: string): number {
  const entry = items.find(t => t.startsWith(`${titlePrefix}-`))!;
  return parseInt(entry.split('-')[1], 10);
}

describe('DesktopWindowSwitcher', () => {
  it('renders no overlay when not cycling', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open-dispatch'));
    expect(screen.queryByTestId('window-switcher-overlay')).not.toBeInTheDocument();
  });

  it('Ctrl+` shows the overlay with the next-most-recent window highlighted', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open-dispatch'));
    fireEvent.click(screen.getByText('open-map'));
    ctrlBacktickDown();
    expect(screen.getByTestId('window-switcher-overlay')).toBeInTheDocument();
    const dispatchEntry = screen.getByText('Dispatch').closest('[aria-current]');
    expect(dispatchEntry).toHaveAttribute('aria-current', 'true');
  });

  it('releasing Ctrl after a single tap focuses the next-most-recent window', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open-dispatch'));
    fireEvent.click(screen.getByText('open-map'));
    ctrlBacktickDown();
    ctrlUp();
    const items = screen.getAllByRole('listitem').map(li => li.textContent!);
    expect(zIndexOf(items, 'Dispatch')).toBeGreaterThan(zIndexOf(items, 'Live Map'));
    expect(screen.queryByTestId('window-switcher-overlay')).not.toBeInTheDocument();
  });

  it('repeated ` presses advance through all open windows and wrap around', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open-dispatch'));
    fireEvent.click(screen.getByText('open-map'));
    fireEvent.click(screen.getByText('open-records'));
    // MRU order at this point: Records (front), Live Map, Dispatch
    ctrlBacktickDown(); // -> Live Map
    ctrlBacktickDown(); // -> Dispatch
    ctrlBacktickDown(); // -> wraps back to Records
    ctrlUp();
    const items = screen.getAllByRole('listitem').map(li => li.textContent!);
    expect(zIndexOf(items, 'Records')).toBeGreaterThan(zIndexOf(items, 'Live Map'));
    expect(zIndexOf(items, 'Records')).toBeGreaterThan(zIndexOf(items, 'Dispatch'));
  });

  it('Ctrl+Shift+` reverses direction', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open-dispatch'));
    fireEvent.click(screen.getByText('open-map'));
    fireEvent.click(screen.getByText('open-records'));
    // MRU order: Records (front), Live Map, Dispatch — reverse from front lands on Dispatch
    ctrlBacktickDown(true);
    ctrlUp();
    const items = screen.getAllByRole('listitem').map(li => li.textContent!);
    expect(zIndexOf(items, 'Dispatch')).toBeGreaterThan(zIndexOf(items, 'Live Map'));
    expect(zIndexOf(items, 'Dispatch')).toBeGreaterThan(zIndexOf(items, 'Records'));
  });

  it('does nothing when no windows are open', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    ctrlBacktickDown();
    expect(screen.queryByTestId('window-switcher-overlay')).not.toBeInTheDocument();
  });

  it('Alt+Tab opens the switcher and Alt release confirms the selection', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open-dispatch'));
    fireEvent.click(screen.getByText('open-map'));
    // MRU: Live Map (front), Dispatch
    altTabDown(); // opens switcher, advances to Dispatch
    expect(screen.getByTestId('window-switcher-overlay')).toBeInTheDocument();
    altUp(); // releasing Alt confirms → Dispatch focused
    expect(screen.queryByTestId('window-switcher-overlay')).not.toBeInTheDocument();
    const items = screen.getAllByRole('listitem').map(li => li.textContent!);
    expect(zIndexOf(items, 'Dispatch')).toBeGreaterThan(zIndexOf(items, 'Live Map'));
  });

  it('Alt+Shift+Tab reverses direction and Alt release confirms', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open-dispatch'));
    fireEvent.click(screen.getByText('open-map'));
    fireEvent.click(screen.getByText('open-records'));
    // MRU: Records (front), Live Map, Dispatch — reverse from front wraps to Dispatch
    altTabDown(true);
    altUp();
    const items = screen.getAllByRole('listitem').map(li => li.textContent!);
    expect(zIndexOf(items, 'Dispatch')).toBeGreaterThan(zIndexOf(items, 'Records'));
  });
});
