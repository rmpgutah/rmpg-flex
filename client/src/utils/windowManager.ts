// ============================================================
// RMPG Flex — Window Manager
// Opens secondary browser windows for reports, records, pages, etc.
// ============================================================

/** Pages that can be popped out into separate windows */
export const POPOUT_PAGES: Record<string, { title: string; width: number; height: number }> = {
  '/dispatch':       { title: 'Dispatch',           width: 1200, height: 900 },
  '/map':            { title: 'Live Map',            width: 1200, height: 900 },
  '/incidents':      { title: 'Incidents',           width: 1100, height: 850 },
  '/records':        { title: 'Records',             width: 1100, height: 850 },
  '/personnel':      { title: 'Personnel',           width: 1100, height: 850 },
  '/communications': { title: 'Communications',      width: 1000, height: 800 },
  '/radio':          { title: 'Radio',               width: 800,  height: 700 },
  '/patrol':         { title: 'Patrol',              width: 1100, height: 850 },
  '/fleet':          { title: 'Fleet',               width: 1100, height: 850 },
  '/reports':        { title: 'Reports',             width: 1100, height: 850 },
  '/mdt':            { title: 'MDT',                 width: 1000, height: 800 },
  '/warrants':       { title: 'Warrants',            width: 1000, height: 800 },
  '/citations':      { title: 'Citations',           width: 1000, height: 800 },
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
  const page = POPOUT_PAGES[routePath];
  if (page) {
    return openDetachedWindow(routePath, page.title, page.width, page.height);
  }
  // Fallback for unknown routes
  return openDetachedWindow(routePath, 'RMPG Flex', 1100, 850);
}

/** Check if current window is a pop-out (opened by windowManager) */
export function isPopoutWindow(): boolean {
  return window.opener !== null && window.opener !== window;
}
