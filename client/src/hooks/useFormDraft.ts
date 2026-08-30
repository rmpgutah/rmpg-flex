import { useState, useCallback, useRef, useEffect } from 'react';
import { useUnsavedChanges } from './useUnsavedChanges';
import { apiFetch } from './useApi';

// D1-backed mirror of the draft, keyed by storageKey — so a draft survives
// a localStorage clear, private-window session, or switching devices, not
// just the current browser. Every write is fire-and-forget (localStorage
// stays the fast/synchronous source of truth); D1 is best-effort recovery.
function draftPath(storageKey: string): string {
  return `/form-drafts/${encodeURIComponent(storageKey)}`;
}
function syncDraftToD1(storageKey: string, data: unknown): void {
  apiFetch(draftPath(storageKey), { method: 'PUT', body: JSON.stringify({ data }) }).catch(() => {
    // Offline/network failure — localStorage still has it; next save retries.
  });
}
function deleteDraftFromD1(storageKey: string): void {
  apiFetch(draftPath(storageKey), { method: 'DELETE' }).catch(() => {
    // Best-effort — an orphaned D1 row is harmless, overwritten by the next save.
  });
}

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
  /**
   * Signal that the form was successfully saved. Removes the draft from
   * storage and blocks the unmount auto-save WITHOUT resetting form state —
   * safe to call just before delegating to onSubmit so the form doesn't
   * visually blank out before the parent closes the modal.
   */
  signalSaved: () => void;
  /** Manually save current form to storage */
  saveDraft: () => void;
  /** Take a snapshot of the current form as the "clean" baseline */
  snapshot: () => void;
}

/**
 * Overlay a stored draft onto the current defaultValue so newly added form
 * fields (nested objects included) exist after schema evolution. A draft
 * saved before `ops` was added must still produce `ops.venue_kind`, not
 * crash the page that always evaluates the form JSX.
 */
export function mergeFormDraft<T>(defaultValue: T, draft: unknown): T {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return defaultValue;
  const defaults = defaultValue as Record<string, unknown>;
  const src = draft as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...defaults, ...src };
  for (const key of Object.keys(defaults)) {
    const d = defaults[key];
    const m = merged[key];
    if (d != null && typeof d === 'object' && !Array.isArray(d)) {
      if (m == null || typeof m !== 'object' || Array.isArray(m)) {
        merged[key] = d;
      } else {
        merged[key] = { ...(d as Record<string, unknown>), ...(m as Record<string, unknown>) };
      }
    }
  }
  return merged as T;
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
            return mergeFormDraft(defaultValue, draft);
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
          onRestore(mergeFormDraft(defaultValue, draft));
        } catch { /* ignore */ }
      }
    } else if (!wasRestored) {
      // No local draft (cleared storage, private window, new device) —
      // fall back to the D1-mirrored copy so in-progress edits aren't lost.
      apiFetch<{ data: T | null }>(draftPath(storageKey)).then((res) => {
        if (res.data == null) return;
        const merged = mergeFormDraft(defaultValue, res.data);
        clearedRef.current = false;
        setFormRaw(merged);
        setWasRestored(true);
        if (onRestore) onRestore(merged);
      }).catch(() => { /* offline or no D1 draft — stay on defaultValue */ });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced auto-save to localStorage
  const saveDraft = useCallback(() => {
    try {
      const payload = { ...formRef.current, _savedAt: Date.now() };
      localStorage.setItem(storageKey, JSON.stringify(payload));
    } catch { /* quota exceeded — ignore */ }
    syncDraftToD1(storageKey, formRef.current);
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
          syncDraftToD1(storageKey, next);
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

  // Clear draft and reset
  const clearDraft = useCallback(() => {
    clearedRef.current = true; // prevent unmount from re-saving after a successful save
    localStorage.removeItem(storageKey);
    deleteDraftFromD1(storageKey);
    setFormRaw(defaultValue);
    initialRef.current = '';
    if (onClear) onClear();
  }, [storageKey, defaultValue, onClear]);

  // Signal a successful save: remove from localStorage and block the unmount
  // auto-save without resetting form state (so the form doesn't flash blank
  // before the parent closes the modal on success).
  const signalSaved = useCallback(() => {
    clearedRef.current = true;
    localStorage.removeItem(storageKey);
    deleteDraftFromD1(storageKey);
  }, [storageKey]);

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
      syncDraftToD1(storageKey, formRef.current);
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

  return { form, setForm, isDirty, wasRestored, clearDraft, signalSaved, saveDraft, snapshot };
}

export default useFormDraft;
