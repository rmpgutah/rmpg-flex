import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ParcelDetailDrawer } from '../ParcelDetailDrawer';

const mockApiFetch = vi.fn();
vi.mock('../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

describe('ParcelDetailDrawer', () => {
  beforeEach(() => { mockApiFetch.mockReset(); });

  it('renders nothing without a parcel number', () => {
    const { container } = render(<ParcelDetailDrawer parcelNumber={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('fetches and renders full detail + raw fields on open', async () => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      parcel: {
        parcel_number: 'UT-1', source: 'utah_county_assessor', source_url: 'x',
        year_built: 1998, tax_district: 'AF01',
        raw_data_json: { 'Serial Number': '12:345:0067' },
      },
      code: 'ok',
    });
    const user = userEvent.setup();
    render(<ParcelDetailDrawer parcelNumber="UT-1" />);
    await user.click(screen.getByRole('button', { name: /Full Parcel Detail/i }));
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith('/assessor/parcel/UT-1'));
    expect(await screen.findByText('1998')).toBeInTheDocument();
    expect(screen.getByText('AF01')).toBeInTheDocument();
    expect(screen.getByText('Serial Number')).toBeInTheDocument();
    expect(screen.getByText('12:345:0067')).toBeInTheDocument();
  });

  it('does not re-fetch when toggled closed then open again', async () => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      parcel: { parcel_number: 'UT-1', source: 'utah_county_assessor', source_url: 'x', raw_data_json: {} },
      code: 'ok',
    });
    const user = userEvent.setup();
    render(<ParcelDetailDrawer parcelNumber="UT-1" />);
    const button = screen.getByRole('button', { name: /Full Parcel Detail/i });
    await user.click(button);
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(1));
    await user.click(button); // close
    await user.click(button); // reopen
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
  });
});
