import { Response } from 'express';

interface CsvColumn {
  key: string;
  header: string;
}

/**
 * Escape a CSV value.
 * - Returns an empty string for null or undefined.
 * - Converts the value to a string.
 * - If the string contains a comma, double-quote, or newline, wraps it in
 *   double quotes and escapes any internal double quotes by doubling them.
 */
function escapeCsvValue(value: any): string {
  if (value === null || value === undefined) {
    return '';
  }

  const str = String(value);

  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * Send CSV data as a downloadable file response.
 *
 * @param res      Express response object
 * @param filename The name of the CSV file (e.g., 'calls_export.csv')
 * @param columns  Array of { key, header } objects defining columns
 * @param rows     Array of data objects whose properties correspond to column keys
 */
const CSV_MAX_ROWS = 10_000;

export function sendCsv(
  res: Response,
  filename: string,
  columns: CsvColumn[],
  rows: any[],
): void {
  if (rows.length > CSV_MAX_ROWS) {
    res.status(413).json({
      error: `Export too large (${rows.length.toLocaleString()} rows). Maximum is ${CSV_MAX_ROWS.toLocaleString()}. Narrow your date range or add filters.`,
    });
    return;
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const headerRow = columns.map((col) => escapeCsvValue(col.header)).join(',');

  const dataRows = rows.map((row) =>
    columns.map((col) => escapeCsvValue(row[col.key])).join(','),
  );

  const csv = [headerRow, ...dataRows].join('\r\n');

  res.send(csv);
}
