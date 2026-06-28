import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LegacyActionLink } from '../LegacyActionLink';

describe('<LegacyActionLink>', () => {
  it('renders an anchor pointing at the legacy path', () => {
    render(<MemoryRouter><LegacyActionLink label="New Fuel Entry" legacyPath="/fleet" /></MemoryRouter>);
    const link = screen.getByRole('link') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/fleet');
  });

  it('opens in a new tab with safe rel attributes', () => {
    render(<MemoryRouter><LegacyActionLink label="New Vendor" legacyPath="/fleet" /></MemoryRouter>);
    const link = screen.getByRole('link') as HTMLAnchorElement;
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('uses the label in the visible text + aria-label', () => {
    render(<MemoryRouter><LegacyActionLink label="New Inspection" legacyPath="/fleet" /></MemoryRouter>);
    expect(screen.getByText('New Inspection')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /create new new inspection in legacy fleet view/i })).toBeInTheDocument();
  });

  it('respects an explicit aria-label override', () => {
    render(<MemoryRouter><LegacyActionLink label="X" legacyPath="/fleet" ariaLabel="custom label" /></MemoryRouter>);
    expect(screen.getByRole('link', { name: /custom label/i })).toBeInTheDocument();
  });

  it('shows the small "(legacy)" hint text on wider viewports', () => {
    render(<MemoryRouter><LegacyActionLink label="New Service Entry" legacyPath="/fleet" /></MemoryRouter>);
    // "/fleet legacy" hint is hidden on small viewports via sm:inline.
    // The text content includes it regardless — assert it's in the DOM.
    expect(screen.getByText('/fleet legacy')).toBeInTheDocument();
  });
});
