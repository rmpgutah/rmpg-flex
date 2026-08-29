import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';

// ── Regression target ────────────────────────────────────────────────────
// Layout.tsx's top toolbar renders TOOLBAR_NAV items filtered by role AND
// (as of the feature-toggle-nav-gating plan) by isFeatureEnabled(item.path).
// This test asserts the toolbar hides a nav item whose feature flag is off —
// the '/warrants' top-level entry renders as "Enforce" in the toolbar (its
// children carry the "Warrants" label), so we assert on "Enforce".

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
vi.mock('../DialerPanel', () => ({ default: () => null }));
vi.mock('../ForcePasswordChangeModal', () => ({ default: () => null }));
vi.mock('../Force2FASetupModal', () => ({ default: () => null }));
vi.mock('../LocationGate', () => ({ default: () => null }));
vi.mock('../DispatchAlertBanner', () => ({ default: () => null }));
vi.mock('../PttController', () => ({ default: () => null }));
vi.mock('../ErrorBoundary', () => ({ default: ({ children }: { children?: React.ReactNode }) => children }));
vi.mock('../UserProfileModal', () => ({ default: () => null }));

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

const isFeatureEnabledMock = vi.fn((path: string) => path !== '/warrants');
vi.mock('../../utils/featureFlags', () => ({
  loadFeatureFlags: vi.fn().mockResolvedValue({}),
  isFeatureEnabled: (path: string) => isFeatureEnabledMock(path),
  useFeatureFlags: () => 0,
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

describe('Layout — toolbar feature-flag gating', () => {
  beforeEach(() => {
    isFeatureEnabledMock.mockClear();
  });

  it('hides a toolbar nav item whose feature flag is disabled', async () => {
    renderLayout();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // '/warrants' is a top-level TOOLBAR_NAV entry rendered with the label
    // "Enforce" (its children carry the "Warrants" label) — disabled via the
    // mocked isFeatureEnabled, it must not appear in the toolbar.
    expect(screen.queryByText('Enforce')).not.toBeInTheDocument();
  });
});
