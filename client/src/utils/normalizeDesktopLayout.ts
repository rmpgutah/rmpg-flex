export interface DesktopIconPosition {
  path: string;
  x: number;
  y: number;
}

export interface DesktopGroup {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  memberPaths: string[];
}

export interface DesktopLayout {
  icons: DesktopIconPosition[];
  groups: DesktopGroup[];
  iconSize: 'small' | 'medium' | 'large';
  viewMode: 'grid' | 'list';
  sortMode: 'manual' | 'alpha' | 'usage';
}

const EMPTY_LAYOUT: DesktopLayout = { icons: [], groups: [], iconSize: 'medium', viewMode: 'grid', sortMode: 'manual' };

export function normalizeDesktopLayout(raw: string | null | undefined): DesktopLayout {
  if (!raw) return { ...EMPTY_LAYOUT, icons: [], groups: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...EMPTY_LAYOUT, icons: [], groups: [] };
  }
  // v1 shape: a bare array of {path,x,y}
  if (Array.isArray(parsed)) {
    return { icons: parsed as DesktopIconPosition[], groups: [], iconSize: 'medium', viewMode: 'grid', sortMode: 'manual' };
  }
  // v2 shape: an object, possibly missing newer fields from an older save
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Partial<DesktopLayout>;
    return {
      icons: Array.isArray(obj.icons) ? obj.icons : [],
      groups: Array.isArray(obj.groups) ? obj.groups : [],
      iconSize: obj.iconSize ?? 'medium',
      viewMode: obj.viewMode ?? 'grid',
      sortMode: obj.sortMode ?? 'manual',
    };
  }
  return { ...EMPTY_LAYOUT, icons: [], groups: [] };
}

export function serializeDesktopLayout(layout: DesktopLayout): string {
  return JSON.stringify(layout);
}
