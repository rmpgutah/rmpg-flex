// Custom always-visible scrollbar for horizontal tab / section / filter strips.
//
// WHY: macOS Chrome renders OVERLAY scrollbars that auto-hide when idle and
// ignore custom ::-webkit-scrollbar sizing for layout (verified in the live
// app — a 14px custom bar consumed 0px, and -webkit-appearance:none didn't
// change it). So a native-CSS bar can't stay visible at rest. This module
// overlays our OWN thin bar, synced to each strip's scroll, that is always
// visible regardless of the OS "show scroll bars" setting.
//
// ARCHITECTURE: React owns the DOM inside its tree, so appending our nodes
// INTO a strip risks React throwing on its next commit. Instead all bars live
// in a single #tab-scrollbar-layer appended to <body> (outside React's root)
// and are positioned OVER each strip via getBoundingClientRect(). React never
// sees them; we never mutate React-managed subtrees.

import {
  computeThumb,
  scrollLeftFromThumb,
} from './tabScrollbarGeometry';

const SELECTOR = '.tab-scroll';
const LAYER_ID = 'tab-scrollbar-layer';
const THUMB_MIN = 28; // px — keep the thumb grabbable on very wide strips
const BAR_HEIGHT = 6; // px — thin + sleek, sits on the strip's bottom edge

interface Controller {
  strip: HTMLElement;
  track: HTMLElement;
  thumb: HTMLElement;
  ro: ResizeObserver;
  onStripScroll: () => void;
  dragging: boolean;
}

let layer: HTMLElement | null = null;
let mo: MutationObserver | null = null;
const controllers = new Map<HTMLElement, Controller>();
let rafPending = false;
let started = false;

function ensureLayer(): HTMLElement {
  if (layer && document.body.contains(layer)) return layer;
  layer = document.createElement('div');
  layer.id = LAYER_ID;
  // Visual-only layer; individual thumbs opt back into pointer events.
  layer.style.cssText =
    'position:fixed;inset:0;pointer-events:none;z-index:40;';
  document.body.appendChild(layer);
  return layer;
}

function scheduleUpdate(): void {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    controllers.forEach(updateController);
  });
}

function updateController(c: Controller): void {
  const { strip, track, thumb } = c;
  // Strip gone or hidden (display:none / inactive tab panel) → hide.
  if (!strip.isConnected) {
    track.style.display = 'none';
    return;
  }
  const r = strip.getBoundingClientRect();
  const offscreen = r.width === 0 || r.height === 0 || r.bottom <= 0 || r.top >= window.innerHeight;
  const metrics = computeThumb({
    scrollLeft: strip.scrollLeft,
    scrollWidth: strip.scrollWidth,
    clientWidth: strip.clientWidth,
    trackWidth: r.width,
    minThumb: THUMB_MIN,
  });
  if (offscreen || !metrics.visible) {
    track.style.display = 'none';
    return;
  }
  track.style.display = 'block';
  track.style.left = `${Math.round(r.left)}px`;
  track.style.top = `${Math.round(r.bottom - BAR_HEIGHT)}px`;
  track.style.width = `${Math.round(r.width)}px`;
  thumb.style.width = `${metrics.thumbWidth}px`;
  thumb.style.transform = `translateX(${metrics.thumbLeft}px)`;
}

function attach(strip: HTMLElement): void {
  if (controllers.has(strip)) return;
  const lyr = ensureLayer();

  const track = document.createElement('div');
  track.className = 'tab-scrollbar-track';
  const thumb = document.createElement('div');
  thumb.className = 'tab-scrollbar-thumb';
  track.appendChild(thumb);
  lyr.appendChild(track);

  const c: Controller = {
    strip,
    track,
    thumb,
    dragging: false,
    onStripScroll: () => updateController(c),
    ro: new ResizeObserver(() => updateController(c)),
  };

  // --- thumb drag ---
  let startX = 0;
  let startThumbLeft = 0;
  const onPointerMove = (e: PointerEvent) => {
    if (!c.dragging) return;
    const trackWidth = strip.getBoundingClientRect().width;
    const thumbWidth = thumb.offsetWidth;
    const next = Math.max(0, Math.min(trackWidth - thumbWidth, startThumbLeft + (e.clientX - startX)));
    strip.scrollLeft = scrollLeftFromThumb({
      thumbLeft: next,
      trackWidth,
      thumbWidth,
      scrollWidth: strip.scrollWidth,
      clientWidth: strip.clientWidth,
    });
    updateController(c);
  };
  const onPointerUp = (e: PointerEvent) => {
    c.dragging = false;
    thumb.classList.remove('dragging');
    try { thumb.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
  };
  const onPointerDown = (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    c.dragging = true;
    thumb.classList.add('dragging');
    startX = e.clientX;
    // current thumb left from its transform
    const m = /translateX\(([-0-9.]+)px\)/.exec(thumb.style.transform);
    startThumbLeft = m ? parseFloat(m[1]) : 0;
    try { thumb.setPointerCapture(e.pointerId); } catch { /* noop */ }
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };
  thumb.addEventListener('pointerdown', onPointerDown);

  strip.addEventListener('scroll', c.onStripScroll, { passive: true });
  c.ro.observe(strip);
  if (strip.parentElement) c.ro.observe(strip.parentElement);

  controllers.set(strip, c);
  updateController(c);
}

function detach(strip: HTMLElement): void {
  const c = controllers.get(strip);
  if (!c) return;
  c.ro.disconnect();
  strip.removeEventListener('scroll', c.onStripScroll);
  c.track.remove();
  controllers.delete(strip);
}

function scan(): void {
  document.querySelectorAll<HTMLElement>(SELECTOR).forEach(attach);
  // Drop controllers whose strip left the DOM.
  controllers.forEach((_c, strip) => {
    if (!strip.isConnected) detach(strip);
  });
}

/**
 * Initialise the custom tab-strip scrollbars once for the app lifetime.
 * Idempotent. Returns a teardown function (used in tests / hot-reload).
 */
export function initTabScrollbars(): () => void {
  if (typeof document === 'undefined') return () => {};
  if (started) return stopTabScrollbars;
  started = true;

  ensureLayer();
  scan();

  mo = new MutationObserver((records) => {
    let touched = false;
    for (const rec of records) {
      if (rec.addedNodes.length || rec.removedNodes.length) touched = true;
    }
    if (touched) {
      scan();
      scheduleUpdate();
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });

  // Reposition on anything that can move/resize a strip on screen.
  window.addEventListener('scroll', scheduleUpdate, { passive: true, capture: true });
  window.addEventListener('resize', scheduleUpdate, { passive: true });

  return stopTabScrollbars;
}

function stopTabScrollbars(): void {
  if (!started) return;
  started = false;
  mo?.disconnect();
  mo = null;
  window.removeEventListener('scroll', scheduleUpdate, { capture: true } as EventListenerOptions);
  window.removeEventListener('resize', scheduleUpdate);
  controllers.forEach((_c, strip) => detach(strip));
  layer?.remove();
  layer = null;
}
