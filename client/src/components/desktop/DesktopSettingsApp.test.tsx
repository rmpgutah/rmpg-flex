import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DesktopSettingsApp from './DesktopSettingsApp';
import { normalizeDesktopWidgets } from '../../utils/normalizeDesktopWidgets';

function renderApp(overrides: Partial<React.ComponentProps<typeof DesktopSettingsApp>> = {}) {
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
  render(<DesktopSettingsApp {...props} />);
  return props;
}

describe('DesktopSettingsApp', () => {
  it('defaults to the Personalization category, showing wallpaper and accent controls', () => {
    renderApp();
    expect(screen.getByText('Wallpaper')).toBeInTheDocument();
    expect(screen.getByText('Accent Color')).toBeInTheDocument();
    expect(screen.queryByText('Icon Size')).not.toBeInTheDocument();
  });

  it('clicking a wallpaper swatch calls onWallpaperChange, an accent swatch calls onAccentChange', () => {
    const props = renderApp();
    fireEvent.click(screen.getByLabelText('Wallpaper: Sunken Slate'));
    expect(props.onWallpaperChange).toHaveBeenCalledWith('sunken');
    fireEvent.click(screen.getByLabelText('Accent: Amber'));
    expect(props.onAccentChange).toHaveBeenCalledWith('amber');
  });

  it('switching to Desktop & Icons shows widgets, icon size, view, sort, and reset controls', () => {
    renderApp();
    fireEvent.click(screen.getByText('Desktop & Icons'));
    expect(screen.getByText('Icon Size')).toBeInTheDocument();
    expect(screen.getByText('Reset to Default')).toBeInTheDocument();
    expect(screen.queryByText('Wallpaper')).not.toBeInTheDocument();
  });

  it('toggling a widget checkbox calls onToggleWidget with the widget id', () => {
    const props = renderApp();
    fireEvent.click(screen.getByText('Desktop & Icons'));
    fireEvent.click(screen.getByLabelText('Clock & Shift'));
    expect(props.onToggleWidget).toHaveBeenCalledWith('clock', false);
  });

  it('clicking an icon-size button calls onIconSizeChange', () => {
    const props = renderApp();
    fireEvent.click(screen.getByText('Desktop & Icons'));
    fireEvent.click(screen.getByText('Large'));
    expect(props.onIconSizeChange).toHaveBeenCalledWith('large');
  });

  it('clicking the List view button calls onViewModeChange', () => {
    const props = renderApp();
    fireEvent.click(screen.getByText('Desktop & Icons'));
    fireEvent.click(screen.getByText('List'));
    expect(props.onViewModeChange).toHaveBeenCalledWith('list');
  });

  it('clicking a sort-mode button calls onSortModeChange, and Snap to Grid calls onSnapToGrid', () => {
    const props = renderApp();
    fireEvent.click(screen.getByText('Desktop & Icons'));
    fireEvent.click(screen.getByText('Alphabetical'));
    expect(props.onSortModeChange).toHaveBeenCalledWith('alpha');
    fireEvent.click(screen.getByText('Snap to Grid'));
    expect(props.onSnapToGrid).toHaveBeenCalled();
  });

  it('Reset to Default asks for confirmation before calling onResetToDefault', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const props = renderApp();
    fireEvent.click(screen.getByText('Desktop & Icons'));
    fireEvent.click(screen.getByText('Reset to Default'));
    expect(window.confirm).toHaveBeenCalled();
    expect(props.onResetToDefault).toHaveBeenCalled();
  });

  it('Window Management category shows a placeholder and calls no callbacks', () => {
    const props = renderApp();
    fireEvent.click(screen.getByText('Window Management'));
    expect(screen.getByText(/coming in a future phase/i)).toBeInTheDocument();
    expect(props.onIconSizeChange).not.toHaveBeenCalled();
    expect(props.onWallpaperChange).not.toHaveBeenCalled();
  });

  it('Layout & Templates category shows a placeholder', () => {
    renderApp();
    fireEvent.click(screen.getByText('Layout & Templates'));
    expect(screen.getByText(/coming in a future phase/i)).toBeInTheDocument();
  });

  it('close button calls onClose', () => {
    const props = renderApp();
    fireEvent.click(screen.getByLabelText('Close Settings'));
    expect(props.onClose).toHaveBeenCalled();
  });
});
