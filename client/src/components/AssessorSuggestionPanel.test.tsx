import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AssessorSuggestionPanel } from './AssessorSuggestionPanel';

const sample = [
  { parcel_number: '16-04-301-005', owner_of_record: 'XYZ HOLDINGS LLC',
    situs_address: '2200 S 500 E', land_sqft: 12400, total_market_value: 1_840_000,
    detail_url: '' },
  { parcel_number: '16-04-301-006', owner_of_record: 'SMITH, JOHN & SMITH, JANE',
    situs_address: '2202 S 500 E', land_sqft: 8200, total_market_value: 620_000,
    detail_url: '' },
];

describe('AssessorSuggestionPanel', () => {
  test('renders nothing when parcels is null', () => {
    const { container } = render(
      <AssessorSuggestionPanel parcels={null} onApply={() => {}} onDismiss={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });
  test('renders nothing when parcels is empty', () => {
    const { container } = render(
      <AssessorSuggestionPanel parcels={[]} onApply={() => {}} onDismiss={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });
  test('single parcel auto-selects, Apply enabled', () => {
    const onApply = vi.fn();
    render(<AssessorSuggestionPanel parcels={[sample[0]]} onApply={onApply} onDismiss={() => {}} />);
    const apply = screen.getByRole('button', { name: /apply/i });
    expect(apply).not.toBeDisabled();
    fireEvent.click(apply);
    expect(onApply).toHaveBeenCalledWith('16-04-301-005');
  });
  test('multi parcel requires pick before Apply', () => {
    render(<AssessorSuggestionPanel parcels={sample} onApply={() => {}} onDismiss={() => {}} />);
    expect(screen.getByRole('button', { name: /apply/i })).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/16-04-301-006/));
    expect(screen.getByRole('button', { name: /apply/i })).not.toBeDisabled();
  });
  test('dismiss closes panel', () => {
    const onDismiss = vi.fn();
    render(<AssessorSuggestionPanel parcels={[sample[0]]} onApply={() => {}} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalled();
  });

  test('no-match panel shows manual search link when code=no_match', () => {
    render(
      <AssessorSuggestionPanel
        parcels={[]}
        code="no_match"
        manualUrl="https://apps.saltlakecounty.gov/assessor/new/query.cfm?address=foo"
        onApply={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText(/no matching parcels/i)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /search slco manually/i });
    expect(link).toHaveAttribute('href', expect.stringContaining('saltlakecounty.gov'));
  });

  test('error state shows retry button when onRetry provided', () => {
    const onRetry = vi.fn();
    render(
      <AssessorSuggestionPanel
        parcels={[]}
        code="upstream_error"
        error="boom"
        manualUrl="https://x.example"
        onApply={() => {}}
        onDismiss={() => {}}
        onRetry={onRetry}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  test('degraded picker shows stale-data warning', () => {
    render(
      <AssessorSuggestionPanel
        parcels={[sample[0]]}
        source="stale_cache"
        degraded={true}
        manualUrl="https://x.example"
        onApply={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText(/last-known data/i)).toBeInTheDocument();
  });
});
