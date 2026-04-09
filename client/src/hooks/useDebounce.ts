import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

// ============================================================
// RMPG Flex — Debounce & Throttle Hooks
// ============================================================
// Optimizes frequent updates (search inputs, resize handlers,
// scroll listeners) to prevent unnecessary renders and API calls.
// ============================================================

/**
 * Returns a debounced version of the provided value.
 * The returned value only updates after `delay` ms of inactivity.
 *
 * @example
 * const [search, setSearch] = useState('');
 * const debouncedSearch = useDebounce(search, 300);
 *
 * useEffect(() => {
 *   if (debouncedSearch) fetchResults(debouncedSearch);
 * }, [debouncedSearch]);
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Returns a debounced callback function.
 * The callback only fires after `delay` ms of inactivity.
 * Includes a `.cancel()` method and `.flush()` to fire immediately.
 *
 * @example
 * const debouncedSave = useDebouncedCallback((data) => {
 *   apiFetch('/api/save', { method: 'POST', body: JSON.stringify(data) });
 * }, 500);
 *
 * <input onChange={(e) => debouncedSave(e.target.value)} />
 */
export function useDebouncedCallback<T extends (...args: any[]) => any>(
  callback: T,
  delay: number,
): T & { cancel: () => void; flush: () => void } {
  const callbackRef = useRef(callback);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pendingArgsRef = useRef<Parameters<T> | null>(null);

  // Always use latest callback
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const cancel = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    pendingArgsRef.current = null;
  }, []);

  const flush = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (pendingArgsRef.current) {
      callbackRef.current(...pendingArgsRef.current);
      pendingArgsRef.current = null;
    }
  }, []);

  const debounced = useCallback(
    (...args: Parameters<T>) => {
      pendingArgsRef.current = args;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        callbackRef.current(...args);
        pendingArgsRef.current = null;
      }, delay);
    },
    [delay],
  ) as T & { cancel: () => void; flush: () => void };

  debounced.cancel = cancel;
  debounced.flush = flush;

  // Cleanup on unmount
  useEffect(() => cancel, [cancel]);

  return debounced;
}

/**
 * Returns a throttled callback function.
 * The callback fires at most once every `interval` ms.
 * Leading call fires immediately; subsequent calls are delayed.
 *
 * @example
 * const throttledScroll = useThrottledCallback((scrollY) => {
 *   updateScrollPosition(scrollY);
 * }, 100);
 *
 * useEffect(() => {
 *   const handler = () => throttledScroll(window.scrollY);
 *   window.addEventListener('scroll', handler);
 *   return () => window.removeEventListener('scroll', handler);
 * }, [throttledScroll]);
 */
export function useThrottledCallback<T extends (...args: any[]) => any>(
  callback: T,
  interval: number,
): T {
  const callbackRef = useRef(callback);
  const lastCallRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const throttled = useCallback(
    (...args: Parameters<T>) => {
      const now = Date.now();
      const elapsed = now - lastCallRef.current;

      if (elapsed >= interval) {
        lastCallRef.current = now;
        callbackRef.current(...args);
      } else {
        // Schedule trailing call
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          lastCallRef.current = Date.now();
          callbackRef.current(...args);
        }, interval - elapsed);
      }
    },
    [interval],
  ) as T;

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return throttled;
}

export default useDebounce;
