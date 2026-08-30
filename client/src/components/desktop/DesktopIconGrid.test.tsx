import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { LayoutDashboard, Map as MapIcon, Package, Radio } from 'lucide-react';
import DesktopIconGrid from './DesktopIconGrid';
import { DesktopWindowManagerProvider, useDesktopWindows, type DesktopWindowState } from './DesktopWindowManager';
import type { NavFunction } from '../../data/navCatalog';
import { getIconLabelOverride, setIconLabelOverride } from '../../utils/desktopIconPreferences';
import { isAppPinned } from '../../utils/taskbarPreferences';

// `vi.mock` factories are hoisted above all other module-level code, including
// `const` declarations further down this file. A spy referenced by the factory
// must therefore be created via `vi.hoisted()` so it exists before the factory
// runs (the brief's original in-test `vi.mock(...)` call hit exactly this: the
// factory ran during static import resolution, before `navigateSpy` had been
// assigned, producing "ReferenceError: navigateSpy is not defined").
const { navigateSpy } = vi.hoisted(() => ({ navigateSpy: vi.fn() }));
vi.mock('react-router', async (orig) => ({
  ...(await orig<typeof import('react-router')>()),
  useNavigate: () => navigateSpy,
}));

const addToastMock = vi.fn();
vi.mock('../ToastProvider', () => ({
  useToast: () => ({ addToast: addToastMock }),
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: '1', role: 'officer' } }),
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
    iconSize: 'medium' as const,
    viewMode: 'grid' as const,
    ...overrides,
  };
  render(<MemoryRouter><DesktopWindowManagerProvider><DesktopIconGrid {...props} /></DesktopWindowManagerProvider></MemoryRouter>);
  return props;
}

describe('DesktopIconGrid — multi-select + grouping', () => {
  beforeEach(() => {
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
    fireEvent.change(screen.getByLabelText('Group name'), { target: { value: 'Patrol Tools' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
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
// commit 4fcb48999b). Adapted again for the windowable-apps-expansion pass:
// windowability is now default-on via getWindowConfig/NavFunction.notWindowable
// (see windowManager.ts) instead of a separate POPOUT_PAGES allowlist, so the
// "non-eligible" fixture must explicitly opt out via notWindowable.
const RESTORED_ICONS: NavFunction[] = [
  { path: '/dispatch', label: 'Dispatch Console', icon: LayoutDashboard, description: 'd', windowSize: { width: 1200, height: 900 } }, // windowable
  { path: '/impound', label: 'Impound', icon: Package, description: 'imp', notWindowable: 'test fixture: explicitly excluded' }, // NOT windowable
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
    iconSize: 'medium' as const,
    viewMode: 'grid' as const,
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

  it('double-clicking a windowable icon opens an in-page window, not SPA navigation', () => {
    const { getWindows } = renderRestoredGrid();
    fireEvent.dblClick(screen.getByText('Dispatch Console'));
    expect(getWindows().length).toBe(1);
    expect(getWindows()[0].path).toBe('/dispatch');
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('single-clicking a windowable icon only selects it — does not open a window', () => {
    const { getWindows } = renderRestoredGrid();
    fireEvent.click(screen.getByText('Dispatch Console'));
    expect(getWindows().length).toBe(0);
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('double-clicking a non-eligible icon does not open a window but navigates', () => {
    const { getWindows } = renderRestoredGrid();
    fireEvent.dblClick(screen.getByText('Impound'));
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

describe('DesktopIconGrid — icon size + list view', () => {
  it('scales the icon tile with iconSize', () => {
    const { rerender } = render(
      <MemoryRouter><DesktopWindowManagerProvider>
        <DesktopIconGrid
          icons={ICONS} positions={{}} onReposition={vi.fn()} onUnpin={vi.fn()}
          groups={[]} onCreateGroup={vi.fn()} onUngroup={vi.fn()}
          iconSize="small" viewMode="grid"
        />
      </DesktopWindowManagerProvider></MemoryRouter>,
    );
    const smallTile = screen.getByText('Dispatch').closest('button')!.querySelector('div')!;
    expect(smallTile).toHaveStyle({ width: '40px' });

    rerender(
      <MemoryRouter><DesktopWindowManagerProvider>
        <DesktopIconGrid
          icons={ICONS} positions={{}} onReposition={vi.fn()} onUnpin={vi.fn()}
          groups={[]} onCreateGroup={vi.fn()} onUngroup={vi.fn()}
          iconSize="large" viewMode="grid"
        />
      </DesktopWindowManagerProvider></MemoryRouter>,
    );
    const largeTile = screen.getByText('Dispatch').closest('button')!.querySelector('div')!;
    expect(largeTile).toHaveStyle({ width: '88px' });
  });

  it('renders compact rows instead of absolutely-positioned tiles in list view', () => {
    render(
      <MemoryRouter><DesktopWindowManagerProvider>
        <DesktopIconGrid
          icons={ICONS} positions={{}} onReposition={vi.fn()} onUnpin={vi.fn()}
          groups={[]} onCreateGroup={vi.fn()} onUngroup={vi.fn()}
          iconSize="medium" viewMode="list"
        />
      </DesktopWindowManagerProvider></MemoryRouter>,
    );
    const button = screen.getByText('Dispatch').closest('button')!;
    expect(button).not.toHaveStyle({ position: 'absolute' });
  });
});

describe('DesktopIconGrid — Rename', () => {
  beforeEach(() => localStorage.clear());

  it('right-clicking an icon offers Rename; typing a new label and pressing Enter updates the display and persists it', () => {
    renderGrid();
    fireEvent.contextMenu(screen.getByText('Dispatch'));
    fireEvent.click(screen.getByText('Rename'));
    const input = screen.getByDisplayValue('Dispatch');
    fireEvent.change(input, { target: { value: 'Radio Ops' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('Radio Ops')).toBeInTheDocument();
    expect(getIconLabelOverride('/dispatch')).toBe('Radio Ops');
  });

  it('pressing Escape while renaming cancels without persisting', () => {
    renderGrid();
    fireEvent.contextMenu(screen.getByText('Dispatch'));
    fireEvent.click(screen.getByText('Rename'));
    const input = screen.getByDisplayValue('Dispatch');
    fireEvent.change(input, { target: { value: 'Radio Ops' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getByText('Dispatch')).toBeInTheDocument();
    expect(getIconLabelOverride('/dispatch')).toBeNull();
  });

  it('has an accessible label while renaming, matching the icon being renamed', () => {
    renderGrid();
    fireEvent.contextMenu(screen.getByText('Dispatch'));
    fireEvent.click(screen.getByText('Rename'));
    expect(screen.getByLabelText('Rename Dispatch')).toBeInTheDocument();
  });

  it('a pointerdown+pointermove drag gesture started inside the rename input does not reposition the icon', () => {
    const props = renderGrid();
    fireEvent.contextMenu(screen.getByText('Dispatch'));
    fireEvent.click(screen.getByText('Rename'));
    const input = screen.getByDisplayValue('Dispatch');

    // Simulate click-and-drag text selection inside the input: pointerdown
    // on the input, then a pointermove on window (as the drag handler would
    // listen for). If the input's pointerdown reached the button's drag
    // handler, this would have registered a window pointermove listener and
    // called onReposition.
    fireEvent.pointerDown(input, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 50, clientY: 50 });
    fireEvent.pointerUp(window);

    expect(props.onReposition).not.toHaveBeenCalled();
  });

  it('committing an empty value clears the override and reverts to the catalog label', () => {
    setIconLabelOverride('/dispatch', 'Radio Ops');
    renderGrid();
    expect(screen.getByText('Radio Ops')).toBeInTheDocument();
    fireEvent.contextMenu(screen.getByText('Radio Ops'));
    fireEvent.click(screen.getByText('Rename'));
    const input = screen.getByDisplayValue('Radio Ops');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('Dispatch')).toBeInTheDocument();
    expect(getIconLabelOverride('/dispatch')).toBeNull();
  });
});

describe('DesktopIconGrid — Pin to Taskbar', () => {
  beforeEach(() => localStorage.clear());

  it('right-clicking an icon offers "Pin to Taskbar" when unpinned, and pinning toggles it to "Unpin from Taskbar"', () => {
    render(
      <MemoryRouter><DesktopWindowManagerProvider>
        <DesktopIconGrid
          icons={[{ path: '/dispatch', label: 'Dispatch', icon: Radio, description: 'd' }]}
          positions={{}} onReposition={() => {}} onUnpin={() => {}}
          groups={[]} onCreateGroup={() => {}} onUngroup={() => {}}
          iconSize="medium" viewMode="grid"
        />
      </DesktopWindowManagerProvider></MemoryRouter>
    );
    fireEvent.contextMenu(screen.getByText('Dispatch'));
    expect(screen.getByText('Pin to Taskbar')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Pin to Taskbar'));
    expect(isAppPinned('/dispatch')).toBe(true);

    fireEvent.contextMenu(screen.getByText('Dispatch'));
    expect(screen.getByText('Unpin from Taskbar')).toBeInTheDocument();
  });
});
