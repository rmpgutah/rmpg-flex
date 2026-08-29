export function filterByQuery<T>(rows: T[], query: string, fields: (row: T) => string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => fields(r).toLowerCase().includes(q));
}

export function jobsToCsv(jobs: Array<{
  id: string;
  name: string;
  status: string;
  printer?: string;
  pages?: number;
  pagesTotal?: number;
}>): string {
  const header = 'id,name,status,printer,pages,pagesTotal';
  const lines = jobs.map((j) =>
    [j.id, j.name, j.status, j.printer ?? '', j.pages ?? '', j.pagesTotal ?? '']
      .map((c) => `"${String(c).replace(/"/g, '""')}"`)
      .join(','),
  );
  return [header, ...lines].join('\n');
}

export function syncItemsToCsv(items: Array<{
  id: string;
  method: string;
  endpoint: string;
  status: string;
  retry_count: number;
  created_at: string;
}>): string {
  const header = 'id,method,endpoint,status,retries,created_at';
  const lines = items.map((i) =>
    [i.id, i.method, i.endpoint, i.status, i.retry_count, i.created_at]
      .map((c) => `"${String(c).replace(/"/g, '""')}"`)
      .join(','),
  );
  return [header, ...lines].join('\n');
}
