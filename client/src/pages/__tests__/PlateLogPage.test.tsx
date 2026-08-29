import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router';
import PlateLogPage from '../PlateLogPage';
import { ToastProvider } from '../../components/ToastProvider';

const apiFetch = vi.fn(async (path: string, init?: RequestInit) => {
  if (init?.method === 'POST') return {
    plate: 'ABC123',
    vehicle: { id: 7, plate_number: 'ABC123', make: 'Ford', model: 'F-150', color: 'Red', year: 2020 },
    hits: [{ kind: 'stolen', severity: 'critical', detail: 'STOLEN — ABC123' }],
  };
  // The ALPR review queue (sub-85% holds) is empty in this test.
  if (path.includes('/alpr/captures')) return [];
  // ClearPath panel status calls — return benign "not configured" shapes.
  if (path.includes('/clearpathgps/status')) return { configured: false, enabled: false, active_mappings: 0 };
  if (path.includes('/clearpathgps/media-status')) return { total_synced_clips: 0, last_media_sync: null };
  return [{ id: 1, plate: 'XYZ789', location_text: 'Main St', notes: null, created_at: '2026-06-12T10:00:00' }];
});
vi.mock('../../hooks/useApi', () => ({
  apiFetch: (...a: any[]) => apiFetch(...(a as [string])),
  apiPostForm: vi.fn(),
  authedImageUrl: (u: string) => u,
}));
// SightingsMap pulls in Mapbox GL (no WebGL in jsdom) — stub it; the map isn't
// under test here.
vi.mock('../../components/SightingsMap', () => ({ default: () => null }));
// useAuth is used for role-gating (canManage); stub it as admin for tests.
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'admin', full_name: 'Test Admin', username: 'testadmin' } }),
}));

describe('PlateLogPage', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { ...navigator, geolocation: undefined });
  });

  it('logs a plate and renders the critical hit banner + recent sightings', async () => {
    render(<MemoryRouter><ToastProvider><PlateLogPage /></ToastProvider></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('XYZ789')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/^PLATE/), { target: { value: 'abc123' } });
    fireEvent.click(screen.getByText('LOG + CHECK'));
    await waitFor(() => expect(screen.getByText(/STOLEN — ABC123/)).toBeInTheDocument());
  });
});
