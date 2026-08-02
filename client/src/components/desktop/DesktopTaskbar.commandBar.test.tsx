import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const apiFetchMock = vi.fn();
vi.mock('../../hooks/useApi', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }));
vi.mock('../../hooks/useClock', () => ({ useClock: () => ({ time: '12:00:00', date: 'x' }) }));
// DesktopTaskbar calls useAuth() (for the clock-in/out officer id); without a real
// AuthProvider in the tree it throws "useAuth must be used within an AuthProvider".
// Mock it the same way DesktopPage.test.tsx / ModuleDirectoryPage.test.tsx do.
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: '1', role: 'officer' } }),
}));
// Clock in/out failures are surfaced via useToast() (see handleClockToggle);
// without a real ToastProvider in the tree it throws "useToast must be used
// within a ToastProvider". Mock it the same way useAuth is mocked above, and
// capture calls so the error-surfacing test can assert on them.
const addToastMock = vi.fn();
vi.mock('../ToastProvider', () => ({
  useToast: () => ({ addToast: addToastMock }),
}));

const navigateMock = vi.fn();
vi.mock('react-router', async (orig) => ({ ...(await orig<any>()), useNavigate: () => navigateMock }));

import DesktopTaskbar from './DesktopTaskbar';
import { DesktopWindowManagerProvider } from './DesktopWindowManager';

describe('DesktopTaskbar — command bar quick actions', () => {
  beforeEach(() => { apiFetchMock.mockReset(); navigateMock.mockReset(); addToastMock.mockReset(); });

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

  it('surfaces a visible toast when the clock-in call fails', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path === '/personnel/time/mine/active') return Promise.resolve({ active: false, entry: null });
      if (path === '/personnel/time/clock-in') return Promise.reject(new Error('Already clocked in'));
      return Promise.resolve({});
    });
    openLauncher();
    await waitFor(() => expect(screen.getByText('Clock In')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Clock In'));
    await waitFor(() => expect(addToastMock).toHaveBeenCalledWith('Already clocked in', 'error'));
  });

  it('rapid double-click on the clock toggle only fires the endpoint once (in-flight guard)', async () => {
    let resolveClockIn: (() => void) | undefined;
    apiFetchMock.mockImplementation((path: string) => {
      if (path === '/personnel/time/mine/active') return Promise.resolve({ active: false, entry: null });
      if (path === '/personnel/time/clock-in') {
        return new Promise<void>(resolve => { resolveClockIn = () => resolve(); });
      }
      return Promise.resolve({});
    });
    openLauncher();
    await waitFor(() => expect(screen.getByText('Clock In')).toBeInTheDocument());
    const clockButton = screen.getByText('Clock In');

    // Two separate `fireEvent.click(...)` statements each get wrapped in
    // their own act() by React Testing Library, which flushes the pending
    // setClockBusy(true) state update and commits a re-render — with a
    // fresh handleClockToggle closure reading clockBusy === true — BEFORE
    // the second statement runs. That means the `clockBusy` state guard
    // alone already blocks the second click in that shape of test, and the
    // race the ref exists to prevent never actually manifests (confirmed:
    // temporarily removing `|| clockToggleInFlightRef.current` from the
    // guard in DesktopTaskbar.tsx and rerunning a two-`fireEvent.click`
    // version of this test still passed).
    //
    // Firing both native `.click()` calls inside a SINGLE synchronous
    // `act(() => { ... })` block avoids that intermediate flush: React only
    // commits/re-renders once the act() callback returns, so both
    // invocations run synchronously back-to-back against the SAME
    // pre-update closure — both reading stale `clockBusy === false` — which
    // is exactly the race `clockToggleInFlightRef` exists to close.
    act(() => {
      clockButton.click();
      clockButton.click();
    });

    resolveClockIn?.();
    await waitFor(() => expect(apiFetchMock.mock.calls.filter(c => c[0] === '/personnel/time/clock-in').length).toBe(1));
  });
});
