import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const apiFetchMock = vi.fn().mockResolvedValue({});
vi.mock('../hooks/useApi', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: '1', role: 'officer' } }),
}));
vi.mock('../utils/featureFlags', () => ({
  isFeatureEnabled: vi.fn(() => true),
  useFeatureFlags: vi.fn(() => 0),
}));

import ModuleDirectoryPage from './ModuleDirectoryPage';
import { isAppPinned } from '../utils/taskbarPreferences';
import { isFeatureEnabled, useFeatureFlags } from '../utils/featureFlags';

describe('ModuleDirectoryPage (post-catalog-extraction regression)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    apiFetchMock.mockClear();
  });

  it('renders category navigation from the extracted NAV_CATEGORIES', async () => {
    await act(async () => { render(<MemoryRouter><ModuleDirectoryPage /></MemoryRouter>); });
    expect(screen.getByText(/Modules/i)).toBeInTheDocument();
    expect(screen.getAllByText(/functions/i).length).toBeGreaterThan(0);
  });

  it('search filters the catalog down to matching modules', async () => {
    await act(async () => { render(<MemoryRouter><ModuleDirectoryPage /></MemoryRouter>); });
    const search = screen.getByPlaceholderText(/Search modules/i);
    fireEvent.change(search, { target: { value: 'Dispatch Console' } });
    expect(screen.getByText('Dispatch Console')).toBeInTheDocument();
    expect(screen.queryByText('Body Cameras')).not.toBeInTheDocument();
  });

  it('favoriting a module persists to the shared FAVORITES_KEY in localStorage', async () => {
    await act(async () => { render(<MemoryRouter><ModuleDirectoryPage /></MemoryRouter>); });
    const search = screen.getByPlaceholderText(/Search modules/i);
    fireEvent.change(search, { target: { value: 'Dispatch Console' } });
    const star = screen.getByLabelText(/Add Dispatch Console to favorites/i);
    fireEvent.click(star);
    expect(JSON.parse(localStorage.getItem('rmpg_nav_favorites')!)).toContain('/dispatch');
  });
});

describe('ModuleDirectoryPage — Pin to Taskbar', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    apiFetchMock.mockClear();
  });

  it('right-clicking a module card offers "Pin to Taskbar"', async () => {
    await act(async () => { render(<MemoryRouter><ModuleDirectoryPage /></MemoryRouter>); });
    const search = screen.getByPlaceholderText(/Search modules/i);
    fireEvent.change(search, { target: { value: 'Dispatch Console' } });
    fireEvent.contextMenu(screen.getByText('Dispatch Console'));
    expect(screen.getByText('Pin to Taskbar')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Pin to Taskbar'));
    expect(isAppPinned('/dispatch')).toBe(true);
  });
});

describe('ModuleDirectoryPage — feature-toggle gating', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    apiFetchMock.mockClear();
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
  });

  it('hides Fleet Management when feature_fleet is disabled', async () => {
    vi.mocked(isFeatureEnabled).mockImplementation((path: string) => path !== '/fleet');
    await act(async () => { render(<MemoryRouter><ModuleDirectoryPage /></MemoryRouter>); });
    const search = screen.getByPlaceholderText(/Search modules/i);
    fireEvent.change(search, { target: { value: 'Fleet Management' } });
    expect(screen.queryByText('Fleet Management')).not.toBeInTheDocument();
  });

  it('shows Fleet Management when feature_fleet is enabled', async () => {
    await act(async () => { render(<MemoryRouter><ModuleDirectoryPage /></MemoryRouter>); });
    const search = screen.getByPlaceholderText(/Search modules/i);
    fireEvent.change(search, { target: { value: 'Fleet Management' } });
    expect(screen.getByText('Fleet Management')).toBeInTheDocument();
  });

  it('recomputes visibleCategories and hides Fleet Management after flagsTick changes on a rerender (no prop change)', async () => {
    let mockTick = 0;
    vi.mocked(useFeatureFlags).mockImplementation(() => mockTick);
    vi.mocked(isFeatureEnabled).mockReturnValue(true);

    // A fresh element on each call (not a reused reference) — passing the
    // literal same element object to rerender() lets React bail out via
    // referential-equality of props and never re-invoke the component at
    // all, which would make this test pass vacuously regardless of whether
    // flagsTick is wired correctly.
    const renderUi = () => <MemoryRouter><ModuleDirectoryPage /></MemoryRouter>;
    let rerender!: ReturnType<typeof render>['rerender'];
    await act(async () => { ({ rerender } = render(renderUi())); });
    const search = screen.getByPlaceholderText(/Search modules/i);
    fireEvent.change(search, { target: { value: 'Fleet Management' } });
    expect(screen.getByText('Fleet Management')).toBeInTheDocument();

    // Simulate a real flag reload: isFeatureEnabled's underlying data changes
    // AND the tick increments — then rerender with IDENTICAL prop/search
    // VALUES. If flagsTick were ever dropped from visibleCategories's
    // dependency array, the memoized value would stay stale (searchQuery
    // hasn't changed) and Fleet Management would still show.
    vi.mocked(isFeatureEnabled).mockImplementation((path: string) => path !== '/fleet');
    mockTick = 1;
    rerender(renderUi());

    expect(screen.queryByText('Fleet Management')).not.toBeInTheDocument();
  });
});
