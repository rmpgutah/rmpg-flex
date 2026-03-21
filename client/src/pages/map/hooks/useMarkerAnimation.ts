// ============================================================
// Map Page — Marker Position Animation Hook
// Provides smooth GPS position interpolation using
// requestAnimationFrame so unit markers glide instead of jumping.
// ============================================================

import { useRef, useCallback } from 'react';

interface AnimationState {
  currentLat: number;
  currentLng: number;
  targetLat: number;
  targetLng: number;
  startLat: number;
  startLng: number;
  startTime: number;
  animFrame: number;
}

const INTERPOLATION_DURATION_MS = 500;

export function useMarkerAnimation() {
  const animationsRef = useRef<Map<string, AnimationState>>(new Map());

  /**
   * Smoothly animate a marker from its current position to a new GPS position.
   * Calls `onUpdate(lat, lng)` on each animation frame so the caller can
   * reposition the marker.
   */
  const animateMarkerTo = useCallback(
    (
      markerId: string,
      newLat: number,
      newLng: number,
      onUpdate: (lat: number, lng: number) => void,
    ) => {
      const map = animationsRef.current;
      const existing = map.get(markerId);

      // Starting position: current interpolated pos, or the new pos (first time)
      const startLat = existing ? existing.currentLat : newLat;
      const startLng = existing ? existing.currentLng : newLng;

      // Cancel any running animation for this marker
      if (existing && existing.animFrame) {
        cancelAnimationFrame(existing.animFrame);
      }

      // If distance is negligible, just snap
      const dlat = Math.abs(newLat - startLat);
      const dlng = Math.abs(newLng - startLng);
      if (dlat < 0.000001 && dlng < 0.000001) {
        map.set(markerId, {
          currentLat: newLat,
          currentLng: newLng,
          targetLat: newLat,
          targetLng: newLng,
          startLat: newLat,
          startLng: newLng,
          startTime: 0,
          animFrame: 0,
        });
        return;
      }

      const startTime = performance.now();

      const state: AnimationState = {
        currentLat: startLat,
        currentLng: startLng,
        targetLat: newLat,
        targetLng: newLng,
        startLat,
        startLng,
        startTime,
        animFrame: 0,
      };

      const step = (now: number) => {
        const elapsed = now - startTime;
        const t = Math.min(elapsed / INTERPOLATION_DURATION_MS, 1);
        // Ease-out cubic for natural deceleration
        const ease = 1 - Math.pow(1 - t, 3);

        const lat = state.startLat + (state.targetLat - state.startLat) * ease;
        const lng = state.startLng + (state.targetLng - state.startLng) * ease;

        state.currentLat = lat;
        state.currentLng = lng;

        onUpdate(lat, lng);

        if (t < 1) {
          state.animFrame = requestAnimationFrame(step);
        } else {
          state.animFrame = 0;
        }
      };

      state.animFrame = requestAnimationFrame(step);
      map.set(markerId, state);
    },
    [],
  );

  /** Cancel a running animation for one marker */
  const cancelAnimation = useCallback((markerId: string) => {
    const map = animationsRef.current;
    const state = map.get(markerId);
    if (state && state.animFrame) {
      cancelAnimationFrame(state.animFrame);
      state.animFrame = 0;
    }
    map.delete(markerId);
  }, []);

  /** Cancel all running animations (cleanup on unmount) */
  const cleanupAll = useCallback(() => {
    const map = animationsRef.current;
    map.forEach((state) => {
      if (state.animFrame) {
        cancelAnimationFrame(state.animFrame);
      }
    });
    map.clear();
  }, []);

  return { animateMarkerTo, cancelAnimation, cleanupAll };
}
