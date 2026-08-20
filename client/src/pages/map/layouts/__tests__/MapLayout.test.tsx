import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import MapLayout from '../../MapLayout';
import { MapContext } from '../../MapContext';

vi.mock('../../../../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));
vi.mock('../../components/MapLeftDock', () => ({ default: () => null }));
vi.mock('../../components/MapRightDock', () => ({ default: () => null }));
vi.mock('../../components/GpsHud', () => ({ default: () => null }));
vi.mock('../../../../components/PatrolBeatPlannerModal', () => ({ default: () => null }));
import { useAuth } from '../../../../context/AuthContext';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <MapContext.Provider value={{ map: null, units: [], calls: [], beats: [] }}>
    {children}
  </MapContext.Provider>
);

describe('MapLayout', () => {
  it('renders DispatcherMapLayout for dispatcher role', () => {
    (useAuth as any).mockReturnValue({ user: { role: 'dispatcher' } });
    render(<MapLayout />, { wrapper });
    expect(screen.getByTestId('dispatcher-map-layout')).toBeTruthy();
  });

  it('renders DispatcherMapLayout for admin role', () => {
    (useAuth as any).mockReturnValue({ user: { role: 'admin' } });
    render(<MapLayout />, { wrapper });
    expect(screen.getByTestId('dispatcher-map-layout')).toBeTruthy();
  });

  it('renders FieldMapLayout for officer role', () => {
    (useAuth as any).mockReturnValue({ user: { role: 'officer' } });
    render(<MapLayout />, { wrapper });
    expect(screen.getByTestId('field-map-layout')).toBeTruthy();
  });

  it('renders FieldMapLayout read-only for client_viewer role', () => {
    (useAuth as any).mockReturnValue({ user: { role: 'client_viewer' } });
    render(<MapLayout />, { wrapper });
    expect(screen.getByTestId('field-map-layout')).toBeTruthy();
  });
});
