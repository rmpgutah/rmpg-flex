import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DesktopSettingsApp from './DesktopSettingsApp';
import { normalizeDesktopWidgets } from '../../utils/normalizeDesktopWidgets';
import { isTaskbarAutoHideEnabled, getTaskbarPosition, getTaskbarSize } from '../../utils/taskbarPreferences';
import { getClockFormat } from '../../utils/clockPreference';
import { isDesktopSoundEnabled } from '../../utils/desktopSoundPreference';
import { getDefaultWindowOpacity } from '../../utils/windowOpacityPreference';

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
    isAdmin: true,
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
    const props = renderApp();
    fireEvent.click(screen.getByText('Desktop & Icons'));
    fireEvent.click(screen.getByText('Reset to Default'));
    expect(props.onResetToDefault).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(props.onResetToDefault).toHaveBeenCalled();
  });

  it('Window Management category shows cycling info, a snap toggle, and multi-monitor status, calling no personalization callbacks', () => {
    const props = renderApp();
    fireEvent.click(screen.getByText('Window Management'));
    expect(screen.getByText(/cycle through open windows/i)).toBeInTheDocument();
    expect(screen.getByText(/Drag a window to a screen edge/i)).toBeInTheDocument();
    expect(screen.getByText(/not supported in this browser/i)).toBeInTheDocument();
    expect(props.onIconSizeChange).not.toHaveBeenCalled();
    expect(props.onWallpaperChange).not.toHaveBeenCalled();
  });

  it('toggling snap-to-edge persists to localStorage', () => {
    renderApp();
    fireEvent.click(screen.getByText('Window Management'));
    const checkbox = screen.getByLabelText(/Drag a window to a screen edge/i) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);
    expect(localStorage.getItem('rmpg_desktop_snap_enabled')).toBe('0');
    fireEvent.click(checkbox);
  });

  it('Layout & Templates category shows a placeholder', () => {
    renderApp();
    fireEvent.click(screen.getByText('Layout & Templates'));
    expect(screen.getByText(/saved widget layouts/i)).toBeInTheDocument();
  });

  it('close button calls onClose', () => {
    const props = renderApp();
    fireEvent.click(screen.getByLabelText('Close Settings'));
    expect(props.onClose).toHaveBeenCalled();
  });
});

describe('DesktopSettingsApp — Kiosk Mode admin+Windows gating', () => {
  const originalElectron = window.electron;

  afterEach(() => {
    window.electron = originalElectron;
  });

  it('shows the Kiosk Mode category for admins on Windows', () => {
    window.electron = { ...(window.electron ?? {}), isElectron: true, platform: 'win32' } as typeof window.electron;
    renderApp({ isAdmin: true });
    expect(screen.getByText('Kiosk Mode')).toBeInTheDocument();
  });

  it('hides the Kiosk Mode category for non-admins', () => {
    window.electron = { ...(window.electron ?? {}), isElectron: true, platform: 'win32' } as typeof window.electron;
    renderApp({ isAdmin: false });
    expect(screen.queryByText('Kiosk Mode')).not.toBeInTheDocument();
  });

  it('hides the Kiosk Mode category for admins on non-Windows platforms', () => {
    window.electron = { ...(window.electron ?? {}), isElectron: true, platform: 'darwin' } as typeof window.electron;
    renderApp({ isAdmin: true });
    expect(screen.queryByText('Kiosk Mode')).not.toBeInTheDocument();
  });
});

describe('DesktopSettingsApp — Taskbar category', () => {
  beforeEach(() => localStorage.clear());

  it('shows Auto-hide, Position, and Size controls under the Taskbar category', () => {
    renderApp();
    fireEvent.click(screen.getByText('Taskbar'));
    expect(screen.getByText(/auto-hide/i)).toBeInTheDocument();
    expect(screen.getByText('Bottom')).toBeInTheDocument();
    expect(screen.getByText('Top')).toBeInTheDocument();
    expect(screen.getByText('Small')).toBeInTheDocument();
    expect(screen.getByText('Large')).toBeInTheDocument();
  });

  it('toggling auto-hide persists via setTaskbarAutoHide', () => {
    renderApp();
    fireEvent.click(screen.getByText('Taskbar'));
    fireEvent.click(screen.getByLabelText(/auto-hide/i));
    expect(isTaskbarAutoHideEnabled()).toBe(true);
  });

  it('clicking Top sets the taskbar position', () => {
    renderApp();
    fireEvent.click(screen.getByText('Taskbar'));
    fireEvent.click(screen.getByText('Top'));
    expect(getTaskbarPosition()).toBe('top');
  });

  it('clicking Large sets the taskbar size', () => {
    renderApp();
    fireEvent.click(screen.getByText('Taskbar'));
    fireEvent.click(screen.getByText('Large'));
    expect(getTaskbarSize()).toBe('large');
  });
});

describe('DesktopSettingsApp — search', () => {
  it('typing a search term shows only matching category results instead of the full sidebar', () => {
    renderApp();
    fireEvent.change(screen.getByPlaceholderText(/search settings/i), { target: { value: 'auto-hide' } });
    expect(screen.getByText('Taskbar')).toBeInTheDocument();
    expect(screen.queryByText('Personalization')).not.toBeInTheDocument();
  });

  it('clicking a search result switches to that category and clears the search', () => {
    renderApp();
    fireEvent.change(screen.getByPlaceholderText(/search settings/i), { target: { value: 'auto-hide' } });
    fireEvent.click(screen.getByText('Taskbar'));
    expect(screen.getByText('Auto-Hide')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/search settings/i)).toHaveValue('');
  });

  it('clearing the search query restores the full category sidebar', () => {
    renderApp();
    const input = screen.getByPlaceholderText(/search settings/i);
    fireEvent.change(input, { target: { value: 'auto-hide' } });
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.getByText('Personalization')).toBeInTheDocument();
    expect(screen.getByText('Taskbar')).toBeInTheDocument();
  });
});

describe('DesktopSettingsApp — export/import', () => {
  beforeEach(() => localStorage.clear());

  it('clicking Export Settings triggers a download of the current exportSettings() output', () => {
    localStorage.setItem('rmpg_desktop_taskbar_position', 'top');
    const createElementSpy = vi.spyOn(document, 'createElement');
    renderApp();
    fireEvent.click(screen.getByText('Export Settings'));
    const anchorCall = createElementSpy.mock.results.find(r => (r.value as HTMLElement)?.tagName === 'A');
    expect(anchorCall).toBeTruthy();
    createElementSpy.mockRestore();
  });

  it('importing a valid settings file writes the values back and shows a success message', async () => {
    renderApp();
    const file = new File([JSON.stringify({ rmpg_desktop_taskbar_position: 'top' })], 'settings.json', { type: 'application/json' });
    const input = screen.getByLabelText('Import Settings') as HTMLInputElement;
    await fireEvent.change(input, { target: { files: [file] } });
    await screen.findByText(/settings imported/i);
    expect(localStorage.getItem('rmpg_desktop_taskbar_position')).toBe('top');
  });

  it('importing a malformed file shows an error message and does not throw', async () => {
    renderApp();
    const file = new File(['not json'], 'bad.json', { type: 'application/json' });
    const input = screen.getByLabelText('Import Settings') as HTMLInputElement;
    await fireEvent.change(input, { target: { files: [file] } });
    await screen.findByText(/not valid json/i);
  });
});

describe('DesktopSettingsApp — Personalization: clock format, sounds, transparency', () => {
  beforeEach(() => localStorage.clear());

  it('clicking 12-hour/24-hour sets the clock format', () => {
    renderApp();
    fireEvent.click(screen.getByText('12-hour'));
    expect(getClockFormat()).toBe('12h');
    fireEvent.click(screen.getByText('24-hour'));
    expect(getClockFormat()).toBe('24h');
  });

  it('toggling Desktop Sounds persists the preference', () => {
    renderApp();
    fireEvent.click(screen.getByLabelText('Desktop sounds'));
    expect(isDesktopSoundEnabled()).toBe(false);
  });

  it('Increase/Decrease transparency buttons adjust and clamp the default window opacity', () => {
    renderApp();
    fireEvent.click(screen.getByText('Decrease'));
    expect(getDefaultWindowOpacity()).toBe(0.9);
    fireEvent.click(screen.getByText('Increase'));
    expect(getDefaultWindowOpacity()).toBe(1);
  });
});

describe('DesktopSettingsApp — per-category reset', () => {
  beforeEach(() => localStorage.clear());

  it('Personalization reset calls onWallpaperChange/onAccentChange with the defaults', () => {
    const props = renderApp();
    fireEvent.click(screen.getByText('Personalization'));
    fireEvent.click(screen.getByText('Reset this category to default'));
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(props.onWallpaperChange).toHaveBeenCalledWith('blue-silver-default');
    expect(props.onAccentChange).toHaveBeenCalled();
  });

  it('Window Management reset re-enables snap without touching taskbar keys', () => {
    localStorage.setItem('rmpg_desktop_taskbar_position', 'top');
    renderApp();
    fireEvent.click(screen.getByText('Window Management'));
    fireEvent.click(screen.getByText('Reset this category to default'));
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(localStorage.getItem('rmpg_desktop_snap_enabled')).toBe('1');
    expect(localStorage.getItem('rmpg_desktop_taskbar_position')).toBe('top');
  });

  it('Taskbar reset restores position/size/auto-hide defaults without touching pinned apps', () => {
    localStorage.setItem('rmpg_desktop_taskbar_position', 'top');
    localStorage.setItem('rmpg_desktop_taskbar_size', 'large');
    localStorage.setItem('rmpg_desktop_taskbar_autohide', '1');
    localStorage.setItem('rmpg_desktop_pinned_apps', JSON.stringify(['/dispatch']));
    renderApp();
    fireEvent.click(screen.getByText('Taskbar'));
    fireEvent.click(screen.getByText('Reset this category to default'));
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(localStorage.getItem('rmpg_desktop_taskbar_position')).toBe('bottom');
    expect(localStorage.getItem('rmpg_desktop_taskbar_size')).toBe('small');
    expect(localStorage.getItem('rmpg_desktop_taskbar_autohide')).toBe('0');
    expect(localStorage.getItem('rmpg_desktop_pinned_apps')).toBe(JSON.stringify(['/dispatch']));
  });
});
