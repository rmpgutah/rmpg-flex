import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MapBottomTray from '../MapBottomTray';

const rosterProps = {
  open: true, onOpenChange: vi.fn(), units: [], calls: [],
  activeTab: 'units' as const, onTabChange: vi.fn(), isMobile: true,
  onFlyToUnit: vi.fn(), onFlyToCall: vi.fn(), onShowNearestUnit: vi.fn(),
  onRefresh: vi.fn(), onFlyToSelf: vi.fn(),
};
const leftSections = [{ title: 'Live Conditions', items: [{ id: 'traffic', label: 'Live Traffic', active: false, onToggle: vi.fn() }] }];
const rightSections = [{ title: 'Analysis', items: [{ id: 'ruler', label: 'Ruler', active: false, onToggle: vi.fn() }] }];

describe('MapBottomTray', () => {
  it('renders three tabs and starts closed', () => {
    render(<MapBottomTray rosterProps={rosterProps} leftSections={leftSections} rightSections={rightSections} />);
    expect(screen.getByText('Roster')).toBeInTheDocument();
    expect(screen.getByText('Layers')).toBeInTheDocument();
    expect(screen.getByText('Info & Tools')).toBeInTheDocument();
    expect(screen.queryByText('Live Traffic')).not.toBeInTheDocument();
  });

  it('opens the Layers tab content on click', () => {
    render(<MapBottomTray rosterProps={rosterProps} leftSections={leftSections} rightSections={rightSections} />);
    fireEvent.click(screen.getByText('Layers'));
    expect(screen.getByText('Live Traffic')).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: /find layer/i })).toBeInTheDocument();
  });

  it('switches from Layers to Info & Tools content on tab click', () => {
    render(<MapBottomTray rosterProps={rosterProps} leftSections={leftSections} rightSections={rightSections} />);
    fireEvent.click(screen.getByText('Layers'));
    fireEvent.click(screen.getByText('Info & Tools'));
    expect(screen.queryByText('Live Traffic')).not.toBeInTheDocument();
    expect(screen.getByText('Ruler')).toBeInTheDocument();
  });

  it('clicking the open tab again closes the tray', () => {
    render(<MapBottomTray rosterProps={rosterProps} leftSections={leftSections} rightSections={rightSections} />);
    fireEvent.click(screen.getByText('Layers'));
    expect(screen.getByText('Live Traffic')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Layers'));
    expect(screen.queryByText('Live Traffic')).not.toBeInTheDocument();
  });

  it('opens the Roster tab and renders MapRosterDock content', () => {
    const rosterWithUnits = {
      ...rosterProps,
      units: [{ id: 1, call_sign: 'S-1', officer_name: 'Officer A', status: 'available', latitude: 40.7, longitude: -111.9, current_call_type: null, call_number: null }],
    };
    render(<MapBottomTray rosterProps={rosterWithUnits} leftSections={leftSections} rightSections={rightSections} />);
    fireEvent.click(screen.getByText('Roster'));
    expect(screen.getByText('S-1')).toBeInTheDocument();
  });

  it('closes the Roster tab when MapRosterDock\'s own close button is clicked', () => {
    render(<MapBottomTray rosterProps={rosterProps} leftSections={leftSections} rightSections={rightSections} />);
    fireEvent.click(screen.getByText('Roster'));
    expect(screen.getByLabelText('Close sidebar')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Close sidebar'));
    expect(screen.queryByLabelText('Close sidebar')).not.toBeInTheDocument();
  });
});
