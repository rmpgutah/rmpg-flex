import { useState, useCallback, useRef, useEffect } from 'react';
import { useUnsavedChanges } from './useUnsavedChanges';

interface UseFormDraftOptions<T> {
  /** localStorage key (prefix with 'rmpg_' for consistency) */
  storageKey: string;
  /** Default/empty form value */
  defaultValue: T;
  /** Whether the form/modal is currently open or active */
  isActive?: boolean;
  /** Time-to-live in milliseconds (default: 24 hours) */
  ttlMs?: number;
  /** Called when draft is restored from storage */
  onRestore?: (draft: T) => void;
  /** Called when draft is cleared (after successful save) */
  onClear?: () => void;
  /** Debounce interval in ms for auto-save to storage (default: 500) */
  debounceMs?: number;
}

interface UseFormDraftReturn<T> {
  /** Current form value (restored from storage on mount if available) */
  form: T;
  /** Setter that also persists to localStorage */
  setForm: (val: T | ((prev: T) => T)) => void;
  /** Whether form has diverged from the initial/default value */
  isDirty: boolean;
  /** Whether a draft was restored from storage on mount */
  wasRestored: boolean;
  /** Clear the draft from storage and reset form to default */
  clearDraft: () => void;
  /** Manually save current form to storage */
  saveDraft: () => void;
  /** Take a snapshot of the current form as the "clean" baseline */
  snapshot: () => void;
}

/**
 * A comprehensive form persistence hook that:
 * 1. Auto-saves form state to localStorage with debounce
 * 2. Restores drafts on mount (with TTL expiry)
 * 3. Tracks dirty state via JSON comparison
 * 4. Registers beforeunload warning when dirty
 * 5. Auto-saves on unmount via keepalive fetch pattern
 *
 * Usage:
 *   const { form, setForm, isDirty, wasRestored, clearDraft, saveDraft, snapshot } = useFormDraft({
 *     storageKey: 'rmpg_citation_form',
 *     defaultValue: EMPTY_FORM,
 *     isActive: isEditing,
 *   });
 *
 *   // After loading existing record data:
 *   snapshot(); // sets clean baseline
 *
 *   // After successful save to database:
 *   clearDraft();
 */
export function useFormDraft<T>({
  storageKey,
  defaultValue,
  isActive = true,
  ttlMs = 24 * 60 * 60 * 1000, // 24 hours
  onRestore,
  onClear,
  debounceMs = 500,
}: UseFormDraftOptions<T>): UseFormDraftReturn<T> {
  const [form, setFormRaw] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw != null) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && parsed._savedAt != null) {
          const age = Date.now() - parsed._savedAt;
          if (age < ttlMs) {
            const { _savedAt, ...draft } = parsed;
            return draft as T;
          }
        }
      }
    } catch { /* ignore parse errors */ }
    return defaultValue;
  });

  const [wasRestored, setWasRestored] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw != null) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && parsed._savedAt != null) {
          const age = Date.now() - parsed._savedAt;
          return age < ttlMs;
        }
      }
    } catch { /* ignore */ }
    return false;
  });

  const initialRef = useRef<string>('');
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formRef = useRef(form);
  formRef.current = form;

  // Notify parent when draft is restored
  useEffect(() => {
    if (wasRestored && onRestore) {
      const raw = localStorage.getItem(storageKey);
      if (raw != null) {
        try {
          const parsed = JSON.parse(raw);
          const { _savedAt, ...draft } = parsed;
          onRestore(draft as T);
        } catch { /* ignore */ }
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced auto-save to localStorage
  const saveDraft = useCallback(() => {
    try {
      const payload = { ...formRef.current, _savedAt: Date.now() };
      localStorage.setItem(storageKey, JSON.stringify(payload));
    } catch { /* quota exceeded — ignore */ }
  }, [storageKey]);

  const setForm = useCallback(
    (val: T | ((prev: T) => T)) => {
      setFormRaw((prev) => {
        const next = typeof val === 'function' ? (val as (prev: T) => T)(prev) : val;
        // Debounced save
        if (debounceTimer.current != null) clearTimeout(debounceTimer.current);
        debounceTimer.current = setTimeout(() => {
          try {
            const payload = { ...next, _savedAt: Date.now() };
            localStorage.setItem(storageKey, JSON.stringify(payload));
          } catch { /* ignore */ }
        }, debounceMs);
        return next;
      });
    },
    [storageKey, debounceMs],
  );

  // Snapshot: capture current form as the "clean" baseline
  const snapshot = useCallback(() => {
    initialRef.current = JSON.stringify(formRef.current);
  }, []);

  // Clear draft and reset
  const clearDraft = useCallback(() => {
    localStorage.removeItem(storageKey);
    setFormRaw(defaultValue);
    initialRef.current = '';
    if (onClear) onClear();
  }, [storageKey, defaultValue, onClear]);

  // Dirty calculation
  const isDirty = isActive && initialRef.current !== '' && JSON.stringify(form) !== initialRef.current;

  // Browser-level unsaved changes warning
  useUnsavedChanges(isDirty);

  // Auto-save on unmount (best-effort via synchronous localStorage write)
  useEffect(() => {
    return () => {
      if (debounceTimer.current != null) {
        clearTimeout(debounceTimer.current);
      }
      // Synchronous save on unmount to ensure data is not lost
      try {
        const payload = { ...formRef.current, _savedAt: Date.now() };
        localStorage.setItem(storageKey, JSON.stringify(payload));
      } catch { /* ignore */ }
    };
  }, [storageKey]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current != null) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, []);

  return { form, setForm, isDirty, wasRestored, clearDraft, saveDraft, snapshot };
}

export default useFormDraft;
