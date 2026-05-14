import { countCalls, listCalls } from '../../db/dispatchQueries';
import type { DispatchCallFilters, DispatchPagination, DispatchServiceResult } from '../../types/dispatch';

export function normalizeDispatchCallFilters(input: Partial<Record<string, unknown>>): DispatchCallFilters {
  const page = Math.max(1, parseInt(String(input.page ?? '1'), 10) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(String(input.limit ?? '50'), 10) || 50));
  const archived = input.archived === 'true' || input.archived === 'all'
    ? input.archived
    : 'false';
  const propertyIdValue = input.propertyId;
  const parsedPropertyId = propertyIdValue == null || propertyIdValue === ''
    ? undefined
    : Number(propertyIdValue);

  return {
    status: typeof input.status === 'string' ? input.status : undefined,
    priority: typeof input.priority === 'string' ? input.priority : undefined,
    startDate: typeof input.startDate === 'string' ? input.startDate : undefined,
    endDate: typeof input.endDate === 'string' ? input.endDate : undefined,
    propertyId: Number.isFinite(parsedPropertyId) ? parsedPropertyId : undefined,
    archived,
    page,
    limit,
  };
}

export function listDispatchCalls(
  filters: DispatchCallFilters
): DispatchServiceResult<{ data: unknown[]; pagination: DispatchPagination }> {
  const total = countCalls(filters);
  const data = listCalls(filters);

  return {
    ok: true,
    data: {
      data,
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total,
        totalPages: Math.ceil(total / filters.limit),
      },
    },
  };
}
