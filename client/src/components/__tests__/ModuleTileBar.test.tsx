import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { Car, Home } from 'lucide-react';

vi.mock('../../utils/featureFlags', () => ({
  isFeatureEnabled: vi.fn(() => true),
  useFeatureFlags: vi.fn(),
}));

import { isFeatureEnabled, useFeatureFlags } from '../../utils/featureFlags';
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

  it('recomputes shouldShow and hides the Fleet tile after flagsTick changes on a rerender (no prop change)', () => {
    let mockTick = 0;
    vi.mocked(useFeatureFlags).mockImplementation(() => mockTick);
    vi.mocked(isFeatureEnabled).mockReturnValue(true);

    // A fresh element on each call (not a reused reference) — passing the
    // literal same element object to rerender() lets React bail out via
    // referential-equality of props and never re-invoke the component at
    // all, which would make this test pass vacuously regardless of whether
    // flagsTick is wired correctly.
    const renderUi = () => (
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

    const { rerender } = render(renderUi());
    expect(screen.getByText('Fleet')).toBeInTheDocument();

    // Simulate a real flag reload: isFeatureEnabled's underlying data changes
    // AND the tick increments — then rerender with IDENTICAL prop VALUES. If
    // flagsTick were ever dropped from shouldShow's dependency array, this
    // rerender would still show the stale (memoized) "Fleet visible" result.
    vi.mocked(isFeatureEnabled).mockImplementation((path: string) => path !== '/fleet');
    mockTick = 1;
    rerender(renderUi());

    expect(screen.queryByText('Fleet')).not.toBeInTheDocument();
  });
});
