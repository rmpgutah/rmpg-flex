import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import ResultCard from '../search/ResultCard';

vi.mock('../../../hooks/useApi', () => ({ authedImageUrl: (u: string) => u }));

const clustered = {
  hit: { type: 'person', id: 7, label: 'Jane Doe', snippet: 'snip', flags: ['WARRANT'], score: 88, date: '2026-05-01' },
  linkedCount: 1, siblings: [],
} as any;

describe('ResultCard', () => {
  it('shows a relevance bar and date', () => {
    render(<ResultCard clustered={clustered} onSelect={() => {}} onOpen={() => {}} />);
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByTestId('relevance-bar')).toBeInTheDocument();
    expect(screen.getByText('2026-05-01')).toBeInTheDocument();
  });
});
