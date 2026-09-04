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
// Clock success/warning toasts are surfaced via useToast() in handleMileageModalSuccess;
// without a real ToastProvider in the tree it throws "useToast must be used
// within a ToastProvider". Mock it and capture calls for assertions.
const addToastMock = vi.fn();
vi.mock('../ToastProvider', () => ({
  useToast: () => ({ addToast: addToastMock }),
}));
// ClockInOutMileageModal is now the intermediary for all clock-in/out actions.
// Mock it so tests can drive the happy-path without rendering the real form
// (which requires mileage entry, vehicle selection, and its own API calls).
vi.mock('../time/ClockInOutMileageModal', () => ({
  default: ({ isOpen, onSuccess, isClockingOut, onClose }: any) => {
    if (!isOpen) return null;
    return (
      <div data-testid="mileage-modal" data-clocking-out={String(isClockingOut)}>
        <button data-testid="modal-submit" onClick={() => onSuccess({})}>Submit</button>
        <button data-testid="modal-cancel" onClick={onClose}>Cancel</button>
      </div>
    );
  },
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

  it('shows Clock In when off duty, and clicking it opens the mileage modal in clock-in mode', async () => {
    apiFetchMock.mockImplementation((path: string) => path === '/personnel/time/mine/active'
      ? Promise.resolve({ active: false, entry: null })
      : Promise.resolve({}));
    openLauncher();
    await waitFor(() => expect(screen.getByText('Clock In')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Clock In'));
    await waitFor(() => expect(screen.getByTestId('mileage-modal')).toBeInTheDocument());
    expect(screen.getByTestId('mileage-modal').getAttribute('data-clocking-out')).toBe('false');
  });

  it('shows Clock Out when on duty, and clicking it opens the mileage modal in clock-out mode', async () => {
    apiFetchMock.mockImplementation((path: string) => path === '/personnel/time/mine/active'
      ? Promise.resolve({ active: true, entry: { clock_in: new Date().toISOString() } })
      : Promise.resolve({}));
    openLauncher();
    await waitFor(() => expect(screen.getByText('Clock Out')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Clock Out'));
    await waitFor(() => expect(screen.getByTestId('mileage-modal')).toBeInTheDocument());
    expect(screen.getByTestId('mileage-modal').getAttribute('data-clocking-out')).toBe('true');
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

  it('shows a success toast after confirming clock-in through the mileage modal', async () => {
    apiFetchMock.mockResolvedValue({ active: false, entry: null });
    openLauncher();
    await waitFor(() => expect(screen.getByText('Clock In')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Clock In'));
    await waitFor(() => expect(screen.getByTestId('mileage-modal')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('modal-submit'));
    await waitFor(() => expect(addToastMock).toHaveBeenCalledWith('Clocked in successfully', 'success'));
  });

  it('rapid double-click on the clock toggle only opens the modal once (in-flight guard)', async () => {
    apiFetchMock.mockResolvedValue({ active: false, entry: null });
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
    // The idempotent setMileageModalOpen(true) call on the second invocation
    // must not produce a second modal in the DOM.
    act(() => {
      clockButton.click();
      clockButton.click();
    });

    await waitFor(() => expect(screen.getAllByTestId('mileage-modal')).toHaveLength(1));
  });
});
