import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AnalysisFormsRoute } from '../routes/AnalysisFormsRoute';

describe('<AnalysisFormsRoute>', () => {
  it('renders the placeholder card with a link to v1', () => {
    render(<MemoryRouter><AnalysisFormsRoute /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: /custom analysis forms/i })).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /open analysis forms in v1/i }) as HTMLAnchorElement;
    expect(link.pathname).toBe('/fleet');
  });
});
