import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DashCamerasRoute } from '../routes/DashCamerasRoute';

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : (input as Request).url);
    if (url.includes('/api/fleet/dash-cameras')) {
      return Promise.resolve(new Response(JSON.stringify([
        { id: 1, serial_number: 'SN-001', model: 'CAM-Pro', status: 'online', installed_date: '2025-12-01', last_seen: '2026-06-21 10:00:00' },
      ]), { status: 200 }));
    }
    if (url.includes('/api/fleet/dashcam-videos')) {
      return Promise.resolve(new Response(JSON.stringify([
        { id: 1, recorded_at: '2026-06-21 09:00:00', duration_seconds: 45, trigger: 'panic', filename: 'cam-001.mp4' },
      ]), { status: 200 }));
    }
    return Promise.resolve(new Response('[]', { status: 200 }));
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('<DashCamerasRoute>', () => {
  it('renders camera units + recent videos', async () => {
    render(<DashCamerasRoute />);
    await screen.findByText('SN-001', {}, { timeout: 3000 });
    expect(screen.getByText('CAM-Pro')).toBeInTheDocument();
    expect(screen.getByText('panic')).toBeInTheDocument();
    expect(screen.getByText('cam-001.mp4')).toBeInTheDocument();
  });
});
