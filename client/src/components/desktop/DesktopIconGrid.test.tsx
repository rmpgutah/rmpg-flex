import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LayoutDashboard, Map as MapIcon, Package } from 'lucide-react';
import DesktopIconGrid from './DesktopIconGrid';
import { DesktopWindowManagerProvider, useDesktopWindows, type DesktopWindowState } from './DesktopWindowManager';
import type { NavFunction } from '../../data/navCatalog';

// `vi.mock` factories are hoisted above all other module-level code, including
// `const` declarations further down this file. A spy referenced by the factory
// must therefore be created via `vi.hoisted()` so it exists before the factory
// runs (the brief's original in-test `vi.mock(...)` call hit exactly this: the
// factory ran during static import resolution, before `navigateSpy` had been
// assigned, producing "ReferenceError: navigateSpy is not defined").
const { navigateSpy } = vi.hoisted(() => ({ navigateSpy: vi.fn() }));
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigateSpy,
}));

const ICONS: NavFunction[] = [
  { path: '/dispatch', label: 'Dispatch', icon: LayoutDashboard, description: 'd' },
  { path: '/map', label: 'Live Map', icon: MapIcon, description: 'm' },
];

function renderGrid(overrides: Partial<React.ComponentProps<typeof DesktopIconGrid>> = {}) {
  const props = {
    icons: ICONS,
    positions: { '/dispatch': { x: 20, y: 20 }, '/map': { x: 116, y: 20 } },
    onReposition: vi.fn(),
    onUnpin: vi.fn(),
    groups: [],
    onCreateGroup: vi.fn(),
    onUngroup: vi.fn(),
    ...overrides,
  };
  render(<MemoryRouter><DesktopWindowManagerProvider><DesktopIconGrid {...props} /></DesktopWindowManagerProvider></MemoryRouter>);
  return props;
}

describe('DesktopIconGrid — multi-select + grouping', () => {
  beforeEach(() => {
    vi.spyOn(window, 'prompt').mockReturnValue('Patrol Tools');
    navigateSpy.mockClear();
  });

  it('ctrl-clicking a second icon adds it to the selection instead of activating it', () => {
    renderGrid();
    fireEvent.click(screen.getByText('Dispatch'), { ctrlKey: true });
    fireEvent.click(screen.getByText('Live Map'), { ctrlKey: true });
    // Neither ctrl-click should have navigated — both were selection toggles
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('right-clicking with 2 icons selected offers "Group as..." and calls onCreateGroup with both paths', () => {
    const props = renderGrid();
    fireEvent.click(screen.getByText('Dispatch'), { ctrlKey: true });
    fireEvent.click(screen.getByText('Live Map'), { ctrlKey: true });
    fireEvent.contextMenu(screen.getByText('Live Map'));
    fireEvent.click(screen.getByText('Group as...'));
    expect(props.onCreateGroup).toHaveBeenCalledWith(
      expect.arrayContaining(['/dispatch', '/map']),
      'Patrol Tools',
    );
  });

  it('renders a group region with its label and an Ungroup context action', () => {
    const props = renderGrid({
      groups: [{ id: 'g1', label: 'Patrol Tools', x: 10, y: 10, w: 220, h: 100, memberPaths: ['/dispatch', '/map'] }],
    });
    expect(screen.getByText('Patrol Tools')).toBeInTheDocument();
    fireEvent.contextMenu(screen.getByTestId('desktop-group-g1'));
    fireEvent.click(screen.getByText('Ungroup'));
    expect(props.onUngroup).toHaveBeenCalledWith('g1');
  });
});

// Restored from the pre-Task-4 v1 desktop launcher suite (originally added in
// commit 4fcb48999b). Task 4's rewrite replaced this whole file with the
// multi-select/grouping suite above and dropped these 3 tests, even though the
// underlying behavior they cover (POPOUT-eligible click opens a window,
// non-eligible click falls back to navigate(), right-click "Unpin") is still
// present in the rewritten component. Adapted for the current
// `DesktopIconGridProps` signature (now requires `groups`/`onCreateGroup`/
// `onUngroup`) and the hoisted `navigateSpy` mock introduced by Task 4.
const RESTORED_ICONS: NavFunction[] = [
  { path: '/dispatch', label: 'Dispatch Console', icon: LayoutDashboard, description: 'd' }, // in POPOUT_PAGES
  { path: '/impound', label: 'Impound', icon: Package, description: 'imp' }, // NOT in POPOUT_PAGES
];

function renderRestoredGrid(overrides: Partial<React.ComponentProps<typeof DesktopIconGrid>> = {}) {
  const props = {
    icons: RESTORED_ICONS,
    positions: { '/dispatch': { x: 20, y: 20 }, '/impound': { x: 180, y: 20 } },
    onReposition: vi.fn(),
    onUnpin: vi.fn(),
    groups: [],
    onCreateGroup: vi.fn(),
    onUngroup: vi.fn(),
    ...overrides,
  };
  let windowsSnapshot: DesktopWindowState[] = [];
  function Reader() {
    windowsSnapshot = useDesktopWindows().windows;
    return null;
  }
  render(
    <MemoryRouter>
      <DesktopWindowManagerProvider>
        <DesktopIconGrid {...props} />
        <Reader />
      </DesktopWindowManagerProvider>
    </MemoryRouter>,
  );
  return { props, getWindows: () => windowsSnapshot };
}

describe('DesktopIconGrid — v1 launcher behavior (restored coverage)', () => {
  beforeEach(() => {
    navigateSpy.mockClear();
  });

  it('clicking a POPOUT_PAGES-eligible icon opens an in-page window, not SPA navigation', () => {
    const { getWindows } = renderRestoredGrid();
    fireEvent.click(screen.getByText('Dispatch Console'));
    expect(getWindows().length).toBe(1);
    expect(getWindows()[0].path).toBe('/dispatch');
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('clicking a non-eligible icon does not open a window', () => {
    const { getWindows } = renderRestoredGrid();
    fireEvent.click(screen.getByText('Impound'));
    expect(getWindows().length).toBe(0);
    expect(navigateSpy).toHaveBeenCalledWith('/impound');
  });

  it('right-click "Unpin" calls onUnpin with the icon path', () => {
    const props = renderRestoredGrid().props;
    fireEvent.contextMenu(screen.getByText('Impound'));
    fireEvent.click(screen.getByText('Unpin'));
    expect(props.onUnpin).toHaveBeenCalledWith('/impound');
  });
});
