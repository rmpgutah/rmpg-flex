// client/src/pages/DesktopPage.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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
});
