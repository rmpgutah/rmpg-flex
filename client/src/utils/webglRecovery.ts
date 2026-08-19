// ============================================================
// RMPG Flex — WebGL context-loss recovery for Mapbox surfaces
// ============================================================
//
// Mapbox GL JS renders the entire map to a single <canvas> backed by one
// WebGL context. The OS/browser treats GPU contexts as a scarce, reclaimable
// resource: under memory pressure — a long dispatch shift, an in-vehicle
// Toughbook with a modest GPU, a device sleep/wake, or a GPU driver reset —
// the context can be forcibly taken back. The canvas fires `webglcontextlost`
// and the map goes blank/white and FROZEN.
//
// Once a context is lost it is gone permanently unless code intervenes, which
// is why the map only "came back" on a full page reload before this existed.
// `preserveDrawingBuffer: true` (needed so the canvas can be screenshotted for
// situation-report PDFs) raises GPU memory pressure and makes the loss more
// frequent on weak hardware.
//
// Recovery strategy (watchdog, not blind rebuild):
//   1. On loss, capture the live camera and start a short grace timer.
//   2. Backgrounding a tab routinely loses+restores the context and Mapbox
//      self-heals — so if the context is genuinely healthy again when the timer
//      fires, do nothing.
//   3. If it is still dead, call onRebuild(camera): the owning surface tears
//      down and re-creates its map at the same view (it owns that because only
//      it knows how to re-add its own layers).
//   4. A loop-guard (max rebuilds per rolling window) escalates a physically
//      failing GPU to a manual prompt instead of an infinite rebuild loop.

import type mapboxgl from 'mapbox-gl';
import { devLog, devWarn } from './devLog';

export interface MapCamera {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
}

export interface WebglRecoveryOptions {
  /** Human label for logs + the debug registry, e.g. "MapPage". */
  label: string;
  /**
   * Rebuild the map (the surface owns teardown + re-create, since it knows how
   * to re-add its own layers). Receives the last-known camera so the new map
   * opens at the same view. Called only when the context did NOT self-restore.
   */
  onRebuild: (camera: MapCamera | null) => void;
  /** Fired the instant the context is lost — e.g. to show a "reconnecting" badge. */
  onContextLost?: () => void;
  /** Fired when the context self-restored and NO rebuild was needed — e.g. to hide the badge. */
  onContextRestored?: () => void;
  /** Fired when the loop-guard trips (too many rebuilds). Surface should prompt a manual reload. */
  onGiveUp?: () => void;
  /** ms to wait for a self-restore before forcing a rebuild. Default 2500. */
  restoreGraceMs?: number;
  /** Max rebuilds allowed within rebuildWindowMs before giving up. Default 4. */
  maxRebuilds?: number;
  /** Rolling window (ms) for the rebuild cap. Default 60000. */
  rebuildWindowMs?: number;
}

// Debug registry so an operator can force a context loss from the DevTools
// console on any environment (incl. production, where they verify): run
//   __rmpgSimulateMapLoss()          // first registered map
//   __rmpgSimulateMapLoss('MapPage') // by label
const _recoverable = new Set<{ label: string; map: mapboxgl.Map }>();

/**
 * Resolve the live WebGL context off a canvas. On modern Mapbox (v3+) the map
 * creates a WebGL2 context; older builds fall back to webgl. Calling
 * `getContext(type)` for a non-matching type can return `null` *or* throw on
 * some Safari/iOS builds, so each call is guarded — we never want a health
 * probe to crash the surface that depends on it.
 */
function getMapGlContext(canvas: HTMLCanvasElement): WebGLRenderingContext | WebGL2RenderingContext | null {
  let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  try { gl = canvas.getContext('webgl2'); } catch { /* type-mismatch on a previously-bound context */ }
  if (!gl) {
    try { gl = canvas.getContext('webgl'); } catch { /* ditto */ }
  }
  return gl;
}

function isContextHealthy(map: mapboxgl.Map): boolean {
  try {
    const gl = getMapGlContext(map.getCanvas());
    if (!gl) return false;
    return !gl.isContextLost();
  } catch {
    return false;
  }
}

/**
 * Attach WebGL context-loss recovery to a Mapbox map. Returns a cleanup
 * function — call it from the same effect cleanup that removes the map.
 */
export function installWebglContextRecovery(
  map: mapboxgl.Map,
  opts: WebglRecoveryOptions,
): () => void {
  const {
    label,
    onRebuild,
    onContextLost,
    onContextRestored,
    onGiveUp,
    restoreGraceMs = 2500,
    maxRebuilds = 4,
    rebuildWindowMs = 60_000,
  } = opts;

  let disposed = false;
  let restoreTimer: ReturnType<typeof setTimeout> | null = null;
  let lastCamera: MapCamera | null = null;
  const rebuildTimes: number[] = [];

  const entry = { label, map };
  _recoverable.add(entry);

  const captureCamera = (): MapCamera | null => {
    try {
      const c = map.getCenter();
      return { center: [c.lng, c.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
    } catch {
      return null;
    }
  };

  const triggerRebuild = () => {
    if (disposed) return;
    const now = Date.now();
    // Drop timestamps outside the rolling window, then enforce the cap.
    while (rebuildTimes.length && now - rebuildTimes[0] > rebuildWindowMs) rebuildTimes.shift();
    if (rebuildTimes.length >= maxRebuilds) {
      devWarn(`[webglRecovery:${label}] ${maxRebuilds} rebuilds within ${rebuildWindowMs / 1000}s — giving up to manual recovery`);
      onGiveUp?.();
      return;
    }
    rebuildTimes.push(now);
    devWarn(`[webglRecovery:${label}] WebGL context still dead after ${restoreGraceMs}ms — rebuilding map`);
    onRebuild(lastCamera);
  };

  const handleLost = (e: any) => {
    if (disposed) return;
    // Allow the browser to attempt a restore — without preventDefault on the
    // underlying DOM event, `webglcontextrestored` never fires. Mapbox already
    // calls this internally, but doing it here too is safe and explicit.
    try { e?.preventDefault?.(); } catch { /* not preventable */ }
    try { e?.originalEvent?.preventDefault?.(); } catch { /* no DOM event */ }

    lastCamera = captureCamera();
    devWarn(`[webglRecovery:${label}] WebGL context lost — watching for restore`);
    onContextLost?.();

    if (restoreTimer) clearTimeout(restoreTimer);
    restoreTimer = setTimeout(() => {
      restoreTimer = null;
      if (disposed) return;
      // map.loaded() reflects style-load state (stays true even when the GL
      // context died), so the authoritative liveness check is isContextLost().
      if (isContextHealthy(map)) {
        devLog(`[webglRecovery:${label}] context self-restored — no rebuild needed`);
        onContextRestored?.();
        return;
      }
      triggerRebuild();
    }, restoreGraceMs);
  };

  const handleRestored = () => {
    if (disposed) return;
    // Don't cancel the watchdog here: Mapbox sometimes fires `restored` but
    // fails to repaint on weak GPUs, so the timer still verifies real health.
    devLog(`[webglRecovery:${label}] webglcontextrestored fired`);
  };

  // On devices that sleep/wake (in-vehicle Toughbooks, tablets) the browser may
  // suppress `webglcontextlost` while the page is hidden. When the page becomes
  // visible again, the context can be silently dead with no events ever fired.
  // This watchdog catches that case by checking context health on visibility
  // restore and starting the grace timer if the context is already gone.
  const handleVisibilityChange = () => {
    if (disposed || document.hidden) return;
    if (!isContextHealthy(map)) {
      devWarn(`[webglRecovery:${label}] context dead on page-visible — triggering recovery`);
      if (restoreTimer) return; // grace timer already running
      lastCamera = captureCamera();
      onContextLost?.();
      restoreTimer = setTimeout(() => {
        restoreTimer = null;
        if (disposed) return;
        if (isContextHealthy(map)) { devLog(`[webglRecovery:${label}] context recovered on visibility`); onContextRestored?.(); return; }
        triggerRebuild();
      }, restoreGraceMs);
    }
  };

  // Mapbox surfaces these as map events (a MapContextEvent that wraps the DOM
  // WebGLContextEvent on .originalEvent). map.remove() drops them, but we also
  // detach explicitly in cleanup.
  map.on('webglcontextlost', handleLost as any);
  map.on('webglcontextrestored', handleRestored as any);
  document.addEventListener('visibilitychange', handleVisibilityChange);

  return () => {
    disposed = true;
    if (restoreTimer) { clearTimeout(restoreTimer); restoreTimer = null; }
    _recoverable.delete(entry);
    try { map.off('webglcontextlost', handleLost as any); } catch { /* map already removed */ }
    try { map.off('webglcontextrestored', handleRestored as any); } catch { /* map already removed */ }
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  };
}

/**
 * Force a WebGL context loss on a live map — for verifying recovery by hand.
 * Uses the WEBGL_lose_context extension (present in all Chromium builds).
 */
export function simulateContextLoss(map: mapboxgl.Map): boolean {
  try {
    const gl = getMapGlContext(map.getCanvas()) as
      | (WebGLRenderingContext & { getExtension: WebGLRenderingContext['getExtension'] })
      | null;
    const ext = gl?.getExtension('WEBGL_lose_context') as WEBGL_lose_context | null;
    if (!ext) { devWarn('[webglRecovery] WEBGL_lose_context unavailable'); return false; }
    ext.loseContext();
    devWarn('[webglRecovery] simulated WebGL context loss');
    // Restore shortly after, mimicking a real transient loss the browser heals.
    setTimeout(() => { try { ext.restoreContext(); } catch { /* ignore */ } }, 50);
    return true;
  } catch (err) {
    devWarn('[webglRecovery] simulateContextLoss failed', err);
    return false;
  }
}

// Expose a console helper for manual verification on any environment.
if (typeof window !== 'undefined') {
  (window as any).__rmpgSimulateMapLoss = (labelOrIndex?: string | number) => {
    const list = Array.from(_recoverable);
    if (!list.length) { console.warn('[webglRecovery] no maps registered'); return false; }
    let target = list[0];
    if (typeof labelOrIndex === 'number') target = list[labelOrIndex] || list[0];
    else if (typeof labelOrIndex === 'string') target = list.find((e) => e.label === labelOrIndex) || list[0];
    console.warn(`[webglRecovery] forcing context loss on "${target.label}"`);
    return simulateContextLoss(target.map);
  };
}
