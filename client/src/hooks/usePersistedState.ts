import { useState, useCallback } from 'react';

/**
 * A drop-in replacement for useState that persists to localStorage.
 * Value is loaded from storage on mount and written back on every update.
 *
 * @param key   localStorage key (prefix with 'rmpg_' for consistency)
 * @param defaultValue  fallback when nothing is stored
 * @param validator  optional function to validate loaded value (return false to use default)
 */
export function usePersistedState<T>(
  key: string,
  defaultValue: T,
  validator?: (val: unknown) => boolean,
): [T, (val: T | ((prev: T) => T)) => void] {
  const [state, setStateRaw] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return defaultValue;
      const parsed = JSON.parse(raw) as T;
      if (validator && !validator(parsed)) return defaultValue;
      return parsed;
    } catch {
      return defaultValue;
    }
  });

  const setState = useCallback(
    (val: T | ((prev: T) => T)) => {
      setStateRaw((prev) => {
        const next = typeof val === 'function' ? (val as (prev: T) => T)(prev) : val;
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch { /* quota exceeded — ignore */ }
        return next;
      });
    },
    [key],
  );

  return [state, setState];
}

/**
 * Convenience wrapper: persist a simple string enum tab value.
 */
export function usePersistedTab<T extends string>(
  key: string,
  defaultTab: T,
  validTabs: readonly T[],
): [T, (tab: T) => void] {
  return usePersistedState<T>(
    key,
    defaultTab,
    (v) => typeof v === 'string' && (validTabs as readonly string[]).includes(v),
  );
}

export default usePersistedState;
