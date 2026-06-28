import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GpsTrackingRoute } from '../routes/GpsTrackingRoute';

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify([
    { id: 1, device_id: 'CPG-001', rmpg_vehicle_id: 12, vehicle_name: 'Unit 12', latitude: 40.7608, longitude: -111.8910, speed_mph: 32, last_seen: '2026-06-21 10:00:00' },
    { id: 2, device_id: 'CPG-002', rmpg_vehicle_id: 8, vehicle_name: 'Unit 8', latitude: 40.7300, longitude: -111.9000, speed_mph: 0, last_seen: '2026-06-21 09:55:00' },
  ]), { status: 200 }))));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('<GpsTrackingRoute>', () => {
  it('renders live positions with device id + coords + speed', async () => {
    render(<MemoryRouter><GpsTrackingRoute /></MemoryRouter>);
    await screen.findByText('Unit 12', {}, { timeout: 3000 });
    expect(screen.getByText('Unit 8')).toBeInTheDocument();
    expect(screen.getByText('CPG-001')).toBeInTheDocument();
    expect(screen.getByText(/40\.76080/)).toBeInTheDocument();
    expect(screen.getByText(/32 mph/)).toBeInTheDocument();
  });
});
