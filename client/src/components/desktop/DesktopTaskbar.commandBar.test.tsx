import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const apiFetchMock = vi.fn();
vi.mock('../../hooks/useApi', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }));
vi.mock('../../hooks/useClock', () => ({ useClock: () => ({ time: '12:00:00', date: 'x' }) }));
// DesktopTaskbar calls useAuth() (for the clock-in/out officer id); without a real
// AuthProvider in the tree it throws "useAuth must be used within an AuthProvider".
// Mock it the same way DesktopPage.test.tsx / ModuleDirectoryPage.test.tsx do.
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: '1', role: 'officer' } }),
}));

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<any>()), useNavigate: () => navigateMock }));

import DesktopTaskbar from './DesktopTaskbar';
import { DesktopWindowManagerProvider } from './DesktopWindowManager';

describe('DesktopTaskbar — command bar quick actions', () => {
  beforeEach(() => { apiFetchMock.mockReset(); navigateMock.mockReset(); });

  function openLauncher() {
    render(<MemoryRouter><DesktopWindowManagerProvider><DesktopTaskbar icons={[]} catalog={[]} /></DesktopWindowManagerProvider></MemoryRouter>);
    fireEvent.click(screen.getByLabelText('Open app launcher'));
  }

  it('shows Clock In when off duty, and clicking it calls the clock-in endpoint', async () => {
    apiFetchMock.mockImplementation((path: string) => path === '/personnel/time/mine/active'
      ? Promise.resolve({ active: false, entry: null })
      : Promise.resolve({}));
    openLauncher();
    await waitFor(() => expect(screen.getByText('Clock In')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Clock In'));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/personnel/time/clock-in', expect.objectContaining({ method: 'POST' })));
  });

  it('shows Clock Out when on duty, and clicking it calls the clock-out endpoint', async () => {
    apiFetchMock.mockImplementation((path: string) => path === '/personnel/time/mine/active'
      ? Promise.resolve({ active: true, entry: { clock_in: new Date().toISOString() } })
      : Promise.resolve({}));
    openLauncher();
    await waitFor(() => expect(screen.getByText('Clock Out')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Clock Out'));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/personnel/time/clock-out', expect.objectContaining({ method: 'POST' })));
  });

  it('New Call navigates to /dispatch?newCall=1, New Incident to /incidents?newIncident=1', async () => {
    apiFetchMock.mockResolvedValue({ active: false, entry: null });
    openLauncher();
    await waitFor(() => expect(screen.getByText('New Call')).toBeInTheDocument());
    fireEvent.click(screen.getByText('New Call'));
    expect(navigateMock).toHaveBeenCalledWith('/dispatch?newCall=1');
    fireEvent.click(screen.getByLabelText('Open app launcher'));
    fireEvent.click(screen.getByText('New Incident'));
    expect(navigateMock).toHaveBeenCalledWith('/incidents?newIncident=1');
  });
});
