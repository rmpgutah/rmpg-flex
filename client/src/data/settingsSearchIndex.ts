import type { CategoryId } from '../components/desktop/DesktopSettingsApp';

export interface SettingsSearchEntry {
  categoryId: CategoryId;
  keywords: string[];
}

export const SETTINGS_SEARCH_INDEX: SettingsSearchEntry[] = [
  {
    categoryId: 'personalization',
    keywords: [
      'wallpaper', 'background', 'accent', 'accent color', 'theme',
      'clock', 'clock format', '12-hour', '24-hour', 'time',
      'sound', 'sounds', 'desktop sounds', 'audio',
      'transparency', 'opacity', 'window transparency',
      'night light', 'blue light', 'warm', 'amber tint',
    ],
  },
  {
    categoryId: 'desktop-icons',
    keywords: [
      'icon size', 'view', 'grid', 'list', 'sort', 'snap to grid',
      'widgets', 'auto-arrange', 'hide icons', 'rename',
      'clock widget', 'map widget', 'weather widget',
    ],
  },
  {
    categoryId: 'window-management',
    keywords: [
      'window cycling', 'ctrl', 'snap to edge', 'multi-monitor',
      'secondary monitor', 'snap', 'edge snap',
    ],
  },
  {
    categoryId: 'taskbar',
    keywords: [
      'auto-hide', 'position', 'top', 'bottom', 'size', 'small',
      'large', 'pin', 'taskbar',
    ],
  },
  {
    categoryId: 'layout-templates',
    keywords: ['layout', 'template', 'export layout', 'import layout'],
  },
  {
    categoryId: 'kiosk-mode',
    keywords: ['kiosk', 'windows shell', 'explorer', 'boot', 'lockdown'],
  },
  {
    categoryId: 'flexos',
    keywords: [
      'flexos', 'lock', 'auto-lock', 'idle', 'screensaver', 'screen saver',
      'workspace', 'workspace labels', 'virtual desktop', 'about',
      'security', 'session timeout',
    ],
  },
];
