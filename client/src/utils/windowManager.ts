// ============================================================
// RMPG Flex — Window Manager
// Opens secondary browser windows for reports, records, etc.
// ============================================================

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
    win.document.title = title;
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
