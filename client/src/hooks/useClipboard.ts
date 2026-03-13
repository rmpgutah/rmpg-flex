import { useState, useCallback, useRef, useEffect } from 'react';

// ============================================================
// RMPG Flex — Clipboard & Document Title Hooks
// ============================================================

/**
 * Copy text to clipboard with feedback state.
 * Returns `copied` boolean that auto-resets after timeout.
 *
 * @example
 * const { copy, copied } = useClipboard();
 * <button onClick={() => copy(warrantNumber)}>
 *   {copied ? 'Copied!' : 'Copy'}
 * </button>
 */
export function useClipboard(resetDelay = 2000) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), resetDelay);
        return true;
      } catch {
        // Fallback for older browsers / non-HTTPS
        try {
          const textarea = document.createElement('textarea');
          textarea.value = text;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);
          setCopied(true);
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => setCopied(false), resetDelay);
          return true;
        } catch {
          return false;
        }
      }
    },
    [resetDelay],
  );

  // Clear pending timer on unmount to prevent setState on unmounted component
  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  return { copy, copied };
}

export default useClipboard;
