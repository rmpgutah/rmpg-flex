import { useEffect } from 'react';
import { lockBodyScroll, unlockBodyScroll } from '../utils/bodyScrollLock';

export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    lockBodyScroll();
    return () => unlockBodyScroll();
  }, [active]);
}
