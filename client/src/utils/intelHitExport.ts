export interface ExportableHit {
  type: string;
  id: number;
  label: string;
  snippet?: string;
  flags?: string[];
  score?: number;
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

export function intelHitsToCsv(hits: ExportableHit[]): string {
  const header = ['type', 'id', 'label', 'snippet', 'flags', 'score'].join(',');
  const lines = hits.map((h) =>
    [h.type, h.id, h.label, h.snippet ?? '', (h.flags ?? []).join('|'), h.score ?? ''].map(csvCell).join(','),
  );
  return [header, ...lines].join('\n');
}

export function downloadTextFile(filename: string, contents: string, mime = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function shareSearchUrl(query: string): string {
  const path = `/intel/search?q=${encodeURIComponent(query.trim())}`;
  if (typeof window === 'undefined') return path;
  return `${window.location.origin}${path}`;
}
