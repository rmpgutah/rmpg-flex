import { useEffect, useState } from 'react';

export interface StandaloneState {
  isStandalone: boolean;
  isIOS: boolean;
  isMobileViewport: boolean;
}

const MOBILE_BREAKPOINT_PX = 768;

function detect(): StandaloneState {
  const isStandalone =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches ||
      // legacy iOS Safari
      (navigator as any).standalone === true);
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent ?? '');
  const isMobileViewport =
    typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT_PX;
  return { isStandalone, isIOS, isMobileViewport };
}

export function useStandalone(): StandaloneState {
  const [state, setState] = useState<StandaloneState>(detect);
  useEffect(() => {
    const onResize = () => setState(detect());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return state;
}
