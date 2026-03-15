import { useState, useMemo, useCallback, useEffect } from 'react';

// ============================================================
// RMPG Flex — Pagination Hook
// ============================================================
// Handles both client-side and server-side pagination patterns.
// ============================================================

export interface PaginationState {
  page: number;
  pageSize: number;
  total: number;
}

export interface PaginationResult<T> {
  /** Current page of data (client-side only) */
  pageData: T[];
  /** Current page number (1-based) */
  page: number;
  /** Items per page */
  pageSize: number;
  /** Total number of items */
  total: number;
  /** Total number of pages */
  totalPages: number;
  /** Whether there's a next page */
  hasNext: boolean;
  /** Whether there's a previous page */
  hasPrev: boolean;
  /** Go to a specific page */
  goToPage: (page: number) => void;
  /** Go to next page */
  nextPage: () => void;
  /** Go to previous page */
  prevPage: () => void;
  /** Go to first page */
  firstPage: () => void;
  /** Go to last page */
  lastPage: () => void;
  /** Change page size (resets to page 1) */
  setPageSize: (size: number) => void;
  /** Update total count (for server-side pagination) */
  setTotal: (total: number) => void;
  /** Visible page numbers for pagination controls */
  pageNumbers: number[];
  /** Offset for SQL OFFSET clause */
  offset: number;
  /** Display string: "Showing 1-25 of 150" */
  displayRange: string;
}

/**
 * Client-side pagination: slices a data array into pages.
 *
 * @example
 * const { pageData, page, totalPages, nextPage, prevPage, pageNumbers } =
 *   usePagination(warrants, { pageSize: 25 });
 *
 * {pageData.map(w => <WarrantRow key={w.id} warrant={w} />)}
 * <div>{pageNumbers.map(n => <button onClick={() => goToPage(n)}>{n}</button>)}</div>
 */
export function usePagination<T>(
  data: T[],
  options?: { pageSize?: number; initialPage?: number },
): PaginationResult<T> {
  const [page, setPage] = useState(options?.initialPage ?? 1);
  const [pageSize, setPageSizeRaw] = useState(options?.pageSize ?? 25);

  const total = data.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Clamp page to valid range (deferred to effect to avoid setState during render)
  const safePage = Math.min(Math.max(1, page), totalPages);
  useEffect(() => {
    if (safePage !== page) setPage(safePage);
  }, [safePage, page]);

  const pageData = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return data.slice(start, start + pageSize);
  }, [data, safePage, pageSize]);

  const goToPage = useCallback((p: number) => setPage(Math.min(Math.max(1, p), totalPages)), [totalPages]);
  const nextPage = useCallback(() => setPage((p) => Math.min(p + 1, totalPages)), [totalPages]);
  const prevPage = useCallback(() => setPage((p) => Math.max(p - 1, 1)), []);
  const firstPage = useCallback(() => setPage(1), []);
  const lastPage = useCallback(() => setPage(totalPages), [totalPages]);
  const setPageSize = useCallback((size: number) => { setPageSizeRaw(size); setPage(1); }, []);
  const setTotal = useCallback(() => {}, []); // No-op for client-side

  const pageNumbers = useMemo(() => {
    const maxVisible = 7;
    if (totalPages <= maxVisible) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const start = Math.max(1, safePage - 3);
    const end = Math.min(totalPages, start + maxVisible - 1);
    const adjusted = Math.max(1, end - maxVisible + 1);
    return Array.from({ length: Math.min(maxVisible, totalPages) }, (_, i) => adjusted + i);
  }, [totalPages, safePage]);

  const offset = (safePage - 1) * pageSize;
  const rangeStart = total > 0 ? offset + 1 : 0;
  const rangeEnd = Math.min(offset + pageSize, total);
  const displayRange = `Showing ${rangeStart}–${rangeEnd} of ${total}`;

  return {
    pageData, page: safePage, pageSize, total, totalPages,
    hasNext: safePage < totalPages, hasPrev: safePage > 1,
    goToPage, nextPage, prevPage, firstPage, lastPage,
    setPageSize, setTotal, pageNumbers, offset, displayRange,
  };
}

/**
 * Server-side pagination: manages page state for API requests.
 * The caller is responsible for fetching data using `page`, `pageSize`, and `offset`.
 *
 * @example
 * const pager = useServerPagination({ pageSize: 50 });
 *
 * const { data } = useApiData<{ data: Warrant[]; pagination: { total: number } }>(
 *   `/warrants?page=${pager.page}&limit=${pager.pageSize}`
 * );
 *
 * useEffect(() => {
 *   if (data?.pagination) pager.setTotal(data.pagination.total);
 * }, [data]);
 */
export function useServerPagination(
  options?: { pageSize?: number; initialPage?: number },
): Omit<PaginationResult<never>, 'pageData'> {
  const [page, setPage] = useState(options?.initialPage ?? 1);
  const [pageSize, setPageSizeRaw] = useState(options?.pageSize ?? 25);
  const [total, setTotalRaw] = useState(0);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);

  const goToPage = useCallback((p: number) => setPage(Math.min(Math.max(1, p), totalPages)), [totalPages]);
  const nextPage = useCallback(() => setPage((p) => Math.min(p + 1, totalPages)), [totalPages]);
  const prevPage = useCallback(() => setPage((p) => Math.max(p - 1, 1)), []);
  const firstPage = useCallback(() => setPage(1), []);
  const lastPage = useCallback(() => setPage(totalPages), [totalPages]);
  const setPageSize = useCallback((size: number) => { setPageSizeRaw(size); setPage(1); }, []);
  const setTotal = useCallback((t: number) => setTotalRaw(t), []);

  const pageNumbers = useMemo(() => {
    const maxVisible = 7;
    if (totalPages <= maxVisible) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const start = Math.max(1, safePage - 3);
    const end = Math.min(totalPages, start + maxVisible - 1);
    const adjusted = Math.max(1, end - maxVisible + 1);
    return Array.from({ length: Math.min(maxVisible, totalPages) }, (_, i) => adjusted + i);
  }, [totalPages, safePage]);

  const offset = (safePage - 1) * pageSize;
  const rangeStart = total > 0 ? offset + 1 : 0;
  const rangeEnd = Math.min(offset + pageSize, total);
  const displayRange = `Showing ${rangeStart}–${rangeEnd} of ${total}`;

  return {
    page: safePage, pageSize, total, totalPages,
    hasNext: safePage < totalPages, hasPrev: safePage > 1,
    goToPage, nextPage, prevPage, firstPage, lastPage,
    setPageSize, setTotal, pageNumbers, offset, displayRange,
  };
}

export default usePagination;
