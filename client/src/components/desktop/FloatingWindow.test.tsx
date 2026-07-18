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
});
