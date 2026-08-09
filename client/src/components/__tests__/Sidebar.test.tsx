import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../../utils/featureFlags', () => ({
  isFeatureEnabled: vi.fn(() => true),
  useFeatureFlags: vi.fn(),
}));

import { isFeatureEnabled } from '../../utils/featureFlags';
import Sidebar from '../Sidebar';

describe('Sidebar feature-toggle gating', () => {
  beforeEach(() => { vi.mocked(isFeatureEnabled).mockReturnValue(true); });

  it('hides the Fleet nav item when feature_fleet is disabled', () => {
    vi.mocked(isFeatureEnabled).mockImplementation((path: string) => path !== '/fleet');
    render(
      <MemoryRouter>
        <Sidebar isAdmin={false} isContractManager={false} />
      </MemoryRouter>
    );
    expect(screen.queryByText('Fleet')).not.toBeInTheDocument();
  });

  it('shows the Fleet nav item when feature_fleet is enabled', () => {
    render(
      <MemoryRouter>
        <Sidebar isAdmin={false} isContractManager={false} />
      </MemoryRouter>
    );
    expect(screen.getByText('Fleet')).toBeInTheDocument();
  });
});
