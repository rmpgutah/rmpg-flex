// Custom always-visible scrollbars for horizontal tab/section strips AND the
// vertical content panel.
//
// WHY: macOS Chrome renders OVERLAY scrollbars that auto-hide when idle and
// ignore custom ::-webkit-scrollbar sizing for layout (verified in the live
// app — a 14px custom bar consumed 0px, and -webkit-appearance:none didn't
// change it). So a native-CSS bar can't stay visible at rest. This module
// overlays our OWN thin bar, synced to each scroll container, that is always
// visible regardless of the OS "show scroll bars" setting.
//
// Two markers:
//   .tab-scroll        → horizontal bar along the strip's bottom edge
//   .content-scroll-y  → vertical bar along the panel's right edge (e.g. <main>)
// The geometry is 1-D and axis-agnostic, so both axes reuse computeThumb /
// scrollLeftFromThumb (unit-tested) — we just feed them the relevant axis's
// scroll/size measurements.
//
// ARCHITECTURE: React owns the DOM inside its tree, so appending our nodes
// INTO a panel risks React throwing on its next commit. Instead all bars live
// in a single #tab-scrollbar-layer appended to <body> (outside React's root)
// and are positioned OVER each container via getBoundingClientRect(). React
// never sees them; we never mutate React-managed subtrees.

import {
  computeThumb,
  scrollLeftFromThumb,
} from './tabScrollbarGeometry';

const SELECTOR_X = '.tab-scroll';
const SELECTOR_Y = '.content-scroll-y';
const LAYER_ID = 'tab-scrollbar-layer';
const THUMB_MIN = 28; // px — keep the thumb grabbable on very large containers
const BAR = 6; // px — thin + sleek cross-axis thickness

type Axis = 'x' | 'y';

interface Controller {
  el: HTMLElement;
  axis: Axis;
  track: HTMLElement;
  thumb: HTMLElement;
  ro: ResizeObserver;
  onScroll: () => void;
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
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:40;';
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
  const { el, track, thumb, axis } = c;
  if (!el.isConnected) {
    track.style.display = 'none';
    return;
  }
  const r = el.getBoundingClientRect();
  const offscreen =
    r.width === 0 || r.height === 0 ||
    r.bottom <= 0 || r.top >= window.innerHeight ||
    r.right <= 0 || r.left >= window.innerWidth;
  // Feed computeThumb the active axis's measurements (1-D math, axis-agnostic).
  const metrics = computeThumb({
    scrollLeft: axis === 'x' ? el.scrollLeft : el.scrollTop,
    scrollWidth: axis === 'x' ? el.scrollWidth : el.scrollHeight,
    clientWidth: axis === 'x' ? el.clientWidth : el.clientHeight,
    trackWidth: axis === 'x' ? r.width : r.height,
    minThumb: THUMB_MIN,
  });
  if (offscreen || !metrics.visible) {
    track.style.display = 'none';
    return;
  }
  track.style.display = 'block';
  if (axis === 'x') {
    track.style.left = `${Math.round(r.left)}px`;
    track.style.top = `${Math.round(r.bottom - BAR)}px`;
    track.style.width = `${Math.round(r.width)}px`;
    track.style.height = `${BAR}px`;
    thumb.style.width = `${metrics.thumbWidth}px`;
    thumb.style.height = `${BAR}px`;
    thumb.style.transform = `translateX(${metrics.thumbLeft}px)`;
  } else {
    track.style.left = `${Math.round(r.right - BAR)}px`;
    track.style.top = `${Math.round(r.top)}px`;
    track.style.width = `${BAR}px`;
    track.style.height = `${Math.round(r.height)}px`;
    thumb.style.width = `${BAR}px`;
    thumb.style.height = `${metrics.thumbWidth}px`; // main-axis length
    thumb.style.transform = `translateY(${metrics.thumbLeft}px)`;
  }
}

function attach(el: HTMLElement, axis: Axis): void {
  if (controllers.has(el)) return;
  const lyr = ensureLayer();

  const track = document.createElement('div');
  track.className = `tab-scrollbar-track${axis === 'y' ? ' vertical' : ''}`;
  const thumb = document.createElement('div');
  thumb.className = 'tab-scrollbar-thumb';
  track.appendChild(thumb);
  lyr.appendChild(track);

  const c: Controller = {
    el,
    axis,
    track,
    thumb,
    dragging: false,
    onScroll: () => updateController(c),
    ro: new ResizeObserver(() => updateController(c)),
  };

  // --- thumb drag (axis-aware) ---
  let startPointer = 0;
  let startPos = 0;
  const readThumbPos = (): number => {
    const re = axis === 'x' ? /translateX\(([-0-9.]+)px\)/ : /translateY\(([-0-9.]+)px\)/;
    const m = re.exec(thumb.style.transform);
    return m ? parseFloat(m[1]) : 0;
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!c.dragging) return;
    const r = el.getBoundingClientRect();
    const trackLen = axis === 'x' ? r.width : r.height;
    const thumbLen = axis === 'x' ? thumb.offsetWidth : thumb.offsetHeight;
    const pointer = axis === 'x' ? e.clientX : e.clientY;
    const next = Math.max(0, Math.min(trackLen - thumbLen, startPos + (pointer - startPointer)));
    const scroll = scrollLeftFromThumb({
      thumbLeft: next,
      trackWidth: trackLen,
      thumbWidth: thumbLen,
      scrollWidth: axis === 'x' ? el.scrollWidth : el.scrollHeight,
      clientWidth: axis === 'x' ? el.clientWidth : el.clientHeight,
    });
    if (axis === 'x') el.scrollLeft = scroll;
    else el.scrollTop = scroll;
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
    startPointer = axis === 'x' ? e.clientX : e.clientY;
    startPos = readThumbPos();
    try { thumb.setPointerCapture(e.pointerId); } catch { /* noop */ }
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };
  thumb.addEventListener('pointerdown', onPointerDown);

  el.addEventListener('scroll', c.onScroll, { passive: true });
  c.ro.observe(el);
  if (el.parentElement) c.ro.observe(el.parentElement);
  // For vertical, content height (scrollHeight) changes when the inner content
  // grows — observe the content child so the thumb resizes on data/route loads.
  if (axis === 'y' && el.firstElementChild) c.ro.observe(el.firstElementChild as Element);

  controllers.set(el, c);
  updateController(c);
}

function detach(el: HTMLElement): void {
  const c = controllers.get(el);
  if (!c) return;
  c.ro.disconnect();
  el.removeEventListener('scroll', c.onScroll);
  c.track.remove();
  controllers.delete(el);
}

function scan(): void {
  document.querySelectorAll<HTMLElement>(SELECTOR_X).forEach((el) => attach(el, 'x'));
  document.querySelectorAll<HTMLElement>(SELECTOR_Y).forEach((el) => attach(el, 'y'));
  controllers.forEach((_c, el) => {
    if (!el.isConnected) detach(el);
  });
}

/**
 * Initialise the custom scrollbars once for the app lifetime. Idempotent.
 * Returns a teardown function (used in tests / hot-reload).
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
  controllers.forEach((_c, el) => detach(el));
  layer?.remove();
  layer = null;
}
