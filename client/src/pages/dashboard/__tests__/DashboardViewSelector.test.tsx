import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DashboardViewSelector from '../DashboardViewSelector';

describe('DashboardViewSelector', () => {
  it('renders nothing when the user cannot switch', () => {
    const { container } = render(
      <DashboardViewSelector view="dispatch" canSwitch={false} onChange={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });
  it('renders all three view buttons when switching is allowed', () => {
    render(<DashboardViewSelector view="admin" canSwitch onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Dispatch' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Patrol' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Admin' })).toBeTruthy();
  });
  it('marks the active view with aria-pressed', () => {
    render(<DashboardViewSelector view="patrol" canSwitch onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Patrol' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Admin' }).getAttribute('aria-pressed')).toBe('false');
  });
  it('calls onChange with the clicked view', async () => {
    const onChange = vi.fn();
    render(<DashboardViewSelector view="admin" canSwitch onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Dispatch' }));
    expect(onChange).toHaveBeenCalledWith('dispatch');
  });
});
