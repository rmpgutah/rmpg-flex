import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router';

// ── Regression target ────────────────────────────────────────────────────
// Layout.tsx (lines ~819-836, ~1765-1774) gates the React.lazy-imported
// UserProfileModal behind a "mount latch": profileModalEverOpened. React.lazy
// fetches its chunk the instant the component is COMMITTED to the tree,
// regardless of the `isOpen` prop, so:
//   - an unconditional render would fetch the UserProfileModal+SignaturePad
//     chunk on every authenticated page load (Regression 1)
//   - a naive `{profileModalOpen && ...}` gate would unmount the modal (and
//     kill its close/exit transition) the instant it closes (Regression 2)
// This test pins all three states so either regression fails a real assertion
// instead of silently passing typecheck/lint.

// ── Mock every heavy child Layout renders — none of their internals matter
// here, only that UserProfileModal specifically mounts/stays mounted. ──
vi.mock('../MenuBar', () => ({ default: () => null }));
vi.mock('../StatusBar', () => ({ default: () => null }));
vi.mock('../NotificationCenter', () => ({ default: () => null }));
vi.mock('../PanicButton', () => ({ default: () => null }));
vi.mock('../DispatcherTranscript', () => ({ default: () => null }));
vi.mock('../mobile/MobileHeader', () => ({ default: () => null }));
vi.mock('../mobile/MobileDrawer', () => ({ default: () => null }));
vi.mock('../mobile/MobileBottomNav', () => ({ default: () => null }));
vi.mock('../mobile/MobileContextBar', () => ({ default: () => null }));
vi.mock('../AnnouncementBanner', () => ({ default: () => null }));
vi.mock('../UpdateBanner', () => ({ default: () => null }));
vi.mock('../CommandPalette', () => ({ default: () => null }));
vi.mock('../ForcePasswordChangeModal', () => ({ default: () => null }));
vi.mock('../Force2FASetupModal', () => ({ default: () => null }));
vi.mock('../LocationGate', () => ({ default: () => null }));
vi.mock('../DispatchAlertBanner', () => ({ default: () => null }));
vi.mock('../PttController', () => ({ default: () => null }));
// ErrorBoundary just wraps <Outlet/> — render children through untouched via
// a trivial passthrough so <Outlet/> (and therefore the route content) still
// renders, without pulling in the real error-boundary machinery.
vi.mock('../ErrorBoundary', () => ({ default: ({ children }: { children?: React.ReactNode }) => children }));

// UserProfileModal is React.lazy-imported in Layout.tsx. Mocking the module
// it resolves to lets us assert mount/unmount of a simple stub instead of
// fighting React.lazy/Suspense resolution timing in jsdom — we only care
// whether *an* instance of UserProfileModal is in the tree, not its internals.
const onCloseSpy = vi.fn();
vi.mock('../UserProfileModal', () => ({
  default: (props: { isOpen: boolean; onClose: () => void; initialTab: string }) => {
    onCloseSpy.mockImplementation(props.onClose);
    return <div data-testid="user-profile-modal" data-open={String(props.isOpen)} />;
  },
}));

// ── Hooks Layout consumes directly ──────────────────────────────────────
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: {
      id: 1,
      first_name: 'Test',
      last_name: 'Officer',
      email: 'test@rmpgutah.us',
      role: 'officer',
      profile_image: null,
      badge_number: 'T-100',
    },
    logout: vi.fn(),
    signOut: vi.fn().mockResolvedValue({ ok: true }),
    refreshUser: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../../context/WebSocketContext', () => ({
  useWebSocket: () => ({
    isConnected: true,
    subscribe: () => () => {},
    send: vi.fn(),
  }),
}));

vi.mock('../../hooks/useGpsTracking', () => ({
  useGpsTracking: () => ({
    latitude: null,
    longitude: null,
    accuracy: null,
    heading: null,
    speed: null,
    isTracking: false,
    permissionDenied: false,
    permissionPending: false,
    error: null,
    connectionType: null,
    positionSource: null,
    lastSentAt: null,
    unitCallSign: null,
    startTracking: vi.fn(),
    stopTracking: vi.fn(),
    toggleTracking: vi.fn(),
    getCapturedTrack: vi.fn(),
    clearCapturedTrack: vi.fn(),
    exportTrack: vi.fn(),
  }),
}));

vi.mock('../../hooks/usePresence', () => ({
  usePresence: () => ({ users: [], count: 0, isConnected: true }),
}));

vi.mock('../../hooks/useDispatchVoiceAlerts', () => ({
  useDispatchVoiceAlerts: () => {},
}));

vi.mock('../../hooks/useIsMobile', () => ({
  useIsMobile: () => false,
}));

// apiFetch is called by Layout's header-stats polling + settings sync path —
// stub it so no real network calls happen in jsdom.
vi.mock('../../hooks/useApi', async () => {
  const actual = await vi.importActual<typeof import('../../hooks/useApi')>('../../hooks/useApi');
  return {
    ...actual,
    apiFetch: vi.fn().mockResolvedValue({}),
    authedImageUrl: (p: string) => p,
  };
});

vi.mock('../../utils/settingsSync', () => ({
  initSettingsSync: () => () => {},
}));

vi.mock('../../utils/systemSettings', () => ({
  loadSystemSettings: vi.fn().mockResolvedValue({}),
  getSystemSetting: vi.fn(),
}));

import Layout from '../Layout';

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<div data-testid="page-content">page</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('Layout — UserProfileModal mount latch', () => {
  beforeEach(() => {
    onCloseSpy.mockReset();
  });

  it('never mounts UserProfileModal until the profile modal is opened, then latches it mounted after close', async () => {
    const user = userEvent.setup();

    // Let any pending microtasks/macrotasks settle — React.lazy() resolves
    // its dynamic import() asynchronously (even though the mocked module
    // resolves "instantly", it's still at least one tick away), so without
    // this flush an unconditionally-rendered UserProfileModal would still
    // read as absent purely because the assertion below ran before Suspense
    // had a chance to commit it. Flushing first makes assertion (a)
    // meaningful: it only passes when the gate genuinely kept the modal out
    // of the tree, not when we just checked too early.
    await act(async () => {
      renderLayout();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // (a) Fresh render, modal never opened — UserProfileModal must NOT be in
    // the tree. This is the assertion that catches an unconditional render
    // (Regression 1): React.lazy fetches its chunk the moment it's committed,
    // so an unconditional mount would fetch UserProfileModal+SignaturePad on
    // every authenticated page load regardless of whether anyone opens it.
    expect(screen.queryByTestId('user-profile-modal')).not.toBeInTheDocument();

    // Drive open via the REAL UI: click the profile avatar button to open the
    // dropdown, then click the "Edit Profile" menu item, which calls
    // openProfileModal('profile') -> setProfileModalOpen(true).
    await user.click(screen.getByRole('button', { name: /user profile menu/i }));
    await user.click(screen.getByRole('menuitem', { name: /edit profile/i }));

    // (b) After opening — UserProfileModal IS in the tree.
    await waitFor(() => {
      expect(screen.getByTestId('user-profile-modal')).toBeInTheDocument();
    });
    expect(screen.getByTestId('user-profile-modal')).toHaveAttribute('data-open', 'true');

    // Close it via the modal's own onClose (captured from the mocked
    // component's props — this is exactly the callback the real
    // UserProfileModal invokes on its close button, avoiding the need to
    // implement its actual close-button markup in the stub).
    onCloseSpy();

    // (c) After closing — UserProfileModal must STILL be in the tree
    // (data-open flips to false, but the element itself stays mounted).
    // This is the assertion that catches a naive `{profileModalOpen && ...}`
    // gate (Regression 2): dropping the latch would unmount the modal the
    // instant it closes, killing any close/exit transition.
    await waitFor(() => {
      expect(screen.getByTestId('user-profile-modal')).toHaveAttribute('data-open', 'false');
    });
    expect(screen.getByTestId('user-profile-modal')).toBeInTheDocument();
  });
});
