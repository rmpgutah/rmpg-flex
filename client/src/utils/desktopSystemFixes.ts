// ============================================================
// RMPG FlexOS — Desktop System Audit & Hardening Utilities
// Provides:
// 1. safeConstantTimeCompare (timing-attack proof string compare)
// 2. autoTrimLocalStorage (quota limit protection)
// 3. calculateJitteredBackoff (exponential backoff with jitter)
// 4. cleanAudioContextState (Web Audio API lifecycle safety)
// 5. clampWindowBounds (multi-monitor screen bounds guard)
// 6. sanitizeSessionData (kiosk session cleanup on lock)
// ============================================================

import { useEffect, useRef, useCallback } from 'react';

/** Constant-time string comparison to prevent timing side-channel attacks on PINs/keys */
export function safeConstantTimeCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const lenA = a.length;
  const lenB = b.length;
  let result = lenA ^ lenB;
  for (let i = 0; i < Math.min(lenA, lenB); i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/** Automatically monitor and trim old transient localStorage entries if quota exceeds threshold */
export function autoTrimLocalStorage(thresholdBytes = 4 * 1024 * 1024): void {
  try {
    let totalSize = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        const val = localStorage.getItem(key) || '';
        totalSize += key.length + val.length;
      }
    }

    if (totalSize > thresholdBytes) {
      // Trim transient log and history keys
      const transientKeys = ['rmpg_clipboard_history', 'rmpg_debug_logs', 'rmpg_temp_cache'];
      transientKeys.forEach(k => localStorage.removeItem(k));
    }
  } catch {
    /* storage access restriction fallback */
  }
}

/** Calculate exponential backoff delay with randomized jitter */
export function calculateJitteredBackoff(retryCount: number, baseMs = 1000, maxMs = 30000): number {
  const exponential = Math.min(maxMs, baseMs * Math.pow(2, retryCount));
  const jitter = Math.random() * 0.3 * exponential; // 30% jitter
  return Math.floor(exponential + jitter);
}

/** Safely dispose or stop an HTML5 or Web Audio Context */
export function cleanAudioContextState(ctx: AudioContext | null): void {
  if (!ctx) return;
  try {
    if (ctx.state !== 'closed') {
      void ctx.close().catch(() => {});
    }
  } catch {
    /* silent audio cleanup */
  }
}

/** Ensure floating window coordinates stay within visible multi-monitor display bounds */
export function clampWindowBounds(
  x: number,
  y: number,
  width: number,
  height: number,
  screenWidth = window.innerWidth,
  screenHeight = window.innerHeight
): { x: number; y: number; width: number; height: number } {
  const minWidth = 280;
  const minHeight = 180;
  const clampedWidth = Math.max(minWidth, Math.min(screenWidth, width));
  const clampedHeight = Math.max(minHeight, Math.min(screenHeight, height));

  const clampedX = Math.max(0, Math.min(screenWidth - clampedWidth, x));
  const clampedY = Math.max(0, Math.min(screenHeight - clampedHeight, y));

  return { x: clampedX, y: clampedY, width: clampedWidth, height: clampedHeight };
}

/** Sanitize session state and DOM buffers on kiosk lock or logout */
export function sanitizeSessionData(): void {
  try {
    sessionStorage.clear();
    // Clear transient passwords or inputs from memory
    const inputs = document.querySelectorAll<HTMLInputElement>('input[type="password"]');
    inputs.forEach(i => { i.value = ''; });
  } catch {
    /* silent fallback */
  }
}

/** React hook to track component mount status and prevent unmounted setState calls */
export function useIsMounted(): () => boolean {
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  return useCallback(() => isMountedRef.current, []);
}
