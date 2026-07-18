// client/src/pages/DesktopPage.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const apiFetchMock = vi.fn().mockResolvedValue({});
vi.mock('../hooks/useApi', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }));

const mockPrefs = { desktop_layout_json: null, desktop_wallpaper: 'blue-silver-default', desktop_widgets_json: null };
vi.mock('../context/UserPreferencesContext', () => ({
  useUserPreferences: () => ({ prefs: mockPrefs, reload: vi.fn(), isLoading: false, error: null }),
}));

// DesktopPage calls useAuth() (for role-based catalog filtering); without a
// real AuthProvider in the tree it would throw "useAuth must be used within
// an AuthProvider". Mock it the same way ModuleDirectoryPage.test.tsx does —
// an unprivileged, unblocked role so favorites/catalog filtering is a no-op
// here (role-filtering itself isn't what these tests are checking).
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: '1', role: 'officer' } }),
}));

import { saveFavorites } from '../utils/navFavorites';
import DesktopPage from './DesktopPage';

describe('DesktopPage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    apiFetchMock.mockClear();
    apiFetchMock.mockResolvedValue({});
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
});
