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
