// Form auto-save utility

const AUTOSAVE_PREFIX = 'rmpg_autosave_';

/** Save form data with debounce */
export function createAutoSaver(formId: string, debounceMs = 2000) {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    /** Save form data (debounced) */
    save(data: Record<string, any>): void {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          localStorage.setItem(
            `${AUTOSAVE_PREFIX}${formId}`,
            JSON.stringify({ data, savedAt: Date.now() })
          );
        } catch {
          // localStorage full
        }
      }, debounceMs);
    },

    /** Load saved form data */
    load(): { data: Record<string, any>; savedAt: number } | null {
      try {
        const raw = localStorage.getItem(`${AUTOSAVE_PREFIX}${formId}`);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        // Expire after 24 hours
        if (Date.now() - parsed.savedAt > 24 * 60 * 60 * 1000) {
          localStorage.removeItem(`${AUTOSAVE_PREFIX}${formId}`);
          return null;
        }
        return parsed;
      } catch {
        return null;
      }
    },

    /** Clear saved form data */
    clear(): void {
      if (timer) clearTimeout(timer);
      localStorage.removeItem(`${AUTOSAVE_PREFIX}${formId}`);
    },

    /** Check if there's saved data */
    hasSavedData(): boolean {
      return localStorage.getItem(`${AUTOSAVE_PREFIX}${formId}`) !== null;
    },
  };
}

/** Clear all auto-saved form data */
export function clearAllAutoSaves(): void {
  const keys = Object.keys(localStorage).filter((k) => k.startsWith(AUTOSAVE_PREFIX));
  keys.forEach((k) => localStorage.removeItem(k));
}
