import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { saveFavorites, pushRecent } from '../../../utils/navFavorites';
import DesktopQuickAccessWidget from './DesktopQuickAccessWidget';

describe('DesktopQuickAccessWidget', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

  it('lists favorited modules by label', () => {
    saveFavorites(new Set(['/dispatch']));
    render(<MemoryRouter><DesktopQuickAccessWidget /></MemoryRouter>);
    expect(screen.getByText('Dispatch Console')).toBeInTheDocument();
  });

  it('shows an empty state with no favorites', () => {
    render(<MemoryRouter><DesktopQuickAccessWidget /></MemoryRouter>);
    expect(screen.getByText(/No favorites yet/i)).toBeInTheDocument();
  });

  it('lists recent modules by label when there are zero favorites', () => {
    pushRecent('/dispatch');
    render(<MemoryRouter><DesktopQuickAccessWidget /></MemoryRouter>);
    expect(screen.getByText('Dispatch Console')).toBeInTheDocument();
    expect(screen.queryByText(/No favorites yet/i)).not.toBeInTheDocument();
  });
});
