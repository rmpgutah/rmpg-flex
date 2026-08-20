// Form auto-save ("filler") utility — D1-backed via /api/form-drafts.
//
// Data-entry state is debounced-saved to D1 (cross-device, survives
// reloads) instead of localStorage-only. localStorage is kept as a
// write-through cache so a save fires instantly and still works
// offline; the D1 write is best-effort and retried on the next save.
// clear() must only be called AFTER the real record is confirmed
// saved — calling it speculatively would delete the draft if the
// actual save then fails.

import { apiFetch } from '../hooks/useApi';

const AUTOSAVE_PREFIX = 'rmpg_autosave_';

function draftPath(formId: string, entityId?: string): string {
  return entityId ? `/form-drafts/${formId}/${entityId}` : `/form-drafts/${formId}`;
}

export function createAutoSaver(formId: string, debounceMs = 2000, entityId?: string) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const storageKey = `${AUTOSAVE_PREFIX}${formId}${entityId ? `_${entityId}` : ''}`;

  return {
    /** Save form data (debounced): instant local write-through + best-effort D1 sync */
    save(data: Record<string, any>): void {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          localStorage.setItem(storageKey, JSON.stringify({ data, savedAt: Date.now() }));
        } catch {
          // localStorage full — D1 write below still carries the draft
        }
        apiFetch(draftPath(formId, entityId), {
          method: 'PUT',
          body: JSON.stringify({ data }),
        }).catch(() => {
          // Offline/network failure — local cache above still has it;
          // the next successful save() call re-syncs to D1.
        });
      }, debounceMs);
    },

    /** Load saved form data — prefers D1 (cross-device), falls back to local cache */
    async load(): Promise<{ data: Record<string, any>; savedAt: number } | null> {
      try {
        const res = await apiFetch<{ data: Record<string, any> | null; updatedAt?: string }>(
          draftPath(formId, entityId)
        );
        if (res.data) {
          return { data: res.data, savedAt: res.updatedAt ? Date.parse(res.updatedAt) : Date.now() };
        }
      } catch {
        // Fall through to local cache below
      }

      try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (Date.now() - parsed.savedAt > 24 * 60 * 60 * 1000) {
          localStorage.removeItem(storageKey);
          return null;
        }
        return parsed;
      } catch {
        return null;
      }
    },

    /** Clear saved form data — call ONLY after the real save is confirmed successful */
    clear(): void {
      if (timer) clearTimeout(timer);
      localStorage.removeItem(storageKey);
      apiFetch(draftPath(formId, entityId), { method: 'DELETE' }).catch(() => {
        // Best-effort — an orphaned D1 draft row is harmless and gets
        // overwritten by the next save() for this formId/entityId.
      });
    },

    /** Check if there's saved data in the local cache (synchronous, non-authoritative) */
    hasSavedData(): boolean {
      return localStorage.getItem(storageKey) !== null;
    },
  };
}

/** Clear all locally-cached auto-saved form data (does not touch D1 drafts) */
export function clearAllAutoSaves(): void {
  const keys = Object.keys(localStorage).filter((k) => k.startsWith(AUTOSAVE_PREFIX));
  keys.forEach((k) => localStorage.removeItem(k));
}
