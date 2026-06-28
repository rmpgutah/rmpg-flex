import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, cleanup } from '@testing-library/react';
import SpillmanFormTabs from '../SpillmanFormTabs';
import type { FormSection } from '../recordFormSections';

afterEach(cleanup);

const sections: FormSection[] = [
  { label: 'Details', target: 'spm-sec-vehicle-details' },
  { label: 'Mechanical', target: 'spm-sec-mechanical' },
  { label: 'Damage', target: 'spm-sec-damage-features' },
];

/** Render the strip beside a detail panel that only exposes *some* anchors. */
function renderWithAnchors(present: string[]) {
  return render(
    <div>
      <SpillmanFormTabs sections={sections} />
      <div className="records-detail">
        {present.map((t) => (
          <div key={t} data-section-anchor={t}>{t}</div>
        ))}
      </div>
    </div>,
  );
}

describe('SpillmanFormTabs', () => {
  it('renders a tab for every section when all anchors are present', () => {
    renderWithAnchors(sections.map((s) => s.target));
    expect(screen.getAllByRole('tab')).toHaveLength(3);
  });

  it('prunes tabs whose section did not render in the detail panel', () => {
    renderWithAnchors(['spm-sec-vehicle-details']);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toHaveTextContent('Details');
  });

  it('falls back to the full list when no anchors are present at all', () => {
    renderWithAnchors([]);
    expect(screen.getAllByRole('tab')).toHaveLength(3);
  });

  it('renders nothing when there are no sections', () => {
    const { container } = render(<SpillmanFormTabs sections={[]} />);
    expect(container.querySelector('[role="tablist"]')).toBeNull();
  });
});
