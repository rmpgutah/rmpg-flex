import { useRef, useEffect, useCallback } from 'react';

interface UseAutoSaveOnUnmountOptions<T> {
  /** Whether the form is currently in edit mode */
  isActive: boolean;
  /** Function to call on unmount to save data to database */
  onSave: () => void | Promise<void>;
  /** Whether to skip auto-save (e.g., user explicitly cancelled) */
  skipRef?: React.MutableRefObject<boolean>;
}

/**
 * Hook that automatically saves form data to the database when the component unmounts.
 * Uses a ref to avoid stale closures and supports a skip flag for explicit cancellations.
 *
 * This is a best-effort save — if the server is unreachable, the data remains in localStorage
 * (via useFormDraft) and will be restored on next visit.
 *
 * Usage:
 *   const skipSave = useRef(false);
 *   useAutoSaveOnUnmount({
 *     isActive: isEditing,
 *     onSave: async () => {
 *       await apiFetch(`/api/citations/${editId}`, { method: 'PUT', body: JSON.stringify(editData) });
 *     },
 *     skipRef: skipSave,
 *   });
 *
 *   // When user clicks Cancel:
 *   skipSave.current = true;
 *   setIsEditing(false);
 */
export function useAutoSaveOnUnmount<T>({
  isActive,
  onSave,
  skipRef,
}: UseAutoSaveOnUnmountOptions<T>) {
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;

  useEffect(() => {
    return () => {
      // Only auto-save if was active and not explicitly skipped
      if (isActiveRef.current && (!skipRef || !skipRef.current)) {
        try {
          onSaveRef.current();
        } catch {
          // Best-effort save — errors are silently caught
          // Data remains in localStorage via useFormDraft
        }
      }
    };
  }, [skipRef]);
}

/**
 * Hook that flushes pending saves on beforeunload (browser close/refresh).
 * Useful for debounced auto-save patterns where the timer hasn't fired yet.
 *
 * Usage:
 *   const { scheduleFlush, flushPending } = useBeforeunloadFlush();
 *   const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
 *
 *   const handleChange = (field: string, value: string) => {
 *     setForm(prev => ({ ...prev, [field]: value }));
 *     if (timerRef.current) clearTimeout(timerRef.current);
 *     timerRef.current = setTimeout(() => {
 *       apiFetch(`/api/...`, { method: 'PUT', body: JSON.stringify({ [field]: value }) });
 *     }, 1500);
 *   };
 *
 *   useBeforeunloadFlush({
 *     isActive: isEditing,
 *     flushFn: () => {
 *       if (timerRef.current) {
 *         clearTimeout(timerRef.current);
 *         // Trigger immediate save
 *       }
 *     },
 *   });
 */
interface UseBeforeunloadFlushOptions {
  isActive: boolean;
  flushFn: () => void;
}

export function useBeforeunloadFlush({ isActive, flushFn }: UseBeforeunloadFlushOptions) {
  const flushFnRef = useRef(flushFn);
  flushFnRef.current = flushFn;

  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isActiveRef.current) {
        flushFnRef.current();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);
}

export default useAutoSaveOnUnmount;
