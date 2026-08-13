import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DesktopWidgetPanel from './DesktopWidgetPanel';
import type { DesktopWidgetState } from '../../utils/normalizeDesktopWidgets';

const widget: DesktopWidgetState = { id: 'clock', on: true, x: 50, y: 50, opacity: 1, blur: 0 };

function renderPanel(overrides: Partial<React.ComponentProps<typeof DesktopWidgetPanel>> = {}) {
  render(
    <DesktopWidgetPanel
      widgets={[widget]}
      catalog={[]}
      onMoveWidget={vi.fn()}
      onAdjustWidget={vi.fn()}
      onRemoveWidget={vi.fn()}
      {...overrides}
    />
  );
}

describe('DesktopWidgetPanel context menu', () => {
  it('right-clicking a widget shows Remove widget and Reset position items', async () => {
    renderPanel();
    const frame = document.querySelector('[data-widget-id="clock"]') as HTMLElement;
    fireEvent.contextMenu(frame);
    expect(screen.getByText('Remove widget')).toBeInTheDocument();
    expect(screen.getByText('Reset position')).toBeInTheDocument();
  });

  it('clicking Remove widget calls onRemoveWidget with the widget id', async () => {
    const onRemoveWidget = vi.fn();
    renderPanel({ onRemoveWidget });
    const frame = document.querySelector('[data-widget-id="clock"]') as HTMLElement;
    fireEvent.contextMenu(frame);
    fireEvent.click(screen.getByText('Remove widget'));
    expect(onRemoveWidget).toHaveBeenCalledWith('clock');
  });

  it('clicking Reset position calls onMoveWidget with id and 40, 40', async () => {
    const onMoveWidget = vi.fn();
    renderPanel({ onMoveWidget });
    const frame = document.querySelector('[data-widget-id="clock"]') as HTMLElement;
    fireEvent.contextMenu(frame);
    fireEvent.click(screen.getByText('Reset position'));
    expect(onMoveWidget).toHaveBeenCalledWith('clock', 40, 40);
  });
});
