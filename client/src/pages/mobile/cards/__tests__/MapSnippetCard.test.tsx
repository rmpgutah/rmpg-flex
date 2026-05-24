import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('react-router-dom', () => ({
  Link: ({ children, to }: any) => <a href={to}>{children}</a>,
}));

describe('MapSnippetCard (smoke)', () => {
  it('module loads', async () => {
    const mod = await import('../MapSnippetCard');
    expect(mod.default).toBeDefined();
  });
});

describe('MapSnippetCard', () => {
  it('renders title and full-map link', async () => {
    const { default: MapSnippetCard } = await import('../MapSnippetCard');
    render(<MapSnippetCard />);
    expect(screen.getByText(/^MAP$/i)).toBeInTheDocument();
    expect(screen.getByText(/Open full map/i)).toBeInTheDocument();
  });
});
