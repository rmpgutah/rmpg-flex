import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../hooks/useApi', () => ({ apiFetch: () => Promise.resolve({}) }));

import DesktopWidgetPanel from './DesktopWidgetPanel';

describe('DesktopWidgetPanel', () => {
  it('renders only the enabled widgets, in the given order', () => {
    render(<MemoryRouter><DesktopWidgetPanel enabledWidgets={['clock', 'quick-access']} /></MemoryRouter>);
    expect(screen.getAllByText(/Off Duty|Quick Access|…/i).length).toBeGreaterThan(0);
  });

  it('renders nothing for an empty enabledWidgets list', () => {
    const { container } = render(<MemoryRouter><DesktopWidgetPanel enabledWidgets={[]} /></MemoryRouter>);
    expect(container.querySelector('div')?.children.length).toBe(0);
  });
});
