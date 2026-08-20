import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import FleetAnalyticsTab from '../FleetAnalyticsTab';
import type { FleetAnalytics } from '../../../../types';

const BASE: FleetAnalytics = {
  maintenance_cost_trend: [],
  mileage_distribution: [],
  status_breakdown: [],
  fuel_economy_trend: [],
  fleet_summary: {
    total_vehicles: 1, avg_mileage: 80000, avg_mpg: 18.5,
    total_maintenance_cost: 1200, total_fuel_cost: 900,
    vehicles_needing_service: 0, inspections_failing: 0,
  },
};

describe('FleetAnalyticsTab scope labelling', () => {
  it('labels a vehicle-scoped payload as this vehicle', () => {
    render(<FleetAnalyticsTab analytics={{ ...BASE, scope: 'vehicle' }} />);
    expect(screen.getByTestId('analytics-scope-banner')).toHaveTextContent(/this vehicle/i);
  });

  it('labels a fleet-scoped payload as fleet-wide', () => {
    render(<FleetAnalyticsTab analytics={{ ...BASE, scope: 'fleet' }} />);
    expect(screen.getByTestId('analytics-scope-banner')).toHaveTextContent(/fleet-wide/i);
  });

  it('treats a payload with no scope field as fleet-wide (old Worker, new client)', () => {
    render(<FleetAnalyticsTab analytics={BASE} />);
    expect(screen.getByTestId('analytics-scope-banner')).toHaveTextContent(/fleet-wide/i);
  });

  it('renders the fleet comparison band only when one is supplied', () => {
    const { rerender } = render(<FleetAnalyticsTab analytics={{ ...BASE, scope: 'vehicle' }} />);
    expect(screen.queryByTestId('fleet-comparison')).toBeNull();

    rerender(<FleetAnalyticsTab analytics={{
      ...BASE,
      scope: 'vehicle',
      fleet_comparison: {
        avg_mileage: 95000, avg_mpg: 16.2,
        total_maintenance_cost: 2000, total_fuel_cost: 1500,
      },
    }} />);
    const band = screen.getByTestId('fleet-comparison');
    expect(band).toHaveTextContent('16.2');
    expect(band).toHaveTextContent(/fleet avg/i);
  });

  it('hides a card named in omitted_for_vehicle_scope', () => {
    render(<FleetAnalyticsTab analytics={{
      ...BASE, scope: 'vehicle', omitted_for_vehicle_scope: ['status_breakdown'],
    }} />);
    expect(screen.queryByTestId('card-status_breakdown')).toBeNull();
  });

  // Positive control for the test above: without this, `isOmitted` hardwired
  // to always return `true` would still pass "hides a card named in
  // omitted_for_vehicle_scope" — that test only ever asserts absence. With
  // an empty omitted_for_vehicle_scope, the card must be PRESENT.
  it('renders the card when it is NOT named in omitted_for_vehicle_scope', () => {
    render(<FleetAnalyticsTab analytics={{
      ...BASE, scope: 'vehicle', omitted_for_vehicle_scope: [],
    }} />);
    expect(screen.queryByTestId('card-status_breakdown')).not.toBeNull();
  });
});
