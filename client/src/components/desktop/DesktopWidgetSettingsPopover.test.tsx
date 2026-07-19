import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DesktopWidgetSettingsPopover from './DesktopWidgetSettingsPopover';
import { normalizeDesktopWidgets } from '../../utils/normalizeDesktopWidgets';

function renderPopover(overrides: Partial<React.ComponentProps<typeof DesktopWidgetSettingsPopover>> = {}) {
  const props = {
    widgets: normalizeDesktopWidgets(null),
    onToggleWidget: vi.fn(),
    iconSize: 'medium' as const,
    onIconSizeChange: vi.fn(),
    viewMode: 'grid' as const,
    onViewModeChange: vi.fn(),
    sortMode: 'manual' as const,
    onSortModeChange: vi.fn(),
    onSnapToGrid: vi.fn(),
    wallpaperId: 'blue-silver-default',
    onWallpaperChange: vi.fn(),
    accentId: 'default',
    onAccentChange: vi.fn(),
    onResetToDefault: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<DesktopWidgetSettingsPopover {...props} />);
  return props;
}

describe('DesktopWidgetSettingsPopover', () => {
  it('toggling a widget checkbox calls onToggleWidget with the widget id', () => {
    const props = renderPopover();
    fireEvent.click(screen.getByLabelText('Clock & Shift'));
    expect(props.onToggleWidget).toHaveBeenCalledWith('clock', false);
  });

  it('clicking an icon-size button calls onIconSizeChange', () => {
    const props = renderPopover();
    fireEvent.click(screen.getByText('Large'));
    expect(props.onIconSizeChange).toHaveBeenCalledWith('large');
  });

  it('clicking the List view button calls onViewModeChange', () => {
    const props = renderPopover();
    fireEvent.click(screen.getByText('List'));
    expect(props.onViewModeChange).toHaveBeenCalledWith('list');
  });

  it('clicking a sort-mode button calls onSortModeChange, and Snap to Grid calls onSnapToGrid', () => {
    const props = renderPopover();
    fireEvent.click(screen.getByText('Alphabetical'));
    expect(props.onSortModeChange).toHaveBeenCalledWith('alpha');
    fireEvent.click(screen.getByText('Snap to Grid'));
    expect(props.onSnapToGrid).toHaveBeenCalled();
  });

  it('clicking a wallpaper swatch calls onWallpaperChange, an accent swatch calls onAccentChange', () => {
    const props = renderPopover();
    fireEvent.click(screen.getByLabelText('Wallpaper: Sunken Slate'));
    expect(props.onWallpaperChange).toHaveBeenCalledWith('sunken');
    fireEvent.click(screen.getByLabelText('Accent: Amber'));
    expect(props.onAccentChange).toHaveBeenCalledWith('amber');
  });

  it('Reset to Default asks for confirmation before calling onResetToDefault', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const props = renderPopover();
    fireEvent.click(screen.getByText('Reset to Default'));
    expect(window.confirm).toHaveBeenCalled();
    expect(props.onResetToDefault).toHaveBeenCalled();
  });
});
