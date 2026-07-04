import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SafetyAlertTicker from '../SafetyAlertTicker';
import type { SafetyAlertItem } from '../../../../hooks/useSafetyAlertFeed';

const items: SafetyAlertItem[] = [
  { id: 'panic-1', type: 'panic', severity: 'critical', label: 'Panic — Officer A' },
  { id: 'welfare-2', type: 'welfare', severity: 'critical', label: 'Welfare — Officer B' },
  { id: 'premise-3', type: 'premise', severity: 'warning', label: 'Hazmat', detail: '123 Main St' },
  { id: 'premise-4', type: 'premise', severity: 'info', label: 'Watch zone', detail: '456 Elm St' },
];

describe('SafetyAlertTicker', () => {
  it('shows the top 3 items in the collapsed strip even when closed', () => {
    render(<SafetyAlertTicker items={items} count={4} loading={false} />);
    expect(screen.getByText('Panic — Officer A')).toBeInTheDocument();
    expect(screen.getByText('Welfare — Officer B')).toBeInTheDocument();
    expect(screen.getByText('Hazmat')).toBeInTheDocument();
    expect(screen.queryByText('Watch zone')).not.toBeInTheDocument();
  });

  it('shows a badge with the total count', () => {
    render(<SafetyAlertTicker items={items} count={4} loading={false} />);
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('expands to show all items when the trigger is clicked', () => {
    render(<SafetyAlertTicker items={items} count={4} loading={false} />);
    fireEvent.click(screen.getByLabelText(/safety alerts/i));
    expect(screen.getByText('Watch zone')).toBeInTheDocument();
  });

  it('renders nothing extra when there are zero alerts (no empty badge clutter)', () => {
    render(<SafetyAlertTicker items={[]} count={0} loading={false} />);
    expect(screen.queryByLabelText(/safety alerts/i)).not.toBeInTheDocument();
  });
});
