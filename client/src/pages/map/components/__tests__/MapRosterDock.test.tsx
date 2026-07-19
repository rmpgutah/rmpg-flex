import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MapRosterDock from '../MapRosterDock';

const baseProps = {
  open: true,
  onOpenChange: vi.fn(),
  units: [
    { id: 1, call_sign: 'S-1', officer_name: 'Officer A', status: 'available', latitude: 40.7, longitude: -111.9, current_call_type: null, call_number: null },
  ],
  calls: [
    { id: 2, call_number: 'C-100', priority: 1, incident_type: 'DUI', location_address: '123 Main St', latitude: 40.7, longitude: -111.9 },
  ],
  activeTab: 'units' as const,
  onTabChange: vi.fn(),
  isMobile: false,
  onFlyToUnit: vi.fn(),
  onFlyToCall: vi.fn(),
  onShowNearestUnit: vi.fn(),
  onRefresh: vi.fn(),
  onFlyToSelf: vi.fn(),
};

describe('MapRosterDock', () => {
  it('renders the units tab with unit count and rows', () => {
    render(<MapRosterDock {...baseProps} />);
    expect(screen.getByText('UNITS (1)')).toBeInTheDocument();
    expect(screen.getByText('S-1')).toBeInTheDocument();
  });

  it('switches to the calls tab on click', () => {
    render(<MapRosterDock {...baseProps} />);
    fireEvent.click(screen.getByText('CALLS (1)'));
    expect(baseProps.onTabChange).toHaveBeenCalledWith('calls');
  });

  it('calls onFlyToUnit when a unit row is clicked', () => {
    render(<MapRosterDock {...baseProps} />);
    fireEvent.click(screen.getByText('S-1'));
    expect(baseProps.onFlyToUnit).toHaveBeenCalledWith(baseProps.units[0]);
  });

  it('renders nothing but the open toggle when closed', () => {
    render(<MapRosterDock {...baseProps} open={false} />);
    expect(screen.queryByText('UNITS (1)')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Open sidebar')).toBeInTheDocument();
  });
});
