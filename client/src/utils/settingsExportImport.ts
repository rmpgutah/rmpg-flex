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
] as const;

export function exportSettings(): string {
  const out: Record<string, string | null> = {};
  for (const key of KNOWN_KEYS) {
    try {
      out[key] = localStorage.getItem(key);
    } catch {
      out[key] = null;
    }
  }
  return JSON.stringify(out);
}

export function importSettings(json: string): { ok: boolean; error?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: 'That file is not valid JSON.' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'That file is not a settings export.' };
  }
  const obj = parsed as Record<string, unknown>;
  try {
    for (const key of KNOWN_KEYS) {
      if (!(key in obj)) continue;
      const value = obj[key];
      if (value === null) {
        localStorage.removeItem(key);
      } else if (typeof value === 'string') {
        localStorage.setItem(key, value);
      }
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'Could not save settings to this device.' };
  }
}
