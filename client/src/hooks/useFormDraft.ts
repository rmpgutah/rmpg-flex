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
  /**
   * Clear the draft from storage. Pass `{ resetForm: false }` to suppress the
   * form-state reset (useful when calling just before delegating to onSubmit so
   * the form doesn't visually blank out before the parent closes the modal).
   * Also safe to use directly as an onClick handler — MouseEvent is ignored.
   */
  clearDraft: (opts?: { resetForm?: boolean } | Event) => void;
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
  // Set to true by clearDraft() so the unmount cleanup skips the auto-save.
  // Reset to false by snapshot() and setForm() so re-opening the same modal
  // instance (without unmounting) gets a fresh save-on-unmount cycle.
  const clearedRef = useRef(false);

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
      clearedRef.current = false; // user is editing again — re-enable unmount-save
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
    clearedRef.current = false; // fresh open cycle — re-enable unmount-save
    initialRef.current = JSON.stringify(formRef.current);
  }, []);

  // Clear draft and reset.
  // Accepts an optional Event (when used directly as onClick) — ignored at runtime.
  const clearDraft = useCallback((optsOrEvent?: { resetForm?: boolean } | Event) => {
    clearedRef.current = true; // prevent unmount from re-saving after a successful save
    localStorage.removeItem(storageKey);
    const opts = (optsOrEvent == null || optsOrEvent instanceof Event) ? undefined : optsOrEvent;
    if (opts?.resetForm !== false) {
      setFormRaw(defaultValue);
      initialRef.current = '';
    }
    if (onClear) onClear();
  }, [storageKey, defaultValue, onClear]);

  // Dirty calculation
  const isDirty = isActive && initialRef.current !== '' && JSON.stringify(form) !== initialRef.current;

  // Browser-level unsaved changes warning
  useUnsavedChanges(isDirty);

  // Auto-save on unmount (best-effort via synchronous localStorage write).
  // Skip when clearDraft() was called — the save already succeeded and we must
  // not resurrect stale data for the next open.
  useEffect(() => {
    return () => {
      if (debounceTimer.current != null) {
        clearTimeout(debounceTimer.current);
      }
      if (clearedRef.current) return;
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
