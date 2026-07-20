// ============================================================
// RMPG Flex — Window Manager
// Opens secondary browser windows for reports, records, pages, etc.
// ============================================================

import { NAV_CATEGORIES, type NavFunction } from '../data/navCatalog';

const ALL_NAV_FUNCTIONS: NavFunction[] = NAV_CATEGORIES.flatMap(cat => cat.functions);
const NAV_FUNCTION_BY_PATH: Record<string, NavFunction> = Object.fromEntries(
  ALL_NAV_FUNCTIONS.map(fn => [fn.path, fn]),
);

const DEFAULT_WINDOW_WIDTH = 1050;
const DEFAULT_WINDOW_HEIGHT = 800;

export interface WindowConfig {
  title: string;
  width: number;
  height: number;
}

/** Windowability + size for a nav function. null means "not windowable — navigate() instead." */
export function getWindowConfig(fn: NavFunction): WindowConfig | null {
  if (fn.notWindowable) return null;
  const size = fn.windowSize ?? { width: DEFAULT_WINDOW_WIDTH, height: DEFAULT_WINDOW_HEIGHT };
  return { title: fn.label, width: size.width, height: size.height };
}

/** Same as getWindowConfig, but looked up by raw path — for callers that only have a path (e.g. location.pathname). */
export function getWindowConfigByPath(path: string): WindowConfig | null {
  const fn = NAV_FUNCTION_BY_PATH[path];
  return fn ? getWindowConfig(fn) : null;
}

export function isWindowablePath(path: string): boolean {
  return getWindowConfigByPath(path) !== null;
}

/** Shared activation logic for desktop icon clicks and taskbar search results: open a
 *  floating window for windowable pages, otherwise fall back to a normal SPA navigate(). */
export function activateNavFunction(
  fn: NavFunction,
  handlers: {
    openWindow: (path: string, title: string, size?: { width: number; height: number }) => void;
    navigate: (path: string) => void;
  },
): void {
  const config = getWindowConfig(fn);
  if (config) {
    handlers.openWindow(fn.path, config.title, { width: config.width, height: config.height });
  } else {
    handlers.navigate(fn.path);
  }
}

/** Pages that can be popped out into separate windows */
export const POPOUT_PAGES: Record<string, { title: string; width: number; height: number }> = {
  '/dispatch':       { title: 'Dispatch',           width: 1200, height: 900 },
  '/map':            { title: 'Live Map',            width: 1200, height: 900 },
  '/incidents':      { title: 'Incidents',           width: 1100, height: 850 },
  '/records':        { title: 'Records',             width: 1100, height: 850 },
  '/personnel':      { title: 'Personnel',           width: 1100, height: 850 },
  '/communications': { title: 'Communications',      width: 1000, height: 800 },

  '/patrol':         { title: 'Patrol',              width: 1100, height: 850 },
  '/fleet':          { title: 'Fleet',               width: 1100, height: 850 },
  '/reports':        { title: 'Reports',             width: 1100, height: 850 },
  '/mdt':            { title: 'MDT',                 width: 1000, height: 800 },
  '/warrants':       { title: 'Warrant Search',      width: 1140, height: 840 },
  '/national-warrants': { title: 'National Warrant Search', width: 1180, height: 860 },
  '/citations':      { title: 'Citations',           width: 1000, height: 800 },
  '/law-book':       { title: 'Law Book',            width: 1100, height: 820 },
  '/body-cameras':   { title: 'Body Cameras',        width: 1000, height: 800 },
  '/cases':          { title: 'Case Management',     width: 1100, height: 850 },
  '/evidence':       { title: 'Evidence & Property', width: 1100, height: 850 },
  '/dar':            { title: 'Daily Activity',      width: 1100, height: 850 },
};

function openDetachedWindow(path: string, title: string, width = 1100, height = 850) {
  const left = Math.round((window.screen.width - width) / 2);
  const top = Math.round((window.screen.height - height) / 2);

  const features = [
    `width=${width}`,
    `height=${height}`,
    `left=${left}`,
    `top=${top}`,
    'menubar=no',
    'toolbar=no',
    'location=no',
    'status=no',
    'resizable=yes',
    'scrollbars=yes',
    'noopener=yes',
  ].join(',');

  const win = window.open(path, `rmpg_${title}_${Date.now()}`, features);
  if (win) {
    win.document.title = `${title} — RMPG Flex`;
  }
  return win;
}

export function openIncidentWindow(id: string | number) {
  return openDetachedWindow(`/detached/incident/${id}`, `Incident Report`, 1100, 850);
}

export function openRecordWindow(type: 'person' | 'vehicle', id: string | number) {
  return openDetachedWindow(`/detached/record/${type}/${id}`, `${type === 'person' ? 'Person' : 'Vehicle'} Record`, 900, 700);
}

export function openReportWindow(reportType: string) {
  return openDetachedWindow(`/detached/report/${reportType}`, 'Report', 1100, 850);
}

/**
 * Pop out any page into a separate window. The window opens the same React
 * route so auth, state, and WebSocket all carry over via localStorage tokens.
 */
export function openPageWindow(routePath: string) {
  const config = getWindowConfigByPath(routePath);
  if (config) {
    return openDetachedWindow(routePath, config.title, config.width, config.height);
  }
  // Fallback for unknown/non-windowable routes
  return openDetachedWindow(routePath, 'RMPG Flex', 1100, 850);
}

/** Check if current window is a pop-out (opened by windowManager) */
export function isPopoutWindow(): boolean {
  return window.opener !== null && window.opener !== window;
}
