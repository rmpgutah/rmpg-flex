import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import IncidentPicker from '../IncidentPicker';

vi.mock('../../hooks/useApi', () => ({
  apiFetch: vi.fn(),
}));
import { apiFetch } from '../../hooks/useApi';

const fixture = [
  { id: 11, incident_number: '26-00412', type: 'theft', status: 'open', location: '400 S Main', officer_name: 'Clark' },
];

describe('IncidentPicker', () => {
  beforeEach(() => {
    (apiFetch as ReturnType<typeof vi.fn>).mockReset();
  });

  it('labels the search field and lists incidents', async () => {
    (apiFetch as ReturnType<typeof vi.fn>).mockResolvedValue({ data: fixture });
    render(<IncidentPicker selectedId={null} onSelect={() => {}} />);
    expect(screen.getByLabelText('Search incidents')).toBeInTheDocument();
    expect(await screen.findByText('26-00412')).toBeInTheDocument();
  });

  it('shows a Retry control when the incidents list fails to load', async () => {
    (apiFetch as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ data: fixture });
    render(<IncidentPicker selectedId={null} onSelect={() => {}} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('network down');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('26-00412')).toBeInTheDocument();
  });
});
