import { useEffect, useCallback } from 'react';

/**
 * Hook that warns users when they try to leave a page with unsaved changes.
 * Registers a `beforeunload` event listener that shows a browser-native
 * confirmation dialog. This ensures data persistence — changes are either
 * saved or the user explicitly chooses to discard them.
 *
 * @param isDirty - Whether there are currently unsaved changes
 * @param message - Optional custom message (most browsers ignore custom text)
 */
export function useUnsavedChanges(isDirty: boolean, _message?: string) {
  const handleBeforeUnload = useCallback(
    (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        // Most modern browsers ignore custom messages, but this is required
        e.returnValue = '';
      }
    },
    [isDirty]
  );

  useEffect(() => {
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [handleBeforeUnload]);
}

export default useUnsavedChanges;
