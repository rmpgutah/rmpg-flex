// ============================================================
// RMPG Flex — reusable WebGL context-loss recovery wiring
// ============================================================
// Every Mapbox surface in the app owns its own map-lifecycle effect (create
// on mount/deps-change, `map.remove()` on cleanup) — there's no shared map
// component to patch once. This hook is the shared PIECE each surface wires
// in, so the actual recovery policy (grace window, rebuild cap, camera
// capture) lives in one place (utils/webglRecovery.ts) instead of being
// re-implemented per file.
//
// Usage inside a map-init effect:
//   const { rebuildNonce, attach, consumePendingCamera } = useWebglMapRecovery();
//   useEffect(() => {
//     const map = new mapboxgl.Map({ ...});
//     const detachRecovery = attach(map, 'MyMapSurface');
//     map.on('load', () => {
//       const cam = consumePendingCamera();
//       if (cam) map.jumpTo({ center: cam.center, zoom: cam.zoom, bearing: cam.bearing, pitch: cam.pitch });
//     });
//     return () => { detachRecovery(); map.remove(); };
//   }, [rebuildNonce, ...otherDeps]);
//
// `rebuildNonce` MUST be a dependency of that effect — it's what forces the
// effect to tear down and recreate the map after a context loss that didn't
// self-restore. Without it in the deps array, onRebuild's setState has
// nothing to trigger.

import { useCallback, useRef, useState } from 'react';
import type mapboxgl from 'mapbox-gl';
import { installWebglContextRecovery, type MapCamera } from '../utils/webglRecovery';

export interface UseWebglMapRecoveryResult {
  /** Include in the map-init effect's dependency array. Increments on rebuild. */
  rebuildNonce: number;
  /**
   * Call once right after creating the map, inside the same init effect.
   * Returns a cleanup function — call it in the effect's cleanup, before
   * `map.remove()`.
   */
  attach: (map: mapboxgl.Map, label: string) => () => void;
  /**
   * Call after the rebuilt map's 'load' (or 'style.load') fires to restore
   * the pre-loss camera. Returns null on an ordinary (non-recovery) mount.
   */
  consumePendingCamera: () => MapCamera | null;
  /**
   * Call inside `map.on('load', ...)` after creating the map. Restores the
   * pre-crash camera position if this is a recovery rebuild (no-op otherwise).
   * Replaces the manual consumePendingCamera + jumpTo pattern.
   */
  onMapLoaded: (map: mapboxgl.Map) => void;
  /** True while the WebGL context is lost and recovery is in progress. */
  isRecovering: boolean;
  /** True when the rebuild loop-guard tripped — manual reload is the only fix. */
  needsManualReload: boolean;
}

export function useWebglMapRecovery(): UseWebglMapRecoveryResult {
  const [rebuildNonce, setRebuildNonce] = useState(0);
  const [isRecovering, setIsRecovering] = useState(false);
  const [needsManualReload, setNeedsManualReload] = useState(false);
  const pendingCameraRef = useRef<MapCamera | null>(null);

  const attach = useCallback((map: mapboxgl.Map, label: string) => {
    return installWebglContextRecovery(map, {
      label,
      onRebuild: (camera) => {
        pendingCameraRef.current = camera;
        setIsRecovering(false);
        setRebuildNonce((n) => n + 1);
      },
      onContextLost: () => setIsRecovering(true),
      onContextRestored: () => setIsRecovering(false),
      onGiveUp: () => {
        setIsRecovering(false);
        setNeedsManualReload(true);
      },
    });
  }, []);

  const consumePendingCamera = useCallback((): MapCamera | null => {
    const cam = pendingCameraRef.current;
    pendingCameraRef.current = null;
    return cam;
  }, []);

  const onMapLoaded = useCallback((map: mapboxgl.Map) => {
    const cam = pendingCameraRef.current;
    if (!cam) return;
    pendingCameraRef.current = null;
    try {
      map.jumpTo({ center: cam.center, zoom: cam.zoom, bearing: cam.bearing, pitch: cam.pitch });
    } catch {
      // map may have been removed before load fires in a fast cleanup cycle
    }
  }, []);

  return { rebuildNonce, attach, consumePendingCamera, onMapLoaded, isRecovering, needsManualReload };
}
