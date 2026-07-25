import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import ToolbarOverflow from '../ToolbarOverflow';

// jsdom performs no layout, so every element reports offsetWidth 0 and the
// packing logic would never trigger. Give each toolbar item a fixed width and
// the container a fixed clientWidth so the real measure/relayout path runs.
function stubLayout({ container, item, more }: { container: number; item: number; more: number }) {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      if (this.dataset.testMore === '1' || this.querySelector('[aria-haspopup="menu"]')) return more;
      return item;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() { return container; },
  });
}

beforeEach(() => {
  // ResizeObserver is not implemented in jsdom.
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {} unobserve() {} disconnect() {}
  };
});

const buttons = (n: number) =>
  Array.from({ length: n }, (_, i) => (
    <button key={i} type="button" onClick={() => { /* noop */ }}>Action {i + 1}</button>
  ));

describe('ToolbarOverflow', () => {
  it('renders every action inline when they all fit', () => {
    stubLayout({ container: 10_000, item: 50, more: 70 });
    render(<ToolbarOverflow>{buttons(6)}</ToolbarOverflow>);
    for (let i = 1; i <= 6; i++) expect(screen.getByText(`Action ${i}`)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /more actions/i })).toBeNull();
  });

  it('moves overflowing actions into a menu instead of hiding them', () => {
    stubLayout({ container: 300, item: 80, more: 70 });
    render(<ToolbarOverflow>{buttons(18)}</ToolbarOverflow>);

    const more = screen.getByRole('button', { name: /more actions/i });
    expect(more).toBeTruthy();

    // Overflow items mount when the menu opens rather than sitting hidden in
    // the DOM — that is deliberate, so a stateful child is never mounted
    // invisibly. What matters is that every action is REACHABLE.
    fireEvent.click(more);
    const menu = screen.getByRole('menu');
    for (let i = 1; i <= 18; i++) expect(screen.getByText(`Action ${i}`)).toBeTruthy();
    expect(within(menu).getByText('Action 18')).toBeTruthy();
  });

  it('keeps a hidden action clickable — the actual F-003 regression', () => {
    // The audited bug: Edit / NCIC / Citation / Archive / Delete existed in the
    // DOM but were only reachable by discovering a hairline scrollbar. Being
    // present is not enough; the handler must fire.
    stubLayout({ container: 200, item: 80, more: 70 });
    const onDelete = vi.fn();
    render(
      <ToolbarOverflow>
        <button type="button">Preview</button>
        <button type="button">Print</button>
        <button type="button" onClick={onDelete}>Delete</button>
      </ToolbarOverflow>,
    );
    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
    fireEvent.click(screen.getByText('Delete'));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('renders each action exactly once — never inline and in the menu', () => {
    // Duplicating children would double-mount stateful ones (PrintRecordButton
    // owns a preview modal), so a given label must appear a single time.
    stubLayout({ container: 250, item: 80, more: 70 });
    render(<ToolbarOverflow>{buttons(10)}</ToolbarOverflow>);
    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
    for (let i = 1; i <= 10; i++) {
      expect(screen.getAllByText(`Action ${i}`)).toHaveLength(1);
    }
  });

  it('reports how many actions are hidden', () => {
    stubLayout({ container: 300, item: 80, more: 70 });
    render(<ToolbarOverflow>{buttons(9)}</ToolbarOverflow>);
    const more = screen.getByRole('button', { name: /more actions/i });
    expect(more.textContent).toMatch(/\(\d+\)/);
  });

  it('closes the menu on Escape', () => {
    stubLayout({ container: 200, item: 80, more: 70 });
    render(<ToolbarOverflow>{buttons(8)}</ToolbarOverflow>);
    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
    expect(screen.queryByRole('menu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('ignores falsy children so conditional buttons do not leave gaps', () => {
    stubLayout({ container: 10_000, item: 50, more: 70 });
    render(
      <ToolbarOverflow>
        <button type="button">Real</button>
        {false}
        {null}
      </ToolbarOverflow>,
    );
    expect(screen.getByText('Real')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /more actions/i })).toBeNull();
  });
});
