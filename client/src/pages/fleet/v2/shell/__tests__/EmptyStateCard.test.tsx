import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyStateCard } from '../EmptyStateCard';

describe('EmptyStateCard', () => {
  it('renders title + plannedPr line + fleetioUrl button', () => {
    render(
      <EmptyStateCard
        title="Work Orders"
        plannedPr="PR 5"
        description="Vehicle in-shop tracking."
        fleetioUrl="https://app.fleetio.com/work_orders"
      />
    );
    expect(screen.getByText('Work Orders')).toBeInTheDocument();
    expect(screen.getByText(/Coming in PR 5/)).toBeInTheDocument();
    expect(screen.getByText('Vehicle in-shop tracking.')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /view in fleet\.io/i }) as HTMLAnchorElement;
    expect(link.href).toBe('https://app.fleetio.com/work_orders');
    expect(link.target).toBe('_blank');
    expect(link.rel).toMatch(/noopener/);
  });

  it('renders without fleetioUrl (no link, no crash)', () => {
    render(<EmptyStateCard title="Documents" plannedPr="Phase 2" description="Per-vehicle uploads." />);
    expect(screen.queryByRole('link', { name: /view in fleet\.io/i })).toBeNull();
  });
});
