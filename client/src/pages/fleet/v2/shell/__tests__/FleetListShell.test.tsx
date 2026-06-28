import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FleetListShell } from '../FleetListShell';

describe('<FleetListShell>', () => {
  it('renders title, search input, action slot, and children', () => {
    render(
      <FleetListShell
        title="Vehicles"
        searchPlaceholder="Search vehicles..."
        onSearchChange={() => {}}
        actions={<button>+ New</button>}
      >
        <div>row content</div>
      </FleetListShell>
    );
    expect(screen.getByRole('heading', { name: 'Vehicles' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search vehicles...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ New' })).toBeInTheDocument();
    expect(screen.getByText('row content')).toBeInTheDocument();
  });

  it('fires onSearchChange on input', () => {
    let captured = '';
    render(
      <FleetListShell title="Fuel" searchPlaceholder="Search..." onSearchChange={(v) => { captured = v; }}>
        <div />
      </FleetListShell>
    );
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'unit 12' } });
    expect(captured).toBe('unit 12');
  });
});
