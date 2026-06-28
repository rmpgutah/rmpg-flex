import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SectionHeader } from '../SectionHeader';

describe('SectionHeader', () => {
  it('renders title + optional action slot', () => {
    render(<SectionHeader title="Vehicles" actions={<button>+ New Vehicle</button>} />);
    expect(screen.getByRole('heading', { name: 'Vehicles' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ New Vehicle' })).toBeInTheDocument();
  });

  it('renders title alone (no action slot)', () => {
    render(<SectionHeader title="Reports" />);
    expect(screen.getByRole('heading', { name: 'Reports' })).toBeInTheDocument();
  });
});
