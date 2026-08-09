import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { Car, Home } from 'lucide-react';

vi.mock('../../utils/featureFlags', () => ({
  isFeatureEnabled: vi.fn(() => true),
  useFeatureFlags: vi.fn(),
}));

import { isFeatureEnabled } from '../../utils/featureFlags';
import ModuleTileBar from '../ModuleTileBar';

const items = [
  { path: '/', icon: Home, label: 'Dashboard', group: 'Operations' },
  { path: '/fleet', icon: Car, label: 'Fleet', group: 'Personnel' },
];

describe('ModuleTileBar feature-toggle gating', () => {
  beforeEach(() => { vi.mocked(isFeatureEnabled).mockReturnValue(true); });

  it('hides the Fleet tile when feature_fleet is disabled', () => {
    vi.mocked(isFeatureEnabled).mockImplementation((path: string) => path !== '/fleet');
    render(
      <MemoryRouter>
        <ModuleTileBar
          items={items}
          isAdmin={false}
          isClientViewer={false}
          isContractManager={false}
          activeCallCount={0}
          emailUnreadCount={0}
          activeBOLOs={0}
        />
      </MemoryRouter>
    );
    expect(screen.queryByText('Fleet')).not.toBeInTheDocument();
  });

  it('shows the Fleet tile when feature_fleet is enabled', () => {
    render(
      <MemoryRouter>
        <ModuleTileBar
          items={items}
          isAdmin={false}
          isClientViewer={false}
          isContractManager={false}
          activeCallCount={0}
          emailUnreadCount={0}
          activeBOLOs={0}
        />
      </MemoryRouter>
    );
    expect(screen.getByText('Fleet')).toBeInTheDocument();
  });
});
