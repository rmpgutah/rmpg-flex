import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DesktopWindowManagerProvider, useDesktopWindows } from './DesktopWindowManager';
import DesktopIconGrid from './DesktopIconGrid';
import { Radio, Package } from 'lucide-react';
import type { NavFunction } from '../../data/navCatalog';

const icons: NavFunction[] = [
  { path: '/dispatch', label: 'Dispatch Console', icon: Radio, description: 'desc' }, // in POPOUT_PAGES
  { path: '/impound', label: 'Impound', icon: Package, description: 'desc' }, // NOT in POPOUT_PAGES
];

function Harness({ onUnpin }: { onUnpin: (path: string) => void }) {
  return (
    <DesktopIconGrid
      icons={icons}
      positions={{ '/dispatch': { x: 20, y: 20 }, '/impound': { x: 180, y: 20 } }}
      onReposition={() => {}}
      onUnpin={onUnpin}
    />
  );
}

describe('DesktopIconGrid', () => {
  it('clicking a POPOUT_PAGES-eligible icon opens an in-page window, not SPA navigation', () => {
    let windowsSnapshot: unknown[] = [];
    function Reader() { windowsSnapshot = useDesktopWindows().windows; return null; }
    render(
      <MemoryRouter>
        <DesktopWindowManagerProvider>
          <Harness onUnpin={() => {}} />
          <Reader />
        </DesktopWindowManagerProvider>
      </MemoryRouter>
    );
    fireEvent.click(screen.getByText('Dispatch Console'));
    expect(windowsSnapshot.length).toBe(1);
  });

  it('clicking a non-eligible icon does not open a window', () => {
    let windowsSnapshot: unknown[] = [];
    function Reader() { windowsSnapshot = useDesktopWindows().windows; return null; }
    render(
      <MemoryRouter>
        <DesktopWindowManagerProvider>
          <Harness onUnpin={() => {}} />
          <Reader />
        </DesktopWindowManagerProvider>
      </MemoryRouter>
    );
    fireEvent.click(screen.getByText('Impound'));
    expect(windowsSnapshot.length).toBe(0);
  });

  it('right-click "Unpin" calls onUnpin with the icon path', () => {
    const onUnpin = vi.fn();
    render(
      <MemoryRouter>
        <DesktopWindowManagerProvider><Harness onUnpin={onUnpin} /></DesktopWindowManagerProvider>
      </MemoryRouter>
    );
    fireEvent.contextMenu(screen.getByText('Impound'));
    fireEvent.click(screen.getByText('Unpin'));
    expect(onUnpin).toHaveBeenCalledWith('/impound');
  });
});
