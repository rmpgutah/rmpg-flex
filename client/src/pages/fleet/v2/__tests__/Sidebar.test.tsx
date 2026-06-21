import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar, SIDEBAR_SECTIONS } from '../Sidebar';

function renderSidebar() {
  return render(
    <MemoryRouter>
      <Sidebar />
    </MemoryRouter>
  );
}

describe('SIDEBAR_SECTIONS config', () => {
  it('has 16 items: 11 Fleet.io-mirrored + 5 RMPG-only', () => {
    expect(SIDEBAR_SECTIONS.length).toBe(16);
    const fi = SIDEBAR_SECTIONS.filter((s) => s.scope === 'fleetio');
    const rmpg = SIDEBAR_SECTIONS.filter((s) => s.scope === 'rmpg-only');
    expect(fi.length).toBe(11);
    expect(rmpg.length).toBe(5);
  });

  it('has 4 empty sections (work-orders / issues / documents / parts)', () => {
    const empty = SIDEBAR_SECTIONS.filter((s) => s.empty);
    expect(empty.map((s) => s.id).sort()).toEqual(['documents', 'issues', 'parts', 'work-orders']);
  });

  it('every section has a unique id and a route path under /fleet/v2', () => {
    const ids = new Set(SIDEBAR_SECTIONS.map((s) => s.id));
    expect(ids.size).toBe(SIDEBAR_SECTIONS.length);
    for (const s of SIDEBAR_SECTIONS) {
      expect(s.path.startsWith('/fleet/v2')).toBe(true);
    }
  });
});

describe('<Sidebar>', () => {
  it('renders all 16 section labels', () => {
    renderSidebar();
    for (const section of SIDEBAR_SECTIONS) {
      expect(screen.getByText(section.label)).toBeInTheDocument();
    }
  });

  it('renders the gold RMPG ONLY divider', () => {
    renderSidebar();
    expect(screen.getByText(/rmpg only/i)).toBeInTheDocument();
  });

  it('marks empty sections with "coming soon" in the accessible label', () => {
    renderSidebar();
    const wo = screen.getByRole('link', { name: /work orders.*coming soon/i });
    expect(wo).toBeInTheDocument();
  });

  it('marks RMPG-only sections with "(RMPG only)" in the accessible label', () => {
    renderSidebar();
    const personnel = screen.getByRole('link', { name: /personnel.*rmpg only/i });
    expect(personnel).toBeInTheDocument();
  });
});
