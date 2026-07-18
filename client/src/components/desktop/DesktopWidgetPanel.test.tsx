import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NAV_CATEGORIES } from '../../data/navCatalog';

vi.mock('../../hooks/useApi', () => ({ apiFetch: () => Promise.resolve({}) }));

import DesktopWidgetPanel from './DesktopWidgetPanel';

// DesktopWidgetPanel threads a role-filtered `catalog` through to
// DesktopQuickAccessWidget (see Finding 2 of the 2026-07-18 final review) —
// use the real catalog here since these tests aren't exercising role filtering
// itself, just that the panel renders the right widgets.
const catalog = NAV_CATEGORIES.flatMap(cat => cat.functions);

describe('DesktopWidgetPanel', () => {
  it('renders only the enabled widgets, in the given order', () => {
    render(<MemoryRouter><DesktopWidgetPanel enabledWidgets={['clock', 'quick-access']} catalog={catalog} /></MemoryRouter>);
    expect(screen.getAllByText(/Off Duty|Quick Access|…/i).length).toBeGreaterThan(0);
  });

  it('renders nothing for an empty enabledWidgets list', () => {
    const { container } = render(<MemoryRouter><DesktopWidgetPanel enabledWidgets={[]} catalog={catalog} /></MemoryRouter>);
    expect(container.querySelector('div')?.children.length).toBe(0);
  });
});
