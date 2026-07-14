import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JurisdictionButton } from '../JurisdictionButton';

const mockApiFetch = vi.fn();
vi.mock('../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

describe('JurisdictionButton', () => {
  beforeEach(() => { mockApiFetch.mockReset(); });

  it('shows the resolved county label after fetching', async () => {
    mockApiFetch.mockResolvedValue({
      resolved_county: 'utah', override: null, effective_county: 'utah',
      label: 'Utah County', manual_url: 'https://utahcounty.gov/...',
    });
    render(<JurisdictionButton address="100 E Center St, American Fork, UT" />);
    await waitFor(() => expect(screen.getByText(/Utah County/)).toBeInTheDocument());
  });

  it('opens the popover and shows the manual search link', async () => {
    mockApiFetch.mockResolvedValue({
      resolved_county: 'summit', override: null, effective_county: 'summit',
      label: 'Summit County', manual_url: 'https://property.summitcounty.org/x',
    });
    const user = userEvent.setup();
    render(<JurisdictionButton address="50 Main St, Park City, UT" recordType="business" recordId={5} />);
    await waitFor(() => expect(screen.getByText(/Summit County/)).toBeInTheDocument());
    await user.click(screen.getByRole('button'));
    const link = await screen.findByRole('link', { name: /search summit county manually/i });
    expect(link).toHaveAttribute('href', 'https://property.summitcounty.org/x');
  });

  it('renders nothing for an empty address', () => {
    const { container } = render(<JurisdictionButton address="" />);
    expect(container).toBeEmptyDOMElement();
  });
});
