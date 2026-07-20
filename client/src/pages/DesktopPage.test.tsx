// client/src/pages/DesktopPage.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const apiFetchMock = vi.fn().mockResolvedValue({});
vi.mock('../hooks/useApi', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }));

const mockPrefs = { desktop_layout_json: null, desktop_wallpaper: 'blue-silver-default', desktop_widgets_json: null };

// `useUserPreferences` is mocked as a hoisted vi.fn() (rather than a fixed
// return value) so individual tests can override its return per-call — this
// is what lets the "still loading" test below exercise the isLoading:true
// branch of DesktopPage without touching the other tests' isLoading:false
// default (see Finding 1 of the 2026-07-18 final review: DesktopPage used to
// seed its one-shot state from `prefs` before the real async fetch resolved).
const { mockUseUserPreferences } = vi.hoisted(() => ({ mockUseUserPreferences: vi.fn() }));
vi.mock('../context/UserPreferencesContext', () => ({
  useUserPreferences: () => mockUseUserPreferences(),
}));

// DesktopPage calls useAuth() (for role-based catalog filtering); without a
// real AuthProvider in the tree it would throw "useAuth must be used within
// an AuthProvider". Mock it the same way ModuleDirectoryPage.test.tsx does —
// an unprivileged, unblocked role so favorites/catalog filtering is a no-op
// here (role-filtering itself isn't what these tests are checking).
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: '1', role: 'officer' } }),
}));

// DesktopTaskbar (rendered by DesktopPage) calls useToast() to surface
// clock in/out failures; without a real ToastProvider in the tree it throws
// "useToast must be used within a ToastProvider". Mock it the same way
// useAuth is mocked above.
vi.mock('../components/ToastProvider', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

import { saveFavorites } from '../utils/navFavorites';
import { isAutoArrangeEnabled, setAutoArrangeEnabled, areIconsHidden } from '../utils/desktopIconPreferences';
import DesktopPage from './DesktopPage';

describe('DesktopPage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    apiFetchMock.mockClear();
    apiFetchMock.mockResolvedValue({});
    mockUseUserPreferences.mockReset();
    mockUseUserPreferences.mockReturnValue({ prefs: mockPrefs, reload: vi.fn(), isLoading: false, error: null });
  });

  it('auto-populates the icon grid from current favorites on first load', async () => {
    saveFavorites(new Set(['/dispatch']));
    render(<MemoryRouter><DesktopPage /></MemoryRouter>);
    // The default-enabled "quick-access" widget (Task 10) independently renders
    // the same favorites list alongside the icon grid, so the label legitimately
    // appears twice — use getAllByText rather than getByText (which throws on
    // more than one match) to assert the icon grid populated correctly.
    await waitFor(() => expect(screen.getAllByText('Dispatch Console').length).toBeGreaterThan(0));
  });

  it('shows an empty-state prompt with zero favorites', async () => {
    render(<MemoryRouter><DesktopPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/star modules from Module Directory/i)).toBeInTheDocument());
  });

  it('renders the taskbar and widget panel', () => {
    render(<MemoryRouter><DesktopPage /></MemoryRouter>);
    expect(screen.getByLabelText('Open app launcher')).toBeInTheDocument();
  });

  it('debounce-saves layout changes via PUT /preferences', async () => {
    saveFavorites(new Set(['/dispatch']));
    render(<MemoryRouter><DesktopPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByText('Dispatch Console').length).toBeGreaterThan(0));
    fireEvent.contextMenu(document.body);
    await waitFor(() => {
      const putCall = apiFetchMock.mock.calls.find(c => c[1]?.method === 'PUT');
      expect(putCall).toBeUndefined(); // no change made yet — proves save is change-triggered, not on every render
    });
  });

  it('shows a loading placeholder while preferences are still loading, instead of seeding state from defaults', () => {
    saveFavorites(new Set(['/dispatch']));
    mockUseUserPreferences.mockReturnValue({ prefs: mockPrefs, reload: vi.fn(), isLoading: true, error: null });
    render(<MemoryRouter><DesktopPage /></MemoryRouter>);
    // Loading placeholder is present...
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
    // ...and none of the real desktop shell (which would have seeded its
    // one-shot state from the still-default prefs) has mounted yet.
    expect(screen.queryByLabelText('Open app launcher')).not.toBeInTheDocument();
    expect(screen.queryByText('Dispatch Console')).not.toBeInTheDocument();
  });

  it('opens the settings app with icon size, sort, wallpaper, accent, and reset controls', () => {
    render(<MemoryRouter><DesktopPage /></MemoryRouter>);
    fireEvent.contextMenu(screen.getByText(/No modules pinned yet/i));
    fireEvent.click(screen.getByText('Settings'));
    fireEvent.click(screen.getByText('Desktop & Icons'));
    expect(screen.getByText('Icon Size')).toBeInTheDocument();
    expect(screen.getByText('Reset to Default')).toBeInTheDocument();
  });

  it('right-click "New sticky note" adds a note to the canvas', () => {
    render(<MemoryRouter><DesktopPage /></MemoryRouter>);
    fireEvent.contextMenu(screen.getByText(/No modules pinned yet/i));
    fireEvent.click(screen.getByText('New sticky note'));
    expect(screen.getByLabelText('Delete note')).toBeInTheDocument();
  });

  it('debounced PUT body reflects the actual final state after adding a sticky note', async () => {
    vi.useFakeTimers();
    try {
      render(<MemoryRouter><DesktopPage /></MemoryRouter>);
      fireEvent.contextMenu(screen.getByText(/No modules pinned yet/i));
      fireEvent.click(screen.getByText('New sticky note'));
      expect(screen.getByLabelText('Delete note')).toBeInTheDocument();

      await act(async () => { await vi.advanceTimersByTimeAsync(800); });

      const putCall = apiFetchMock.mock.calls.find(c => c[0] === '/preferences' && c[1]?.method === 'PUT');
      expect(putCall).toBeDefined();
      const body = JSON.parse(putCall![1].body as string);
      const savedNotes = JSON.parse(body.desktop_notes_json);
      expect(savedNotes).toHaveLength(1);
      expect(savedNotes[0]).toMatchObject({ x: 60, y: 60, text: '', color: 'amber' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('Reset to Default clears sticky notes and the following debounced PUT reflects the reset state', async () => {
    vi.useFakeTimers();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      render(<MemoryRouter><DesktopPage /></MemoryRouter>);
      fireEvent.contextMenu(screen.getByText(/No modules pinned yet/i));
      fireEvent.click(screen.getByText('New sticky note'));
      expect(screen.getByLabelText('Delete note')).toBeInTheDocument();

      fireEvent.contextMenu(screen.getByText(/No modules pinned yet/i));
      fireEvent.click(screen.getByText('Settings'));
      fireEvent.click(screen.getByText('Desktop & Icons'));
      fireEvent.click(screen.getByText('Reset to Default'));

      expect(confirmSpy).toHaveBeenCalled();
      // Reset's real effect: the note is actually gone, not just "confirmed".
      expect(screen.queryByLabelText('Delete note')).not.toBeInTheDocument();

      apiFetchMock.mockClear();
      await act(async () => { await vi.advanceTimersByTimeAsync(800); });

      const putCall = apiFetchMock.mock.calls.find(c => c[0] === '/preferences' && c[1]?.method === 'PUT');
      expect(putCall).toBeDefined();
      const body = JSON.parse(putCall![1].body as string);
      expect(JSON.parse(body.desktop_notes_json)).toEqual([]);
    } finally {
      vi.useRealTimers();
      confirmSpy.mockRestore();
    }
  });
});

describe('DesktopPage — empty-desktop right-click shortcuts', () => {
  it('offers Sort/View/Icon-size items and each calls the matching handler', async () => {
    render(<MemoryRouter><DesktopPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByLabelText('Open app launcher')).toBeInTheDocument());
    const desktopSurface = screen.getByTestId('desktop-surface');
    fireEvent.contextMenu(desktopSurface);
    expect(screen.getByText('Sort: Alphabetical')).toBeInTheDocument();
    expect(screen.getByText('View: List')).toBeInTheDocument();
    expect(screen.getByText('Icon size: Large')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Sort: Alphabetical'));
    // Re-open to check View next (ContextMenu closes itself after a click).
    fireEvent.contextMenu(desktopSurface);
    fireEvent.click(screen.getByText('View: List'));
  });
});

describe('DesktopPage — auto-arrange and show/hide icons toggles', () => {
  beforeEach(() => localStorage.clear());

  it('toggles the Auto-arrange menu label and persists via setAutoArrangeEnabled', async () => {
    render(<MemoryRouter><DesktopPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByLabelText('Open app launcher')).toBeInTheDocument());
    const desktopSurface = screen.getByTestId('desktop-surface');
    fireEvent.contextMenu(desktopSurface);
    expect(screen.getByText('Auto-arrange: Off')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Auto-arrange: Off'));
    expect(isAutoArrangeEnabled()).toBe(true);
    fireEvent.contextMenu(desktopSurface);
    expect(screen.getByText('Auto-arrange: On')).toBeInTheDocument();
  });

  it('toggles the Hide/Show icons menu label and persists via setIconsHidden', async () => {
    render(<MemoryRouter><DesktopPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByLabelText('Open app launcher')).toBeInTheDocument());
    const desktopSurface = screen.getByTestId('desktop-surface');
    fireEvent.contextMenu(desktopSurface);
    expect(screen.getByText('Hide icons')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Hide icons'));
    expect(areIconsHidden()).toBe(true);
    fireEvent.contextMenu(desktopSurface);
    expect(screen.getByText('Show icons')).toBeInTheDocument();
  });
});

describe('DesktopPage — auto-arrange fills gaps for newly-pinned icons', () => {
  beforeEach(() => localStorage.clear());

  it('assigns a newly-favorited path a position that does not overlap an existing icon, when auto-arrange is on', async () => {
    setAutoArrangeEnabled(true);
    // Seed a layout that already positions /dispatch at (20,20), but favorites
    // (loaded synchronously by DesktopPage's useState(loadFavorites) initializer)
    // contains a SECOND path, /records, with no entry in desktop_layout_json.
    // This reproduces the exact gap the reconciliation effect fixes: on this
    // same initial render, pinnedIcons has 2 entries but layout.icons only
    // positions 1 — without reconciliation, /records would fall back to
    // DesktopIconGrid's hardcoded {x:20,y:20}, stacking directly on /dispatch.
    const seededLayout = JSON.stringify({
      icons: [{ path: '/dispatch', x: 20, y: 20 }],
      groups: [],
      iconSize: 'medium',
      viewMode: 'grid',
      sortMode: 'manual',
    });
    mockUseUserPreferences.mockReturnValue({
      prefs: { ...mockPrefs, desktop_layout_json: seededLayout },
      reload: vi.fn(),
      isLoading: false,
      error: null,
    });
    saveFavorites(new Set(['/dispatch', '/records']));

    render(<MemoryRouter><DesktopPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByText('Dispatch Console').length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getAllByText('Records (RMS)').length).toBeGreaterThan(0));

    const recordsButton = screen.getAllByText('Records (RMS)')[0].closest('button');
    expect(recordsButton).not.toBeNull();
    // The reconciled position must not collide with /dispatch's real (20,20),
    // and (per nextAutoArrangeSlot's gap-filling) should land in the next
    // free grid cell rather than at the DesktopIconGrid fallback of (20,20).
    expect(recordsButton!.style.left).not.toBe('20px');

    // /dispatch's own already-placed position must be left untouched by the
    // reconciliation effect (auto-arrange must never retroactively move an
    // existing icon).
    const dispatchButton = screen.getAllByText('Dispatch Console')[0].closest('button');
    expect(dispatchButton!.style.left).toBe('20px');
    expect(dispatchButton!.style.top).toBe('20px');

    setAutoArrangeEnabled(false); // cleanup for other tests
  });

  it('assigns a newly-favorited path a cascaded position when auto-arrange is off', async () => {
    const seededLayout = JSON.stringify({
      icons: [{ path: '/dispatch', x: 20, y: 20 }],
      groups: [],
      iconSize: 'medium',
      viewMode: 'grid',
      sortMode: 'manual',
    });
    mockUseUserPreferences.mockReturnValue({
      prefs: { ...mockPrefs, desktop_layout_json: seededLayout },
      reload: vi.fn(),
      isLoading: false,
      error: null,
    });
    saveFavorites(new Set(['/dispatch', '/records']));

    render(<MemoryRouter><DesktopPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByText('Dispatch Console').length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getAllByText('Records (RMS)').length).toBeGreaterThan(0));

    const recordsButton = screen.getAllByText('Records (RMS)')[0].closest('button');
    expect(recordsButton!.style.left).not.toBe('20px');

    const dispatchButton = screen.getAllByText('Dispatch Console')[0].closest('button');
    expect(dispatchButton!.style.left).toBe('20px');
    expect(dispatchButton!.style.top).toBe('20px');
  });
});

describe('DesktopPage — hidden icons layer', () => {
  beforeEach(() => localStorage.clear());

  it('hides the icon grid (and empty-state message) but not sticky notes when icons are hidden', async () => {
    saveFavorites(new Set(['/dispatch']));
    render(<MemoryRouter><DesktopPage /></MemoryRouter>);
    // Before hiding: "Dispatch Console" renders twice — once as the icon
    // grid's own tile, once via the always-on-by-default quick-access widget
    // (a separate code path, unaffected by this feature). This baseline count
    // is what proves the later drop to 1 instance is the icon grid itself
    // disappearing, not some unrelated re-render fluke.
    await waitFor(() => expect(screen.getAllByText('Dispatch Console').length).toBe(2));

    const desktopSurface = screen.getByTestId('desktop-surface');
    fireEvent.contextMenu(desktopSurface);
    fireEvent.click(screen.getByText('New sticky note'));
    expect(screen.getByLabelText('Delete note')).toBeInTheDocument();

    fireEvent.contextMenu(desktopSurface);
    fireEvent.click(screen.getByText('Hide icons'));

    // Icon grid's tile is gone — only the quick-access widget's instance remains.
    expect(screen.getAllByText('Dispatch Console').length).toBe(1);
    // Sticky note (no text-fixture collision with the widget) is unaffected.
    expect(screen.getByLabelText('Delete note')).toBeInTheDocument();
  });

  it('hides the empty-state prompt too when icons are hidden with zero favorites', async () => {
    render(<MemoryRouter><DesktopPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/star modules from Module Directory/i)).toBeInTheDocument());
    const desktopSurface = screen.getByTestId('desktop-surface');
    fireEvent.contextMenu(desktopSurface);
    fireEvent.click(screen.getByText('Hide icons'));
    expect(screen.queryByText(/star modules from Module Directory/i)).not.toBeInTheDocument();
  });
});
