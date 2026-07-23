// client/src/pages/warrants/__tests__/WarrantsListTab.test.tsx
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import WarrantsListTab from '../WarrantsListTab';
import * as useApiModule from '../../../hooks/useApi';
import type { User } from '../../../types';

vi.mock('../../../components/ToastProvider', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));
const { openMenuMock } = vi.hoisted(() => ({ openMenuMock: vi.fn() }));
vi.mock('../../../context/ContextMenuContext', () => ({
  useContextMenu: () => ({ openMenu: openMenuMock }),
}));
vi.mock('../../../hooks/useLiveSync', () => ({ useLiveSync: () => {} }));
vi.mock('../../../context/WebSocketContext', () => ({
  useWebSocket: () => ({ subscribe: () => () => {} }),
}));
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: '1', username: 'testofficer', first_name: 'Test', last_name: 'Officer', role: 'admin' } }),
}));
vi.mock('../../../utils/contextMenuActions', () => ({
  useMenuActions: () => ({
    action: (label: string, onClick: () => void) => ({ label, onClick }),
    go: (label: string, to: string) => ({ label, to }),
    copy: (label: string, value: unknown) => ({ label, value }),
    copyId: (id: unknown) => ({ label: 'Copy ID', value: id }),
    separator: () => ({ separator: true }),
  }),
}));

const testUser: User = {
  id: '1',
  username: 'testofficer',
  email: 'test@example.com',
  first_name: 'Test',
  last_name: 'Officer',
  full_name: 'Test Officer',
  role: 'admin',
  badge_number: '1A',
  is_active: true,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const baseProps = {
  isVisible: true,
  user: testUser,
  isAdminOrManager: true,
  isAdminSupervisorOrManager: true,
  isGodMode: true,
  canManageWarrants: true,
  isMobile: false,
  navigate: vi.fn(),
  initialPersonId: null,
  initialWarrantId: null,
  formOpen: false,
  onOpenNewForm: vi.fn(),
  onOpenEditForm: vi.fn(),
  onOpenPersonProfile: vi.fn(),
};

function renderTab(props: Partial<typeof baseProps> = {}) {
  return render(
    <MemoryRouter>
      <WarrantsListTab {...baseProps} {...props} />
    </MemoryRouter>,
  );
}

// Exposes the router's current ?search string so URL-sync behavior (chips
// persisting their state to the URL, or hydrating from it) can be asserted
// without reaching into MemoryRouter internals.
function LocationSearchProbe() {
  const location = useLocation();
  return <div data-testid="location-search">{location.search}</div>;
}

function renderTabWithLocationProbe(props: Partial<typeof baseProps> = {}, initialEntries: string[] = ['/warrants']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <WarrantsListTab {...baseProps} {...props} />
      <LocationSearchProbe />
    </MemoryRouter>,
  );
}

describe('WarrantsListTab', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.spyOn(useApiModule, 'apiFetch').mockResolvedValue({ warrants: [], total: 0 });
  });

  it('renders without crashing and fetches the list on mount', async () => {
    renderTab();
    await waitFor(() => {
      expect(useApiModule.apiFetch).toHaveBeenCalledWith(expect.stringContaining('/warrants/unified'));
    });
  });

  it('debounces the search box — typing does not fire a request per keystroke', async () => {
    renderTab();
    // 4 calls at mount: the double fetchWarrants invoke, the
    // useWatchedWarrantIds hook's own /intel/watchlist fetch, and the poll
    // status strip's /warrants/watch/runs fetch.
    await waitFor(() => expect(useApiModule.apiFetch).toHaveBeenCalledTimes(4));
    const search = screen.getByPlaceholderText(/search by name, warrant #, or charge/i);
    await userEvent.type(search, 'Turley');
    // Immediately after typing, no new request yet (debounce window hasn't elapsed).
    expect(useApiModule.apiFetch).toHaveBeenCalledTimes(4);
    await waitFor(() => expect(useApiModule.apiFetch).toHaveBeenCalledTimes(5), { timeout: 1000 });
    expect(useApiModule.apiFetch).toHaveBeenLastCalledWith(expect.stringContaining('subject_name=Turley'));
  });

  it('calls onOpenNewForm when the New Warrant button is clicked', async () => {
    renderTab();
    await waitFor(() => expect(useApiModule.apiFetch).toHaveBeenCalledTimes(4));
    // The empty-state panel also renders a "New Warrant" action button when
    // the list is empty (as it is here, per the mocked apiFetch response),
    // so target the toolbar's primary button specifically (first match).
    const [newWarrantButton] = screen.getAllByRole('button', { name: /new warrant/i });
    await userEvent.click(newWarrantButton);
    expect(baseProps.onOpenNewForm).toHaveBeenCalled();
  });

  it('is hidden (display: none) when isVisible is false', async () => {
    const { container } = renderTab({ isVisible: false });
    await waitFor(() => expect(useApiModule.apiFetch).toHaveBeenCalledTimes(4));
    expect(container.firstChild).toHaveStyle({ display: 'none' });
  });

  it('shows a "My Watched Warrants" filter chip that adds watched_only=1 to the request', async () => {
    renderTab();
    await waitFor(() => expect(useApiModule.apiFetch).toHaveBeenCalled());
    const chip = screen.getByRole('button', { name: /my watched warrants/i });
    await userEvent.click(chip);
    await waitFor(() => {
      expect(useApiModule.apiFetch).toHaveBeenCalledWith(expect.stringContaining('watched_only=1'));
    });
  });

  it('toggling the chip off removes watched_only from the request', async () => {
    renderTab();
    await waitFor(() => expect(useApiModule.apiFetch).toHaveBeenCalled());
    const chip = screen.getByRole('button', { name: /my watched warrants/i });
    await userEvent.click(chip); // on
    await waitFor(() => expect(useApiModule.apiFetch).toHaveBeenCalledWith(expect.stringContaining('watched_only=1')));
    await userEvent.click(chip); // off
    await waitFor(() => {
      const calls = (useApiModule.apiFetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      const lastCall = calls[calls.length - 1]?.[0];
      expect(String(lastCall)).not.toContain('watched_only');
    });
  });

  it('syncs the "My Watched Warrants" chip with the URL like its sibling filters', async () => {
    renderTabWithLocationProbe();
    await waitFor(() => expect(useApiModule.apiFetch).toHaveBeenCalled());
    const chip = screen.getByRole('button', { name: /my watched warrants/i });
    await userEvent.click(chip);
    await waitFor(() => {
      expect(screen.getByTestId('location-search').textContent).toContain('watched_only=1');
    });
  });

  it('pre-checks "My Watched Warrants" on mount when the URL already has watched_only=1', async () => {
    renderTabWithLocationProbe({}, ['/warrants?watched_only=1']);
    await waitFor(() => expect(useApiModule.apiFetch).toHaveBeenCalled());
    const chip = await screen.findByRole('button', { name: /my watched warrants/i });
    await waitFor(() => {
      expect(chip.className).toContain('bg-[var(--brand-gold)]');
    });
  });
});

describe('WarrantsListTab — watch/unwatch action', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    openMenuMock.mockClear();
  });

  it('POSTs to /intel/watchlist when watching an unwatched warrant via the context menu', async () => {
    vi.spyOn(useApiModule, 'apiFetch').mockImplementation(async (path: string) => {
      if (String(path).includes('/warrants/unified')) {
        return { warrants: [{ id: 10, warrant_number: 'W-10', status: 'active', subject_name: 'Jane Roe', subject_person_id: null }], total: 1 };
      }
      if (String(path) === '/intel/watchlist') return []; // useWatchedWarrantIds' own fetch — no watches yet
      return {};
    });
    renderTab();
    const row = await screen.findByText('W-10');
    row.closest('tr, div')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));

    await waitFor(() => expect(openMenuMock).toHaveBeenCalled());
    const menuItems = openMenuMock.mock.calls[openMenuMock.mock.calls.length - 1]?.[1] as { label: string; onClick: () => void }[] | undefined;
    const watchItem = menuItems?.find((i) => /watch this warrant/i.test(i.label));
    expect(watchItem).toBeTruthy();

    await act(async () => { await watchItem!.onClick(); });
    expect(useApiModule.apiFetch).toHaveBeenCalledWith('/intel/watchlist', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"entity_type":"warrant"'),
    }));
  });

  it('labels the menu item "Unwatch this warrant" when the warrant is already watched', async () => {
    vi.doMock('../useWatchedWarrantIds', () => ({
      useWatchedWarrantIds: () => ({ watchedIds: new Set([10]), refresh: vi.fn() }),
    }));
    vi.resetModules();
    const { default: WarrantsListTabReloaded } = await import('../WarrantsListTab');
    // `vi.resetModules()` gives the reloaded component its own fresh copy of
    // `useApi` — the top-level `useApiModule` import in this file is a
    // different (stale) module instance after the reset, so spying on it
    // would leave the reloaded component's real `apiFetch` unmocked. Import
    // the fresh instance (same specifier resolves to the same cached module
    // the reloaded component already pulled in) and spy on that instead.
    const freshApiModule = await import('../../../hooks/useApi');
    vi.spyOn(freshApiModule, 'apiFetch').mockImplementation(async (path: string) => {
      if (String(path).includes('/warrants/unified')) {
        return { warrants: [{ id: 10, warrant_number: 'W-10', status: 'active', subject_name: 'Jane Roe', subject_person_id: null }], total: 1 };
      }
      return [];
    });
    render(<MemoryRouter><WarrantsListTabReloaded {...baseProps} /></MemoryRouter>);
    const row = await screen.findByText('W-10');
    row.closest('tr, div')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    await waitFor(() => expect(openMenuMock).toHaveBeenCalled());
    const menuItems = openMenuMock.mock.calls[openMenuMock.mock.calls.length - 1]?.[1] as { label: string }[] | undefined;
    expect(menuItems?.some((i) => /unwatch this warrant/i.test(i.label))).toBe(true);
  });
});
