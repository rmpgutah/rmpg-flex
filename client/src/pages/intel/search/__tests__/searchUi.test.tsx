import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import ResultCard from '../ResultCard';
import FacetSidebar from '../FacetSidebar';

describe('search UI', () => {
  it('ResultCard shows label, flags, linked badge and fires onSelect', () => {
    const onSelect = vi.fn();
    render(<ResultCard
      clustered={{ hit: { type: 'person', id: 2, label: 'HALE, Vincent', snippet: '', flags: ['ACTIVE WARRANT'], score: 90 }, linkedCount: 3 }}
      onSelect={onSelect} onOpen={() => {}} />);
    expect(screen.getByText('HALE, Vincent')).toBeInTheDocument();
    expect(screen.getByText('ACTIVE WARRANT')).toBeInTheDocument();
    expect(screen.getByText(/3 linked/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText('HALE, Vincent'));
    expect(onSelect).toHaveBeenCalledWith('person', 2, 'HALE, Vincent');
  });

  it('FacetSidebar lists type counts and fires onToggleType', () => {
    const onToggleType = vi.fn();
    render(<FacetSidebar facets={{ byType: { person: 4, vehicle: 1 }, byFlag: { 'active warrant': 2 } }}
      activeType={null} activeFlags={[]} onToggleType={onToggleType} onToggleFlag={() => {}} />);
    expect(screen.getByText(/person/i)).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    fireEvent.click(screen.getByText(/person/i));
    expect(onToggleType).toHaveBeenCalledWith('person');
  });
});
