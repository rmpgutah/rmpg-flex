import { describe, it, expect, beforeEach } from 'vitest';
import { exportSettings, importSettings } from './settingsExportImport';

const KNOWN_KEYS = [
  'rmpg_desktop_snap_enabled',
  'rmpg_desktop_multi_monitor',
  'rmpg_desktop_pinned_apps',
  'rmpg_desktop_taskbar_position',
  'rmpg_desktop_taskbar_size',
  'rmpg_desktop_taskbar_autohide',
  'rmpg_desktop_icon_label_overrides',
  'rmpg_desktop_auto_arrange',
  'rmpg_desktop_icons_hidden',
];

describe('settingsExportImport — export', () => {
  beforeEach(() => localStorage.clear());

  it('exports a JSON object containing exactly the known keys with their current values', () => {
    localStorage.setItem('rmpg_desktop_taskbar_position', 'top');
    localStorage.setItem('rmpg_desktop_snap_enabled', '0');
    const json = exportSettings();
    const parsed = JSON.parse(json);
    expect(parsed.rmpg_desktop_taskbar_position).toBe('top');
    expect(parsed.rmpg_desktop_snap_enabled).toBe('0');
    expect(Object.keys(parsed).sort()).toEqual([...KNOWN_KEYS].sort());
  });

  it('omits desktop_layout_json and other D1-synced keys even if present in localStorage', () => {
    localStorage.setItem('desktop_layout_json', '{"icons":[]}');
    const json = exportSettings();
    expect(JSON.parse(json)).not.toHaveProperty('desktop_layout_json');
  });

  it('a key with no stored value exports as null', () => {
    const json = exportSettings();
    expect(JSON.parse(json).rmpg_desktop_taskbar_position).toBeNull();
  });
});

describe('settingsExportImport — import', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips: export, clear, import, re-export produces the same JSON', () => {
    localStorage.setItem('rmpg_desktop_taskbar_position', 'top');
    localStorage.setItem('rmpg_desktop_auto_arrange', '1');
    const original = exportSettings();
    localStorage.clear();
    const result = importSettings(original);
    expect(result.ok).toBe(true);
    expect(exportSettings()).toBe(original);
  });

  it('rejects malformed JSON without writing anything', () => {
    localStorage.setItem('rmpg_desktop_taskbar_position', 'bottom');
    const result = importSettings('not valid json{{{');
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(localStorage.getItem('rmpg_desktop_taskbar_position')).toBe('bottom');
  });

  it('rejects a non-object JSON shape (e.g. an array) without writing anything', () => {
    localStorage.setItem('rmpg_desktop_taskbar_position', 'bottom');
    const result = importSettings('[1,2,3]');
    expect(result.ok).toBe(false);
    expect(localStorage.getItem('rmpg_desktop_taskbar_position')).toBe('bottom');
  });

  it('silently ignores unknown keys in the imported JSON rather than writing them', () => {
    const result = importSettings(JSON.stringify({ some_foreign_key: 'x', rmpg_desktop_taskbar_position: 'top' }));
    expect(result.ok).toBe(true);
    expect(localStorage.getItem('some_foreign_key')).toBeNull();
    expect(localStorage.getItem('rmpg_desktop_taskbar_position')).toBe('top');
  });
});
