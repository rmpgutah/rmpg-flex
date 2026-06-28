import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

// Mutable role holder (vi.hoisted so the mock factory can read it safely).
const auth = vi.hoisted(() => ({ role: 'dispatcher' }));
vi.mock('../../../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, role: auth.role } }),
}));
// Stub the org panel so this test isolates the ROLE GATING, not the panel's
// own data fetching (that has its own test).
vi.mock('../../../admin/AdminRadioSettings', () => ({
  default: () => <div data-testid="org-radio-settings" />,
}));

import SettingsTab from '../SettingsTab';

const noop = () => {};
const renderTab = () =>
  render(<SettingsTab theme="onyx" onTheme={noop} fontScale="md" onFontScale={noop} />);

describe('radio console SettingsTab — org settings gating', () => {
  beforeEach(() => { auth.role = 'dispatcher'; });

  it('always shows the per-device preferences', () => {
    renderTab();
    expect(screen.getByText('APPEARANCE')).toBeInTheDocument();
    expect(screen.getByText('NOTIFICATIONS')).toBeInTheDocument();
  });

  it('hides org settings for a non-privileged operator', () => {
    auth.role = 'dispatcher';
    renderTab();
    expect(screen.queryByTestId('org-radio-settings')).not.toBeInTheDocument();
    expect(screen.queryByText(/APPLIES TO ALL OPERATORS/)).not.toBeInTheDocument();
  });

  it.each(['supervisor', 'manager', 'admin'])('shows org settings for %s', (role) => {
    auth.role = role;
    renderTab();
    expect(screen.getByTestId('org-radio-settings')).toBeInTheDocument();
    expect(screen.getByText(/APPLIES TO ALL OPERATORS/)).toBeInTheDocument();
  });
});
