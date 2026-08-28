export interface TrainingListFilters {
  page: number;
  docType: string;
  labeled: string;
  from: string;
  to: string;
  selected: string;
}

export function parseTrainingSearchParams(sp: URLSearchParams): TrainingListFilters {
  const pageRaw = parseInt(sp.get('page') || '1', 10);
  return {
    page: Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1,
    docType: sp.get('doc_type') || '',
    labeled: sp.get('labeled') || '',
    from: sp.get('from') || '',
    to: sp.get('to') || '',
    selected: sp.get('id') || '',
  };
}

export function trainingFiltersToSearchParams(filters: TrainingListFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.page > 1) params.set('page', String(filters.page));
  if (filters.docType) params.set('doc_type', filters.docType);
  if (filters.labeled) params.set('labeled', filters.labeled);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.selected) params.set('id', filters.selected);
  return params;
}

export function trainingListQueryString(filters: Pick<TrainingListFilters, 'page' | 'docType' | 'labeled' | 'from' | 'to'>): string {
  const params = new URLSearchParams({ page: String(filters.page) });
  if (filters.docType) params.set('doc_type', filters.docType);
  if (filters.labeled) params.set('labeled', filters.labeled);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  return params.toString();
}
