// ============================================================
// Map Page — Marker Content Builders
// DOM-based marker builders for Mapbox GL JS HTML markers.
// ============================================================

import type { UnitStatus } from '../../../types';
import { UNIT_STATUS_COLORS, UNIT_STATUS_LABELS, PRIORITY_COLORS, getIncidentCategory } from './mapConstants';
import { parseTimestamp } from '../../../utils/dateUtils';

// ── HTML Marker Content Builders ──────────────────────────────

export function buildUnitMarkerContent(callSign: string, status: UnitStatus, _gpsSource?: string, heading?: number | null): HTMLElement {
  const color = UNIT_STATUS_COLORS[status];
  const label = UNIT_STATUS_LABELS[status];

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;flex-direction:column;align-items:center;cursor:pointer;filter:drop-shadow(0 1px 3px rgba(0,0,0,0.7)) drop-shadow(0 0 1px rgba(0,0,0,0.5));transition:all 0.2s ease;will-change:transform;position:relative;';
  wrapper.setAttribute('aria-label', callSign + ' - ' + label);
  wrapper.title = callSign + ' \u2014 ' + label;

  wrapper.addEventListener('mouseenter', () => { wrapper.style.transform = 'scale(1.08)'; });
  wrapper.addEventListener('mouseleave', () => { wrapper.style.transform = 'scale(1)'; });

  if (heading != null && isFinite(heading)) {
    const arrow = document.createElement('div');
    arrow.style.cssText =
      `width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-bottom:10px solid ${color};` +
      `transform:rotate(${heading}deg);transform-origin:center 12px;` +
      `position:absolute;top:-12px;left:50%;margin-left:-4px;` +
      `filter:drop-shadow(0 0 3px ${color}80);transition:transform 0.5s ease;z-index:1;opacity:0.9;`;
    wrapper.appendChild(arrow);
  }

  const tag = document.createElement('div');
  tag.style.cssText =
    `background:${color};color:#fff;font-size:9px;font-weight:900;` +
    "padding:2px 6px;border:1.5px solid rgba(255,255,255,0.85);white-space:nowrap;font-family:'JetBrains Mono',monospace;letter-spacing:0.05em;" +
    `display:flex;align-items:center;gap:3px;border-radius:1px;line-height:1.2;min-width:36px;text-align:center;justify-content:center;` +
    `box-shadow:inset 0 1px 0 rgba(255,255,255,0.15), 0 0 8px ${color}40;filter:saturate(1.1);`;

  const csSpan = document.createElement('span');
  csSpan.textContent = callSign;
  const sepSpan = document.createElement('span');
  sepSpan.style.cssText = 'opacity:0.5;font-size:7px;';
  sepSpan.textContent = '\u00b7';
  const stSpan = document.createElement('span');
  stSpan.style.cssText = 'font-size:7px;opacity:0.85;letter-spacing:0.5px;';
  stSpan.textContent = label;
  tag.appendChild(csSpan);
  tag.appendChild(sepSpan);
  tag.appendChild(stSpan);

  const caret = document.createElement('div');
  caret.style.cssText =
    `width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:7px solid ${color};transition:border-color 0.2s ease;`;

  wrapper.appendChild(tag);
  wrapper.appendChild(caret);
  return wrapper;
}

export function buildIncidentMarkerContent(priority: string, incidentType: string, callNumber?: string, createdAt?: string | null): HTMLElement {
  const color = PRIORITY_COLORS[priority] || '#666666';
  const { category } = getIncidentCategory(incidentType);

  const glowShadow = priority === 'P1' ? `0 0 12px ${color}50` : priority === 'P2' ? `0 0 8px ${color}40` : `0 0 6px ${color}30`;

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;flex-direction:column;align-items:center;cursor:pointer;filter:drop-shadow(0 1px 4px rgba(0,0,0,0.8)) drop-shadow(0 0 2px rgba(0,0,0,0.5));transition:transform 0.2s ease;';
  wrapper.setAttribute('aria-label', (callNumber || '') + ' ' + category);

  if (priority === 'P1') {
    wrapper.style.animation = 'pulse-p1 1s ease-in-out infinite';
  } else if (priority === 'P2') {
    wrapper.style.animation = 'pulse-p2 2s ease-in-out infinite';
  }

  wrapper.addEventListener('mouseenter', () => { wrapper.style.transform = 'scale(1.08)'; });
  wrapper.addEventListener('mouseleave', () => { wrapper.style.transform = 'scale(1)'; });

  const tag = document.createElement('div');
  tag.style.cssText =
    `background:${color};color:#fff;font-size:9px;font-weight:900;` +
    "padding:2px 6px;border:1.5px solid rgba(255,255,255,0.95);white-space:nowrap;font-family:'JetBrains Mono',monospace;letter-spacing:0.05em;" +
    `display:flex;align-items:center;gap:3px;border-radius:1px;line-height:1.2;min-width:40px;text-align:center;justify-content:center;` +
    `box-shadow:${glowShadow};`;

  if (callNumber) {
    const numSpan = document.createElement('span');
    numSpan.textContent = callNumber;
    tag.appendChild(numSpan);
  }

  const catSpan = document.createElement('span');
  catSpan.style.cssText = 'font-size:8px;opacity:0.85;letter-spacing:0.3px;';
  catSpan.textContent = category;
  tag.appendChild(catSpan);

  if (createdAt) {
    const ageMs = Date.now() - parseTimestamp(createdAt).getTime();
    const ageMin = Math.floor(ageMs / 60000);
    if (ageMin >= 0) {
      let ageColor: string;
      let ageGlow = '';
      if (ageMin < 5) {
        ageColor = '#ffffff';
      } else if (ageMin < 15) {
        ageColor = '#fbbf24';
      } else if (ageMin < 30) {
        ageColor = '#f97316';
      } else {
        ageColor = '#ef4444';
        ageGlow = 'text-shadow:0 0 4px rgba(239,68,68,0.8);';
      }
      const ageSpan = document.createElement('span');
      ageSpan.style.cssText = `font-size:7px;font-weight:700;color:${ageColor};margin-left:1px;${ageGlow}`;
      ageSpan.textContent = ageMin < 60 ? `${ageMin}m` : `${Math.floor(ageMin / 60)}h${ageMin % 60}m`;
      tag.appendChild(ageSpan);
    }
  }

  const caret = document.createElement('div');
  caret.style.cssText =
    `width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:7px solid ${color};`;

  wrapper.appendChild(tag);
  wrapper.appendChild(caret);
  return wrapper;
}

export function buildPropertyMarkerContent(name: string, address?: string, clientName?: string): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;flex-direction:column;align-items:center;cursor:pointer;position:relative;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.6));';

  const dot = document.createElement('div');
  dot.style.cssText =
    'width:12px;height:12px;border-radius:50%;' +
    'background:radial-gradient(circle at 30% 30%, #bfbfbf, #363636);' +
    'border:2px solid rgba(255,255,255,0.95);' +
    'box-shadow:0 0 8px rgba(136, 136, 136,0.7), 0 1px 4px rgba(0,0,0,0.5);' +
    'transition:transform 0.2s ease, box-shadow 0.2s ease;will-change:transform, box-shadow;';

  const tooltip = document.createElement('div');
  tooltip.style.cssText =
    'position:absolute;bottom:20px;left:50%;transform:translateX(-50%);' +
    "background:#0c0c0c;color:#e5e7eb;padding:8px 12px;border:1px solid #88888850;border-radius:2px;" +
    "font-family:'JetBrains Mono',monospace;white-space:nowrap;pointer-events:none;" +
    'opacity:0;transition:opacity 0.15s ease;z-index:9999;min-width:120px;max-width:220px;' +
    'box-shadow:0 4px 12px rgba(0,0,0,0.5);backdrop-filter:blur(8px);';

  const nameEl = document.createElement('div');
  nameEl.style.cssText = 'font-size:10px;font-weight:900;color:#a0a0a0;margin-bottom:2px;text-overflow:ellipsis;overflow:hidden;';
  nameEl.textContent = name;
  tooltip.appendChild(nameEl);

  if (address) {
    const addrEl = document.createElement('div');
    addrEl.style.cssText = 'font-size:8px;color:#9ca3af;';
    addrEl.textContent = address;
    tooltip.appendChild(addrEl);
  }

  if (clientName) {
    const clientEl = document.createElement('div');
    clientEl.style.cssText = 'font-size:8px;color:#d4a017;margin-top:2px;';
    clientEl.textContent = `Client: ${clientName}`;
    tooltip.appendChild(clientEl);
  }

  const tooltipCaret = document.createElement('div');
  tooltipCaret.style.cssText =
    'position:absolute;bottom:-5px;left:50%;transform:translateX(-50%);' +
    'width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:5px solid #0c0c0c;';
  tooltip.appendChild(tooltipCaret);

  wrapper.addEventListener('mouseenter', () => {
    dot.style.transform = 'scale(1.5)';
    dot.style.boxShadow = '0 0 12px rgba(136, 136, 136,0.8), 0 1px 3px rgba(0,0,0,0.4)';
    tooltip.style.opacity = '1';
  });
  wrapper.addEventListener('mouseleave', () => {
    dot.style.transform = 'scale(1)';
    dot.style.boxShadow = '0 0 6px rgba(136, 136, 136,0.6), 0 1px 3px rgba(0,0,0,0.4)';
    tooltip.style.opacity = '0';
  });

  wrapper.appendChild(tooltip);
  wrapper.appendChild(dot);
  return wrapper;
}

// ── Historical Call Marker (semi-transparent, smaller, with clock badge) ──

export function buildHistoricalCallMarkerContent(priority: string, incidentType: string, callNumber?: string): HTMLElement {
  const color = PRIORITY_COLORS[priority] || '#666666';
  const { category } = getIncidentCategory(incidentType);

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;flex-direction:column;align-items:center;cursor:pointer;filter:drop-shadow(0 1px 3px rgba(0,0,0,0.6));opacity:0.55;transition:opacity 0.2s ease, transform 0.2s ease;';
  wrapper.setAttribute('aria-label', 'Historical: ' + (callNumber || '') + ' ' + category);

  wrapper.addEventListener('mouseenter', () => { wrapper.style.opacity = '0.9'; wrapper.style.transform = 'scale(1.05)'; });
  wrapper.addEventListener('mouseleave', () => { wrapper.style.opacity = '0.55'; wrapper.style.transform = 'scale(1)'; });

  const tag = document.createElement('div');
  tag.style.cssText =
    `background:${color};color:#fff;font-size:7px;font-weight:900;` +
    "padding:1px 4px;border:1px solid rgba(255,255,255,0.7);white-space:nowrap;font-family:'JetBrains Mono',monospace;letter-spacing:0.05em;" +
    'display:flex;align-items:center;gap:2px;border-radius:1px;position:relative;';

  const badge = document.createElement('div');
  badge.style.cssText =
    'position:absolute;top:-6px;right:-6px;width:12px;height:12px;border-radius:2px;' +
    'background:#0c0c0c;border:1px solid ' + color + ';display:flex;align-items:center;justify-content:center;' +
    'font-size:7px;color:' + color + ';font-weight:900;line-height:1;backdrop-filter:blur(4px);';
  badge.textContent = '\u23F1';
  tag.appendChild(badge);

  if (callNumber) {
    const numSpan = document.createElement('span');
    numSpan.textContent = callNumber;
    tag.appendChild(numSpan);
  }

  const catSpan = document.createElement('span');
  catSpan.style.cssText = 'font-size:6px;opacity:0.85;letter-spacing:0.3px;';
  catSpan.textContent = category;
  tag.appendChild(catSpan);

  const caret = document.createElement('div');
  caret.style.cssText =
    `width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid ${color};`;

  wrapper.appendChild(tag);
  wrapper.appendChild(caret);
  return wrapper;
}

// ── Incident Report Marker (diamond shape with "IR" label) ──

export function buildIncidentReportMarkerContent(status: string): HTMLElement {
  const statusColors: Record<string, string> = {
    draft: '#666666',
    submitted: '#888888',
    under_review: '#f59e0b',
    approved: '#22c55e',
    returned: '#ef4444',
  };
  const color = statusColors[status] || '#666666';

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;flex-direction:column;align-items:center;cursor:pointer;filter:drop-shadow(0 1px 3px rgba(0,0,0,0.7));transition:transform 0.2s ease;';
  wrapper.setAttribute('aria-label', 'Incident Report - ' + status);

  wrapper.addEventListener('mouseenter', () => { wrapper.style.transform = 'scale(1.1)'; });
  wrapper.addEventListener('mouseleave', () => { wrapper.style.transform = 'scale(1)'; });

  const diamond = document.createElement('div');
  diamond.style.cssText =
    `width:22px;height:22px;background:${color};transform:rotate(45deg);` +
    `border:1.5px solid rgba(255,255,255,0.9);display:flex;align-items:center;justify-content:center;` +
    `box-shadow:0 0 8px ${color}50;outline:1px solid ${color}40;outline-offset:2px;border-radius:1px;`;

  const label = document.createElement('span');
  label.style.cssText =
    "transform:rotate(-45deg);color:#fff;font-size:8px;font-weight:900;font-family:'JetBrains Mono',monospace;letter-spacing:0.3px;line-height:1;";
  label.textContent = 'IR';
  diamond.appendChild(label);

  wrapper.appendChild(diamond);
  return wrapper;
}

// ── Self-Position Marker (pulsing "you are here") ────────────

export function buildSelfPositionMarker(accuracy: number | null, heading: number | null): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = 'position:relative;display:flex;align-items:center;justify-content:center;cursor:default;';
  const acc = accuracy != null ? Math.min(Math.max(accuracy, 4), 40) : 12;

  const ring = document.createElement('div');
  ring.style.cssText = `width:${acc}px;height:${acc}px;border-radius:50%;background:radial-gradient(circle, rgba(136, 136, 136,0.2), rgba(136, 136, 136,0.05));border:2px solid rgba(136, 136, 136,0.4);position:absolute;animation:pulse-gps 2s ease-in-out infinite;will-change:transform;`;
  el.appendChild(ring);

  const dot = document.createElement('div');
  dot.style.cssText = 'width:14px;height:14px;border-radius:50%;background:radial-gradient(circle at 35% 30%, #bfbfbf, #3a3a3a);border:3px solid #fff;box-shadow:0 0 10px rgba(136, 136, 136,0.8),0 0 20px rgba(136, 136, 136,0.3),0 0 30px rgba(136, 136, 136,0.2);z-index:1;';
  el.appendChild(dot);

  if (heading != null) {
    const arrow = document.createElement('div');
    arrow.style.cssText = `position:absolute;top:-10px;width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:12px solid #888888;transform:rotate(${heading}deg);transform-origin:center 17px;filter:drop-shadow(0 0 3px rgba(136, 136, 136,0.6));z-index:2;transition:transform 0.3s ease;will-change:transform;`;
    el.appendChild(arrow);
  }

  return el;
}

// ── Mapbox Custom Marker Wrapper ─────────────────────────────
// Wraps an HTMLElement in a Mapbox-compatible marker with update/remove methods.
// Use: `const marker = new MapboxHtmlMarker(map, element, [lng, lat]);`

import mapboxgl, { type Map as MapboxMap } from 'mapbox-gl';

export interface MapboxHtmlMarker {
  setLngLat(lng: number, lat: number): void;
  setElement(newContent: HTMLElement): void;
  remove(): void;
}

class MapboxHtmlMarkerImpl implements MapboxHtmlMarker {
  private map: MapboxMap;
  private el: HTMLElement;
  private _lng: number;
  private _lat: number;
  private onClick?: () => void;

  constructor(map: MapboxMap, content: HTMLElement, lng: number, lat: number, onClick?: () => void) {
    this.map = map;
    this.el = content;
    this._lng = lng;
    this._lat = lat;
    this.onClick = onClick;

    const markerEl = document.createElement('div');
    markerEl.style.position = 'absolute';
    markerEl.style.cursor = 'pointer';
    markerEl.style.transform = 'translate(-50%, -100%)';
    markerEl.style.pointerEvents = 'auto';
    markerEl.appendChild(this.el);

    if (this.onClick) {
      markerEl.addEventListener('click', this.onClick);
    }

    (markerEl as any)._rmpgMarker = true;
    this.el = markerEl;

    const canvas = this.map.getCanvas();
    canvas.parentElement?.appendChild(this.el);

    this.updatePosition();

    this.map.on('move', this.updatePosition);
  }

  private updatePosition = () => {
    const point = this.map.project([this._lng, this._lat]);
    this.el.style.left = `${point.x}px`;
    this.el.style.top = `${point.y}px`;
  };

  setLngLat(lng: number, lat: number) {
    this._lng = lng;
    this._lat = lat;
    this.updatePosition();
  }

  setElement(newContent: HTMLElement) {
    while (this.el.firstChild) {
      this.el.removeChild(this.el.firstChild);
    }
    this.el.appendChild(newContent);
  }

  remove() {
    this.map.off('move', this.updatePosition);
    if (this.el.parentElement) {
      this.el.parentElement.removeChild(this.el);
    }
  }
}

export function createMapboxHtmlMarker(map: MapboxMap, content: HTMLElement, lng: number, lat: number, onClick?: () => void): MapboxHtmlMarker {
  return new MapboxHtmlMarkerImpl(map, content, lng, lat, onClick);
}

// ── Mapbox Overlay Marker ─────────────────────────────────────
// Compatibility wrapper for markers that were originally built
// against the Google Maps OverlayView pattern. All rendering is
// now done through Mapbox GL JS's native Marker class.

interface MapboxOverlayMarkerOptions {
  map: MapboxMap;
  position: [number, number] | { lat: number; lng: number };
  content: HTMLElement;
  zIndex?: number;
  title?: string;
  onClick?: () => void;
}

export class MapboxOverlayMarkerImpl {
  private marker: mapboxgl.Marker;

  constructor(opts: MapboxOverlayMarkerOptions) {
    const el = opts.content;
    if (opts.title) el.title = opts.title;
    el.style.zIndex = String(opts.zIndex ?? 0);

    if (opts.onClick) {
      el.addEventListener('click', opts.onClick);
    }

    const lng = Array.isArray(opts.position) ? opts.position[0] : opts.position.lng;
    const lat = Array.isArray(opts.position) ? opts.position[1] : opts.position.lat;

    this.marker = new mapboxgl.Marker({ element: el })
      .setLngLat([lng, lat])
      .addTo(opts.map);
  }

  remove() { this.marker.remove(); }

  getLngLat() { return this.marker.getLngLat(); }

  addTo(map: MapboxMap) { this.marker.addTo(map); }

  getElement() { return this.marker.getElement(); }
}

export type OverlayMarker = mapboxgl.Marker | MapboxOverlayMarkerImpl;

export function getOverlayMarkerClass(): typeof MapboxOverlayMarkerImpl | null {
  return MapboxOverlayMarkerImpl;
}

// ── CSS Keyframes (injected once) ────────────────────────────

const STYLE_ID = 'rmpg-map-keyframes';
export function injectKeyframes() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes pulse-led { 0%,100% { opacity:1; } 40% { opacity:0.2; } 60% { opacity:0.2; } }
    @keyframes pulse-incident { 0%,100% { box-shadow:0 0 4px rgba(220,38,38,0.3); transform:scale(1); } 50% { box-shadow:0 0 20px rgba(220,38,38,0.8); transform:scale(1.05); } }
    @keyframes pulse-p1 { 0%,100% { box-shadow:0 0 4px rgba(220,38,38,0.3); filter:brightness(1); } 50% { box-shadow:0 0 18px rgba(220,38,38,0.9), 0 0 30px rgba(220,38,38,0.4); filter:brightness(1.2); } }
    @keyframes pulse-p2 { 0%,100% { box-shadow:0 0 3px rgba(245,158,11,0.2); filter:brightness(1); } 50% { box-shadow:0 0 12px rgba(245,158,11,0.7), 0 0 20px rgba(245,158,11,0.3); filter:brightness(1.15); } }
    @keyframes pulse-gps { 0%,100% { transform:scale(1); opacity:0.7; } 50% { transform:scale(3.0); opacity:0; } }
    @keyframes marker-enter { from { opacity:0; transform:scale(0.5) translateY(10px); } to { opacity:1; transform:scale(1) translateY(0); } }
    @keyframes marker-exit { from { opacity:1; transform:scale(1); } to { opacity:0; transform:scale(0.8); } }
    @keyframes marker-selected { 0%,100% { box-shadow:0 0 0 0 rgba(160, 160, 160,0.4); } 50% { box-shadow:0 0 0 8px rgba(160, 160, 160,0); } }
    @keyframes marker-bounce { 0%,100% { transform:translateY(0); } 50% { transform:translateY(-4px); } }
    @keyframes glow-breathe { 0%,100% { filter:brightness(1); } 50% { filter:brightness(1.15); } }
    .rmpg-marker-hover { transform:scale(1.08); transition:transform 0.2s ease; }
    .rmpg-marker-selected { animation:marker-selected 1.5s ease-in-out infinite; }
    .rmpg-marker-enter { animation:marker-enter 0.3s ease-out forwards; }
    .mapboxgl-popup-content { background:#0c0c0c !important; border:1px solid #2b2b2b !important; border-radius:4px !important; color:#e5e7eb !important; box-shadow:0 4px 24px rgba(0,0,0,0.6) !important; padding:0 !important; }
    .mapboxgl-popup-content .mapboxgl-popup-close-button { color:#e5e7eb !important; font-size:18px !important; }
    .mapboxgl-popup-tip { border-top-color:#0c0c0c !important; }
    @media (prefers-reduced-motion: reduce) { .rmpg-marker-enter, .rmpg-marker-selected, [style*=animation] { animation:none !important; } }
  `;
  document.head.appendChild(style);
}
