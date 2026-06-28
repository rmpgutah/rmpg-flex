import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import FleetShell from '../FleetShell';

function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  window.dispatchEvent(new Event('resize'));
}

function renderAt(path: string, width: number) {
  setViewport(width);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/fleet/v2/*" element={<FleetShell />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  document.head.replaceChildren();
  vi.unstubAllGlobals();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('<FleetShell>', () => {
  it('renders sidebar at 1440x900 (desktop)', () => {
    renderAt('/fleet/v2', 1440);
    expect(screen.getByLabelText(/fleet sections/i)).toBeInTheDocument();
  });

  it('renders the mobile menu button at 375x667', () => {
    renderAt('/fleet/v2', 375);
    expect(screen.getByRole('button', { name: /open menu/i })).toBeInTheDocument();
  });

  it('renders the Dashboard child route by default', () => {
    renderAt('/fleet/v2', 1440);
    expect(screen.getByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
  });

  it('mounts the noindex meta tag (V2_SOAK_ACTIVE=true)', () => {
    renderAt('/fleet/v2', 1440);
    const meta = document.head.querySelector('meta[name="robots"]');
    expect(meta?.getAttribute('content')).toBe('noindex');
  });
});
