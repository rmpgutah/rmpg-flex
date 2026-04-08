import { useRef, useCallback } from 'react';

/**
 * Tracks whether a form has been modified from its initial state.
 * Use with FormModal's `isDirty` prop to enforce data retention.
 *
 * Usage:
 *   const { isDirty, snapshot } = useFormDirty(form, isOpen);
 *   // In your useEffect where you init the form:
 *   snapshot(initialFormValue);
 *   // Pass isDirty to <FormModal isDirty={isDirty} ...>
 */
export function useFormDirty<T>(form: T, isOpen: boolean): {
  isDirty: boolean;
  /** Call after setting the initial form value so we know what "clean" looks like. */
  snapshot: (initial: T) => void;
} {
  const initialRef = useRef<string>('');

  const snapshot = useCallback((initial: T) => {
    initialRef.current = JSON.stringify(initial);
  }, []);

  const isDirty = isOpen && initialRef.current !== '' && JSON.stringify(form) !== initialRef.current;

  return { isDirty, snapshot };
}

export default useFormDirty;
