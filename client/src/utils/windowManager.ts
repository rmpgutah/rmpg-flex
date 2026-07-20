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
