import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

vi.mock('../../utils/featureFlags', () => ({
  isFeatureEnabled: vi.fn(() => true),
  useFeatureFlags: vi.fn(),
}));

import { isFeatureEnabled } from '../../utils/featureFlags';
import MenuBar from '../MenuBar';

// MenuBar calls useNavigate() and useLocation() (see MenuBarDownload.test.tsx),
// so it throws outside a Router.
const renderMenuBar = () =>
  render(
    <MemoryRouter>
      <MenuBar
        isAdmin={false}
        isConnected
        onLogout={() => {}}
        onSearch={() => {}}
        onShowShortcuts={() => {}}
        onRefreshData={() => {}}
      />
    </MemoryRouter>,
  );

/**
 * Opens the Tools menu, then hovers the "Enforcement" submenu (MenuBar.tsx's
 * Tools > Enforcement group) to reveal its nested "Warrants" item.
 */
async function openToolsEnforcementSubmenu() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('menuitem', { name: /tools menu/i }));
  await user.hover(screen.getByText('Enforcement'));
  return user;
}

describe('MenuBar feature-toggle gating', () => {
  beforeEach(() => { vi.mocked(isFeatureEnabled).mockReturnValue(true); });

  it('hides the Warrants menu item when feature_warrants is disabled', async () => {
    vi.mocked(isFeatureEnabled).mockImplementation((path: string) => path !== '/warrants');
    renderMenuBar();
    await openToolsEnforcementSubmenu();
    expect(screen.queryByRole('menuitem', { name: /^warrants$/i })).not.toBeInTheDocument();
  });

  it('shows the Warrants menu item when feature_warrants is enabled', async () => {
    renderMenuBar();
    await openToolsEnforcementSubmenu();
    expect(screen.getByRole('menuitem', { name: /^warrants$/i })).toBeInTheDocument();
  });
});
