import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ConnectionsPage from '../ConnectionsPage';

describe('ConnectionsPage', () => {
  it('renders the page title', () => {
    render(<MemoryRouter><ConnectionsPage /></MemoryRouter>);
    expect(screen.getByText(/CONNECTIONS ANALYST/i)).toBeInTheDocument();
  });

  it('renders the seed search input', () => {
    render(<MemoryRouter><ConnectionsPage /></MemoryRouter>);
    expect(screen.getByLabelText(/Seed search/i)).toBeInTheDocument();
  });

  it('renders the empty canvas', () => {
    render(<MemoryRouter><ConnectionsPage /></MemoryRouter>);
    expect(screen.getByTestId('graph-canvas')).toBeInTheDocument();
  });
});
