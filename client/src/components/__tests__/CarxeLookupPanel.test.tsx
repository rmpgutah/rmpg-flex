import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CarxeLookupPanel from '../CarxeLookupPanel';
import * as useApiModule from '../../hooks/useApi';

describe('CarxeLookupPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a plate decode result after clicking the lookup button', async () => {
    vi.spyOn(useApiModule, 'apiFetch').mockResolvedValue({
      ok: true,
      cached: false,
      result: { success: true, make: 'Kia', model: 'Forte', year: '2017' },
    });

    render(<CarxeLookupPanel mode="plate" plate="7XER187" state="CA" />);
    fireEvent.click(screen.getByText('Run CarsXE Lookup'));

    await waitFor(() => {
      expect(screen.getByText(/Kia/)).toBeInTheDocument();
    });
  });

  it('shows a not_configured message without crashing', async () => {
    vi.spyOn(useApiModule, 'apiFetch').mockResolvedValue({ ok: false, code: 'not_configured' });

    render(<CarxeLookupPanel mode="plate" plate="7XER187" />);
    fireEvent.click(screen.getByText('Run CarsXE Lookup'));

    await waitFor(() => {
      expect(screen.getByText('CarsXE lookup is not configured')).toBeInTheDocument();
    });
  });

  it('renders lien/theft events and highlights active theft hits', async () => {
    vi.spyOn(useApiModule, 'apiFetch').mockResolvedValue({
      ok: true,
      cached: false,
      result: { events: [{ event: 'Active Theft', location: 'OH' }] },
      screening: { hits: [{ kind: 'stolen', severity: 'critical', detail: 'Vehicle reported stolen' }] },
    });

    render(<CarxeLookupPanel mode="vin" vin="2C3CDXFG1FH762860" />);
    fireEvent.click(screen.getByText(/Lien & Theft/));

    await waitFor(() => {
      expect(screen.getByText(/Vehicle reported stolen/)).toBeInTheDocument();
      expect(screen.getByText(/Active Theft/)).toBeInTheDocument();
    });
  });
});
