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
  it('has 15 items: 11 Fleet.io-mirrored + 4 RMPG-only', () => {
    expect(SIDEBAR_SECTIONS.length).toBe(15);
    const fi = SIDEBAR_SECTIONS.filter((s) => s.scope === 'fleetio');
    const rmpg = SIDEBAR_SECTIONS.filter((s) => s.scope === 'rmpg-only');
    expect(fi.length).toBe(11);
    expect(rmpg.length).toBe(4);
  });

  it('has 3 empty sections (issues / documents / parts) — work-orders graduated in PR 5b', () => {
    const empty = SIDEBAR_SECTIONS.filter((s) => s.empty);
    expect(empty.map((s) => s.id).sort()).toEqual(['documents', 'issues', 'parts']);
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
  it('renders all 15 section labels', () => {
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
    // After PR 5b, work-orders graduated from empty → real. The remaining
    // empty sections (documents / issues / parts) carry the "coming soon" tag.
    const issues = screen.getByRole('link', { name: /issues.*coming soon/i });
    expect(issues).toBeInTheDocument();
  });

  it('marks RMPG-only sections with "(RMPG only)" in the accessible label', () => {
    renderSidebar();
    const personnel = screen.getByRole('link', { name: /personnel.*rmpg only/i });
    expect(personnel).toBeInTheDocument();
  });
});
