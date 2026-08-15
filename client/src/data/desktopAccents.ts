export interface AccentPreset {
  id: string;
  label: string;
  accent: string;
  shadow: string;
}

export const DEFAULT_ACCENT_ID = 'default';

export const DESKTOP_ACCENTS: AccentPreset[] = [
  { id: 'default', label: 'Blue & Silver', accent: 'var(--brand-blue)', shadow: 'rgba(0 0 0 / 0.4)' },
  { id: 'amber', label: 'Amber', accent: 'var(--stat-accent-amber-bright)', shadow: 'rgba(251, 191, 36, 0.35)' },
  { id: 'crimson', label: 'Crimson', accent: 'var(--stat-accent-red-bright)', shadow: 'rgba(239, 68, 68, 0.35)' },
  { id: 'forest', label: 'Forest', accent: 'var(--stat-accent-green)', shadow: 'rgba(34, 197, 94, 0.35)' },
  { id: 'purple', label: 'Purple', accent: 'var(--stat-accent-purple)', shadow: 'rgba(168, 85, 247, 0.35)' },
  { id: 'garnet', label: 'Garnet', accent: 'var(--stat-accent-red)', shadow: 'rgba(220, 38, 38, 0.35)' },
  { id: 'graphite', label: 'Graphite', accent: 'var(--stat-accent-default)', shadow: 'rgba(148, 163, 184, 0.35)' },
];

export function getAccent(id: string): AccentPreset {
  return DESKTOP_ACCENTS.find(a => a.id === id) ?? DESKTOP_ACCENTS[0];
}
