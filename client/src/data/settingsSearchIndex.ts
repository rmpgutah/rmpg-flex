import type { CategoryId } from '../components/desktop/DesktopSettingsApp';

export interface SettingsSearchEntry {
  categoryId: CategoryId;
  keywords: string[];
}

export const SETTINGS_SEARCH_INDEX: SettingsSearchEntry[] = [
  { categoryId: 'personalization', keywords: ['wallpaper', 'accent', 'accent color', 'theme'] },
  { categoryId: 'desktop-icons', keywords: ['icon size', 'view', 'grid', 'list', 'sort', 'snap to grid', 'widgets', 'auto-arrange', 'hide icons', 'rename'] },
  { categoryId: 'window-management', keywords: ['window cycling', 'ctrl', 'snap to edge', 'multi-monitor', 'secondary monitor'] },
  { categoryId: 'taskbar', keywords: ['auto-hide', 'position', 'top', 'bottom', 'size', 'small', 'large', 'pin'] },
  { categoryId: 'layout-templates', keywords: ['layout', 'template', 'export layout', 'import layout'] },
];
