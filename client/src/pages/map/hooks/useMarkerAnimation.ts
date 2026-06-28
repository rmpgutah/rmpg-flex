import { useRef, useCallback, useEffect } from 'react';

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

const INTERPOLATION_DURATION_MS = 1000;

export function useMarkerAnimation() {
  const animationsRef = useRef<Map<string, AnimationState>>(new Map());

  const animateMarkerTo = useCallback(
    (markerId: string, newLat: number, newLng: number, onUpdate: (lat: number, lng: number) => void) => {
      if (!Number.isFinite(newLat) || !Number.isFinite(newLng)) return;

      const map = animationsRef.current;
      const existing = map.get(markerId);

      const startLat = existing ? existing.currentLat : newLat;
      const startLng = existing ? existing.currentLng : newLng;

      if (existing && existing.animFrame) cancelAnimationFrame(existing.animFrame);

      const dlat = Math.abs(newLat - startLat);
      const dlng = Math.abs(newLng - startLng);
      if (dlat < 0.000001 && dlng < 0.000001) {
        map.set(markerId, { currentLat: newLat, currentLng: newLng, targetLat: newLat, targetLng: newLng, startLat: newLat, startLng: newLng, startTime: 0, animFrame: 0 });
        return;
      }

      const startTime = performance.now();
      const state: AnimationState = { currentLat: startLat, currentLng: startLng, targetLat: newLat, targetLng: newLng, startLat, startLng, startTime, animFrame: 0 };

      const step = (now: number) => {
        const elapsed = now - startTime;
        const t = Math.min(elapsed / INTERPOLATION_DURATION_MS, 1);
        const ease = 1 - Math.pow(1 - t, 3);
        const lat = state.startLat + (state.targetLat - state.startLat) * ease;
        const lng = state.startLng + (state.targetLng - state.startLng) * ease;
        state.currentLat = lat;
        state.currentLng = lng;
        onUpdate(lat, lng);
        if (t < 1) { state.animFrame = requestAnimationFrame(step); } else { state.animFrame = 0; }
      };

      state.animFrame = requestAnimationFrame(step);
      map.set(markerId, state);
    },
    [],
  );

  const cancelAnimation = useCallback((markerId: string) => {
    const map = animationsRef.current;
    const state = map.get(markerId);
    if (state && state.animFrame) { cancelAnimationFrame(state.animFrame); state.animFrame = 0; }
    map.delete(markerId);
  }, []);

  const cleanupAll = useCallback(() => {
    const map = animationsRef.current;
    map.forEach((state) => { if (state.animFrame) cancelAnimationFrame(state.animFrame); });
    map.clear();
  }, []);

  useEffect(() => () => cleanupAll(), [cleanupAll]);

  return { animateMarkerTo, cancelAnimation, cleanupAll };
}

export function animateMarkerToPosition(
  updatePosition: (lat: number, lng: number) => void,
  startLat: number,
  startLng: number,
  targetLat: number,
  targetLng: number,
  duration = 1000,
): void {
  if (Math.abs(targetLat - startLat) < 0.000001 && Math.abs(targetLng - startLng) < 0.000001) return;

  const startTime = performance.now();

  function step(currentTime: number) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const lat = startLat + (targetLat - startLat) * eased;
    const lng = startLng + (targetLng - startLng) * eased;
    updatePosition(lat, lng);
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
