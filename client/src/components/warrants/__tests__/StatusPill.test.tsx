// client/src/components/warrants/__tests__/StatusPill.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import StatusPill from '../StatusPill';

describe('StatusPill', () => {
  it('renders the display label for a known status', () => {
    render(<StatusPill status="active" />);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('renders a colored dot alongside the label', () => {
    render(<StatusPill status="served" />);
    const dot = screen.getByTestId('status-pill-dot');
    expect(dot).toBeInTheDocument();
  });

  it('falls back to a neutral style for an unrecognized status', () => {
    render(<StatusPill status="unknown-status" />);
    expect(screen.getByText('Unknown Status')).toBeInTheDocument();
  });

  it('applies the sm size classes by default', () => {
    render(<StatusPill status="active" />);
    expect(screen.getByTestId('status-pill')).toHaveClass('text-[10px]');
  });

  it('applies the md size classes when size="md"', () => {
    render(<StatusPill status="active" size="md" />);
    expect(screen.getByTestId('status-pill')).toHaveClass('text-xs');
  });
});
