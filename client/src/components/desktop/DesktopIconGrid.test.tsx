import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LayoutDashboard, Map as MapIcon } from 'lucide-react';
import DesktopIconGrid from './DesktopIconGrid';
import { DesktopWindowManagerProvider } from './DesktopWindowManager';
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
