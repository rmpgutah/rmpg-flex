import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import PlateLogPage from '../PlateLogPage';

const apiFetch = vi.fn(async (path: string, init?: RequestInit) => {
  if (init?.method === 'POST') return {
    plate: 'ABC123',
    vehicle: { id: 7, plate_number: 'ABC123', make: 'Ford', model: 'F-150', color: 'Red', year: 2020 },
    hits: [{ kind: 'stolen', severity: 'critical', detail: 'STOLEN — ABC123' }],
  };
  return [{ id: 1, plate: 'XYZ789', location_text: 'Main St', notes: null, created_at: '2026-06-12T10:00:00' }];
});
vi.mock('../../hooks/useApi', () => ({ apiFetch: (...a: any[]) => apiFetch(...(a as [string])) }));

describe('PlateLogPage', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { ...navigator, geolocation: undefined });
  });

  it('logs a plate and renders the critical hit banner + recent sightings', async () => {
    render(<PlateLogPage />);
    await waitFor(() => expect(screen.getByText('XYZ789')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('PLATE'), { target: { value: 'abc123' } });
    fireEvent.click(screen.getByText('LOG + CHECK'));
    await waitFor(() => expect(screen.getByText(/STOLEN — ABC123/)).toBeInTheDocument());
  });
});
