// ============================================================
// RMPG Flex — Mobile / Platform Detection Hooks
// Shared hooks for responsive layout and Android detection
// ============================================================

import { useState, useEffect, useCallback } from 'react';

// ─── Viewport-based mobile detection ─────────────────────────
// Mirrors the CSS breakpoint at 768px used throughout the app.
// Listens for resize so orientation changes are handled.

export function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < breakpoint : false,
  );

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < breakpoint);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [breakpoint]);

  return isMobile;
}

// ─── Capacitor / Android platform detection ──────────────────
// Based on existing patterns in AndroidUpdateChecker.tsx and
// PanicButton.tsx. Checks both Capacitor API and user-agent.

export function useIsAndroid() {
  const [isAndroid] = useState(() => {
    if (typeof window === 'undefined') return false;
    const cap = (window as any).Capacitor;
    if (cap?.isNativePlatform?.() && cap?.getPlatform?.() === 'android') return true;
    const ua = navigator.userAgent;
    return /Android/i.test(ua) && (/wv|Version\/\d/.test(ua) || /RMPGFlex/.test(ua));
  });
  return isAndroid;
}

export function useIsCapacitor() {
  const [isCapacitor] = useState(() => {
    if (typeof window === 'undefined') return false;
    return typeof (window as any).Capacitor !== 'undefined';
  });
  return isCapacitor;
}

// ─── Capacitor / iOS platform detection ─────────────────────
// Mirrors the Android hook above. Checks Capacitor API + user-agent.

export function useIsIOS() {
  const [isIOS] = useState(() => {
    if (typeof window === 'undefined') return false;
    const cap = (window as any).Capacitor;
    if (cap?.isNativePlatform?.() && cap?.getPlatform?.() === 'ios') return true;
    return /RMPGFlex\/iOS/.test(navigator.userAgent);
  });
  return isIOS;
}

// ─── Combined mobile layout hook ─────────────────────────────
// Single hook for components that need all mobile context.

export function useMobileLayout(breakpoint = 768) {
  const isMobile = useIsMobile(breakpoint);
  const isAndroid = useIsAndroid();
  const isIOS = useIsIOS();
  const isCapacitor = useIsCapacitor();

  return { isMobile, isAndroid, isIOS, isCapacitor };
}

export default useIsMobile;
