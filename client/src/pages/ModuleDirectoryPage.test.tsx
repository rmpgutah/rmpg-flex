import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const apiFetchMock = vi.fn().mockResolvedValue({});
vi.mock('../hooks/useApi', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: '1', role: 'officer' } }),
}));

import ModuleDirectoryPage from './ModuleDirectoryPage';
import { isAppPinned } from '../utils/taskbarPreferences';

describe('ModuleDirectoryPage (post-catalog-extraction regression)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    apiFetchMock.mockClear();
  });

  it('renders category navigation from the extracted NAV_CATEGORIES', () => {
    render(<MemoryRouter><ModuleDirectoryPage /></MemoryRouter>);
    expect(screen.getByText(/Modules/i)).toBeInTheDocument();
    expect(screen.getAllByText(/functions/i).length).toBeGreaterThan(0);
  });

  it('search filters the catalog down to matching modules', () => {
    render(<MemoryRouter><ModuleDirectoryPage /></MemoryRouter>);
    const search = screen.getByPlaceholderText(/Search modules/i);
    fireEvent.change(search, { target: { value: 'Dispatch Console' } });
    expect(screen.getByText('Dispatch Console')).toBeInTheDocument();
    expect(screen.queryByText('Body Cameras')).not.toBeInTheDocument();
  });

  it('favoriting a module persists to the shared FAVORITES_KEY in localStorage', () => {
    render(<MemoryRouter><ModuleDirectoryPage /></MemoryRouter>);
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

  it('right-clicking a module card offers "Pin to Taskbar"', () => {
    render(<MemoryRouter><ModuleDirectoryPage /></MemoryRouter>);
    const search = screen.getByPlaceholderText(/Search modules/i);
    fireEvent.change(search, { target: { value: 'Dispatch Console' } });
    fireEvent.contextMenu(screen.getByText('Dispatch Console'));
    expect(screen.getByText('Pin to Taskbar')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Pin to Taskbar'));
    expect(isAppPinned('/dispatch')).toBe(true);
  });
});
