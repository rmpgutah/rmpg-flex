/** Stable sort for status-grid rows. Returns a NEW array (never mutates).
 *  Numbers compare numerically; everything else compares as natural strings;
 *  null/undefined sort last regardless of direction. */
export function sortGridRows<T extends Record<string, any>>(
  rows: T[],
  key: string,
  dir: 'asc' | 'desc' = 'asc',
): T[] {
  const sign = dir === 'desc' ? -1 : 1;
  return rows
    .map((row, index) => [row, index] as const)
    .sort(([a, ia], [b, ib]) => {
      const av = a[key];
      const bv = b[key];
      const aNull = av === null || av === undefined;
      const bNull = bv === null || bv === undefined;
      if (aNull && bNull) return ia - ib;
      if (aNull) return 1;
      if (bNull) return -1;
      let cmp: number;
      if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
      return cmp !== 0 ? cmp * sign : ia - ib;
    })
    .map(([row]) => row);
}
