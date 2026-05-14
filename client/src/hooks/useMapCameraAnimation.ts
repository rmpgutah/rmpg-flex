/**
 * useMapCameraAnimation — Mapbox GL JS camera animation/flyover.
 *
 * Cinematic fly-through animations for map presentations. Supports
 * orbiting, fly-along-route, and custom keyframe sequences.
 * Replaces Google Maps camera animations.
 */

import { useState, useRef, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';

// ── Types ─────────────────────────────────────────────────

export interface CameraKeyframe {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
  duration: number;
}

// ── Hook ──────────────────────────────────────────────────

export function useMapCameraAnimation(
  map: mapboxgl.Map | null,
  mapLoaded: boolean,
) {
  const [animating, setAnimating] = useState(false);
  const cancelRef = useRef(false);
  const frameRef = useRef<number>(0);

  const stop = useCallback(() => {
    cancelRef.current = true;
    cancelAnimationFrame(frameRef.current);
    setAnimating(false);
  }, []);

  /** Orbit the current center point */
  const orbit = useCallback((options?: { speed?: number; pitch?: number }) => {
    if (!map || !mapLoaded) return;

    const speed = options?.speed ?? 0.3;
    const pitch = options?.pitch ?? 60;
    cancelRef.current = false;
    setAnimating(true);

    map.easeTo({ pitch, duration: 1000 });

    const spin = () => {
      if (cancelRef.current || !map) return;
      const bearing = map.getBearing() + speed;
      map.setBearing(bearing);
      frameRef.current = requestAnimationFrame(spin);
    };

    setTimeout(() => {
      if (!cancelRef.current) spin();
    }, 1000);
  }, [map, mapLoaded]);

  /** Fly through a sequence of keyframes */
  const flyThrough = useCallback(async (keyframes: CameraKeyframe[]) => {
    if (!map || !mapLoaded || keyframes.length === 0) return;

    cancelRef.current = false;
    setAnimating(true);

    for (const kf of keyframes) {
      if (cancelRef.current) break;

      await new Promise<void>(resolve => {
        map.flyTo({
          center: kf.center,
          zoom: kf.zoom,
          bearing: kf.bearing,
          pitch: kf.pitch,
          duration: kf.duration,
          essential: true,
        });
        map.once('moveend', () => resolve());
        // Safety timeout
        setTimeout(resolve, kf.duration + 1000);
      });
    }

    setAnimating(false);
  }, [map, mapLoaded]);

  /** Fly along a route geometry */
  const flyAlongRoute = useCallback(async (
    coordinates: [number, number][],
    options?: { zoom?: number; pitch?: number; speed?: number }
  ) => {
    if (!map || !mapLoaded || coordinates.length < 2) return;

    const zoom = options?.zoom ?? 15;
    const pitch = options?.pitch ?? 60;
    const stepDuration = options?.speed ?? 2000;

    // Sample every Nth coordinate for smooth animation
    const step = Math.max(1, Math.floor(coordinates.length / 30));
    const samples = coordinates.filter((_, i) => i % step === 0 || i === coordinates.length - 1);

    const keyframes: CameraKeyframe[] = samples.map((coord, i) => {
      // Calculate bearing to next point
      let bearing = 0;
      if (i < samples.length - 1) {
        const next = samples[i + 1];
        bearing = Math.atan2(next[0] - coord[0], next[1] - coord[1]) * 180 / Math.PI;
      } else if (i > 0) {
        const prev = samples[i - 1];
        bearing = Math.atan2(coord[0] - prev[0], coord[1] - prev[1]) * 180 / Math.PI;
      }

      return {
        center: coord,
        zoom,
        bearing,
        pitch,
        duration: i === 0 ? stepDuration * 2 : stepDuration,
      };
    });

    await flyThrough(keyframes);
  }, [map, mapLoaded, flyThrough]);

  /** Quick cinematic zoom to a location */
  const cinematicZoom = useCallback((
    center: [number, number],
    options?: { zoom?: number; bearing?: number; pitch?: number; duration?: number }
  ) => {
    if (!map || !mapLoaded) return;

    setAnimating(true);
    map.flyTo({
      center,
      zoom: options?.zoom ?? 17,
      bearing: options?.bearing ?? 30,
      pitch: options?.pitch ?? 60,
      duration: options?.duration ?? 3000,
      essential: true,
    });
    map.once('moveend', () => setAnimating(false));
  }, [map, mapLoaded]);

  /** Reset camera to top-down */
  const resetCamera = useCallback(() => {
    if (!map) return;
    stop();
    map.easeTo({ pitch: 0, bearing: 0, duration: 800 });
  }, [map, stop]);

  return {
    animating,
    orbit,
    flyThrough,
    flyAlongRoute,
    cinematicZoom,
    resetCamera,
    stop,
  };
}
