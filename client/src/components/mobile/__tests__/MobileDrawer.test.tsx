import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../../../utils/featureFlags', () => ({
  isFeatureEnabled: vi.fn(() => true),
  useFeatureFlags: vi.fn(),
}));

import { isFeatureEnabled } from '../../../utils/featureFlags';
import MobileDrawer from '../MobileDrawer';

const baseUser = {
  first_name: 'Jane',
  last_name: 'Doe',
  role: 'officer',
};

describe('MobileDrawer feature-toggle gating', () => {
  beforeEach(() => { vi.mocked(isFeatureEnabled).mockReturnValue(true); });

  it('hides the Fleet nav item when feature_fleet is disabled', () => {
    vi.mocked(isFeatureEnabled).mockImplementation((path: string) => path !== '/fleet');
    render(
      <MemoryRouter>
        <MobileDrawer
          isOpen
          onClose={() => {}}
          user={baseUser}
          isAdmin={false}
          isConnected={false}
          onLogout={() => {}}
        />
      </MemoryRouter>
    );
    expect(screen.queryByText('Fleet')).not.toBeInTheDocument();
  });

  it('shows the Fleet nav item when feature_fleet is enabled', () => {
    render(
      <MemoryRouter>
        <MobileDrawer
          isOpen
          onClose={() => {}}
          user={baseUser}
          isAdmin={false}
          isConnected={false}
          onLogout={() => {}}
        />
      </MemoryRouter>
    );
    expect(screen.getByText('Fleet')).toBeInTheDocument();
  });
});
