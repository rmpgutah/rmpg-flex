// ============================================================
// RMPG Flex — CSV Export Utility
// ============================================================
// Client-side CSV generation and download from in-memory data.
// Used by pages that want to export their currently filtered
// dataset without a dedicated server-side export endpoint.
// ============================================================

export interface CsvColumn {
  key: string;
  label: string;
}

/**
 * Generate a CSV string and trigger a browser download.
 *
 * @param filename  - Download filename (e.g. "citations_export.csv")
 * @param rows      - Array of row objects
 * @param columns   - Ordered column definitions (key → header label)
 */
export function exportToCsv(
  filename: string,
  rows: Record<string, any>[],
  columns: CsvColumn[],
): void {
  const header = columns.map(c => `"${c.label.replace(/"/g, '""')}"`).join(',');
  const csvRows = rows.map(row =>
    columns
      .map(c => {
        const val = row[c.key] ?? '';
        const str = String(val).replace(/"/g, '""');
        return `"${str}"`;
      })
      .join(','),
  );
  const csv = [header, ...csvRows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Generate a timestamped filename for exports.
 *
 * @param prefix - Base name (e.g. "fleet_vehicles")
 * @param extension - File extension (default: "csv")
 * @returns Filename like "fleet_vehicles_2026-03-23_143022.csv"
 */
export function exportFilename(prefix: string, extension = 'csv'): string {
  const now = new Date();
  const ts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '_',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');
  return `${prefix}_${ts}.${extension}`;
}

/**
 * Quick export helper: auto-generates columns from data keys.
 * Useful when you don't need custom column labels.
 */
export function exportToCsvAuto(
  filename: string,
  rows: Record<string, any>[],
  excludeKeys: string[] = [],
): void {
  if (rows.length === 0) return;
  const allKeys = Object.keys(rows[0]).filter((k) => !excludeKeys.includes(k));
  const columns: CsvColumn[] = allKeys.map((key) => ({
    key,
    label: key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
  }));
  exportToCsv(filename, rows, columns);
}
