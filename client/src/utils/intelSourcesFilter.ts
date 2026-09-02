export interface IntelSourceRow {
  id: number;
  source_code: string;
  source_type: string;
  display_label: string | null;
  reliability_grade: string | null;
  status: string;
  restricted?: number;
  _restricted?: boolean;
}

export interface SourceFilters {
  q: string;
  type: string;
  status: string;
  grade: string;
}

export function filterSources(rows: IntelSourceRow[], f: SourceFilters): IntelSourceRow[] {
  const q = f.q.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.type && r.source_type !== f.type) return false;
    if (f.status && r.status !== f.status) return false;
    if (f.grade && (r.reliability_grade ?? '') !== f.grade) return false;
    if (!q) return true;
    const hay = `${r.source_code} ${r.source_type} ${r.display_label ?? ''}`.toLowerCase();
    return hay.includes(q);
  });
}

export function sourceStats(rows: IntelSourceRow[]): {
  total: number;
  active: number;
  restricted: number;
  byGrade: Record<string, number>;
} {
  const byGrade: Record<string, number> = {};
  let active = 0;
  let restricted = 0;
  for (const r of rows) {
    if (r.status === 'active') active += 1;
    if (r.restricted === 1 || r._restricted) restricted += 1;
    const g = r.reliability_grade || '?';
    byGrade[g] = (byGrade[g] || 0) + 1;
  }
  return { total: rows.length, active, restricted, byGrade };
}

/** CSV omits identity notes and true-identity person ids — those stay on the server. */
export function sourcesToCsv(rows: IntelSourceRow[]): string {
  const header = 'code,type,label,reliability,status';
  const lines = rows.map((r) =>
    [r.source_code, r.source_type, r.display_label ?? '', r.reliability_grade ?? '', r.status]
      .map((c) => `"${String(c).replace(/"/g, '""')}"`)
      .join(','),
  );
  return [header, ...lines].join('\n');
}

export function filterIntelReports<T extends { title: string; report_number: string; status: string; threat_level: string }>(
  rows: T[],
  q: string,
): T[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((r) =>
    `${r.title} ${r.report_number} ${r.status} ${r.threat_level}`.toLowerCase().includes(needle),
  );
}
