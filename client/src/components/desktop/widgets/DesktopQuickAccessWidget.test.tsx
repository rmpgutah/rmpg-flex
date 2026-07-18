import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { saveFavorites, pushRecent } from '../../../utils/navFavorites';
import { NAV_CATEGORIES } from '../../../data/navCatalog';
import DesktopQuickAccessWidget from './DesktopQuickAccessWidget';

// The widget no longer imports NAV_CATEGORIES itself — it takes a role-filtered
// `catalog` prop from DesktopPage (see Finding 2 of the 2026-07-18 final review:
// the widget used to read the raw, unfiltered catalog directly, bypassing the
// adminOnly/CLIENT_VIEWER_BLOCKED/CONTRACT_MANAGER_BLOCKED filtering every other
// module-surfacing path in this feature goes through). Tests build the catalog
// from the real NAV_CATEGORIES so the "Dispatch Console" label assertions still
// reflect real data.
const catalog = NAV_CATEGORIES.flatMap(cat => cat.functions);

describe('DesktopQuickAccessWidget', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

  it('lists favorited modules by label', () => {
    saveFavorites(new Set(['/dispatch']));
    render(<MemoryRouter><DesktopQuickAccessWidget catalog={catalog} /></MemoryRouter>);
    expect(screen.getByText('Dispatch Console')).toBeInTheDocument();
  });

  it('shows an empty state with no favorites', () => {
    render(<MemoryRouter><DesktopQuickAccessWidget catalog={catalog} /></MemoryRouter>);
    expect(screen.getByText(/No favorites yet/i)).toBeInTheDocument();
  });

  it('lists recent modules by label when there are zero favorites', () => {
    pushRecent('/dispatch');
    render(<MemoryRouter><DesktopQuickAccessWidget catalog={catalog} /></MemoryRouter>);
    expect(screen.getByText('Dispatch Console')).toBeInTheDocument();
    expect(screen.queryByText(/No favorites yet/i)).not.toBeInTheDocument();
  });

  it('only surfaces modules present in the passed-in catalog (role filtering respected)', () => {
    // Simulate a role-filtered catalog that has had '/admin' stripped out —
    // even if it's favorited (e.g. leftover from a shared-machine admin
    // session), a restricted-role catalog must not surface it.
    saveFavorites(new Set(['/admin', '/dispatch']));
    const restrictedCatalog = catalog.filter(fn => fn.path !== '/admin');
    render(<MemoryRouter><DesktopQuickAccessWidget catalog={restrictedCatalog} /></MemoryRouter>);
    expect(screen.getByText('Dispatch Console')).toBeInTheDocument();
    expect(screen.queryByText(/Admin/i)).not.toBeInTheDocument();
  });
});
