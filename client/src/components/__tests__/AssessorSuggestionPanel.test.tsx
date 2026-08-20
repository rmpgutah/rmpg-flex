import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AssessorSuggestionPanel } from '../AssessorSuggestionPanel';

const tooeleParcel = {
  parcel_number: '05-123-0-0045',
  owner_of_record: 'DOE JANE',
  situs_address: null,
  land_sqft: null,
  total_market_value: null,
  detail_url: 'https://erecording.tooeleco.gov/eaglesoftware/web/document/2021-004521',
  recorded_document_url: 'https://erecording.tooeleco.gov/eaglesoftware/web/document/2021-004521',
  recorded_document_type: 'WARRANTY DEED',
};

describe('AssessorSuggestionPanel — Tooele recorder source', () => {
  it('renders a recorded-document link instead of value fields', () => {
    render(
      <AssessorSuggestionPanel
        parcels={[tooeleParcel]}
        onApply={() => {}}
        onDismiss={() => {}}
      />,
    );
    const link = screen.getByRole('link', { name: /view recorded document/i });
    expect(link).toHaveAttribute('href', tooeleParcel.recorded_document_url);
    expect(screen.getByText(/warranty deed/i)).toBeInTheDocument();
  });
});
