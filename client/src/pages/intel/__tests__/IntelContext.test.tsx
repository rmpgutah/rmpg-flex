import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { IntelProvider, useIntelContext } from '../IntelContext';

function Probe() {
  const { selected, selectEntity, panelMode, setPanelMode, panelCollapsed, togglePanel } = useIntelContext();
  return (
    <div>
      <div data-testid="sel">{selected ? `${selected.type}:${selected.id}:${selected.label}` : 'none'}</div>
      <div data-testid="mode">{panelMode}</div>
      <div data-testid="collapsed">{String(panelCollapsed)}</div>
      <button onClick={() => selectEntity('person', 42, 'HALE, Vincent')}>select</button>
      <button onClick={() => setPanelMode('graph')}>graph</button>
      <button onClick={togglePanel}>toggle</button>
    </div>
  );
}

describe('IntelContext', () => {
  beforeEach(() => { try { localStorage.clear(); } catch { /* ignore */ } });

  it('selecting an entity sets it and forces dossier mode + expands panel', () => {
    render(<IntelProvider><Probe /></IntelProvider>);
    expect(screen.getByTestId('sel').textContent).toBe('none');
    fireEvent.click(screen.getByText('graph'));      // pre-set to graph
    fireEvent.click(screen.getByText('select'));     // selecting resets to dossier
    expect(screen.getByTestId('sel').textContent).toBe('person:42:HALE, Vincent');
    expect(screen.getByTestId('mode').textContent).toBe('dossier');
    expect(screen.getByTestId('collapsed').textContent).toBe('false');
  });

  it('togglePanel flips collapsed', () => {
    render(<IntelProvider><Probe /></IntelProvider>);
    const before = screen.getByTestId('collapsed').textContent;
    fireEvent.click(screen.getByText('toggle'));
    expect(screen.getByTestId('collapsed').textContent).not.toBe(before);
  });

  // v1047 — no AuthProvider wrapper → falls back to the legacy global
  // key. This guards against a regression where IntelProvider would
  // throw when used outside an AuthProvider (the original try/catch
  // around useAuth was a rules-of-hooks violation).
  it('renders without an AuthProvider (per-user key falls back to global)', () => {
    expect(() => render(<IntelProvider><Probe /></IntelProvider>)).not.toThrow();
  });
});
