import { useCallback, useState } from 'react';
import type { PreviewMode } from './useCitationPreview';

const KEY = 'rmpg.citation.preview_mode';
const VALID: PreviewMode[] = ['modal', 'side', 'full'];

export function usePersistedPreviewMode(): [PreviewMode, (m: PreviewMode) => void] {
  const [mode, setModeState] = useState<PreviewMode>(() => {
    try {
      const v = localStorage.getItem(KEY);
      return v && (VALID as string[]).includes(v) ? (v as PreviewMode) : 'modal';
    } catch {
      return 'modal';
    }
  });
  const setMode = useCallback((m: PreviewMode) => {
    try { localStorage.setItem(KEY, m); } catch { /* ignore quota / privacy mode */ }
    setModeState(m);
  }, []);
  return [mode, setMode];
}
