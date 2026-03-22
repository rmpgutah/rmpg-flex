// ============================================================
// Map Page — Marker Content Builders
// DOM-based marker builders for Google Maps AdvancedMarkerElement
// and a custom OverlayView fallback class.
// ============================================================

import type { UnitStatus } from '../../../types';
import { UNIT_STATUS_COLORS, UNIT_STATUS_LABELS, PRIORITY_COLORS, getIncidentCategory } from './mapConstants';

// ── AdvancedMarkerElement Content Builders ────────────────────

export function buildUnitMarkerContent(callSign: string, status: UnitStatus, _gpsSource?: string): HTMLElement {
  const color = UNIT_STATUS_COLORS[status];
  const label = UNIT_STATUS_LABELS[status];

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;flex-direction:column;align-items:center;cursor:pointer;filter:drop-shadow(0 1px 3px rgba(0,0,0,0.7)) drop-shadow(0 0 1px rgba(0,0,0,0.5));';

  const tag = document.createElement('div');
  tag.style.cssText =
    `background:${color};color:#fff;font-size:9px;font-weight:900;` +
    "padding:2px 6px;border:1.5px solid rgba(255,255,255,0.9);white-space:nowrap;font-family:'JetBrains Mono',monospace;letter-spacing:0.05em;" +
    'display:flex;align-items:center;gap:3px;border-radius:1px;';

  const csSpan = document.createElement('span');
  csSpan.textContent = callSign;
  const stSpan = document.createElement('span');
  stSpan.style.cssText = 'font-size:6px;opacity:0.85;letter-spacing:0.5px;';
  stSpan.textContent = label;
  tag.appendChild(csSpan);
  tag.appendChild(stSpan);

  const caret = document.createElement('div');
  caret.style.cssText =
    `width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:6px solid ${color};`;

  wrapper.appendChild(tag);
  wrapper.appendChild(caret);
  return wrapper;
}

export function buildIncidentMarkerContent(priority: string, incidentType: string, callNumber?: string): HTMLElement {
  const color = PRIORITY_COLORS[priority] || '#6b7280';
  const { category } = getIncidentCategory(incidentType);

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;flex-direction:column;align-items:center;cursor:pointer;filter:drop-shadow(0 1px 4px rgba(0,0,0,0.8)) drop-shadow(0 0 2px rgba(0,0,0,0.5));';

  const tag = document.createElement('div');
  tag.style.cssText =
    `background:${color};color:#fff;font-size:9px;font-weight:900;` +
    "padding:2px 6px;border:1.5px solid rgba(255,255,255,0.95);white-space:nowrap;font-family:'JetBrains Mono',monospace;letter-spacing:0.05em;" +
    'display:flex;align-items:center;gap:3px;border-radius:1px;';

  if (callNumber) {
    const numSpan = document.createElement('span');
    numSpan.textContent = callNumber;
    tag.appendChild(numSpan);
  }

  const catSpan = document.createElement('span');
  catSpan.style.cssText = 'font-size:7px;opacity:0.85;letter-spacing:0.3px;';
  catSpan.textContent = category;
  tag.appendChild(catSpan);

  const caret = document.createElement('div');
  caret.style.cssText =
    `width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:6px solid ${color};`;

  wrapper.appendChild(tag);
  wrapper.appendChild(caret);
  return wrapper;
}

export function buildPropertyMarkerContent(name: string, address?: string, clientName?: string): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;flex-direction:column;align-items:center;cursor:pointer;position:relative;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.6));';

  // Small dot marker — visible on any map style (dark, satellite, streets, terrain)
  const dot = document.createElement('div');
  dot.style.cssText =
    'width:10px;height:10px;border-radius:50%;' +
    'background:radial-gradient(circle at 35% 35%, #60a5fa, #1e3a5f);' +
    'border:2px solid rgba(255,255,255,0.95);' +
    'box-shadow:0 0 8px rgba(59,130,246,0.7), 0 1px 4px rgba(0,0,0,0.5);' +
    'transition:transform 0.15s ease, box-shadow 0.15s ease;';

  // Hover tooltip — shows name, address, client on mouseover
  const tooltip = document.createElement('div');
  tooltip.style.cssText =
    'position:absolute;bottom:18px;left:50%;transform:translateX(-50%);' +
    "background:#0d1520;color:#e5e7eb;padding:6px 10px;border:1px solid #3b82f650;border-radius:4px;" +
    "font-family:'JetBrains Mono',monospace;white-space:nowrap;pointer-events:none;" +
    'opacity:0;transition:opacity 0.15s ease;z-index:9999;min-width:120px;' +
    'box-shadow:0 4px 12px rgba(0,0,0,0.5);';

  const nameEl = document.createElement('div');
  nameEl.style.cssText = 'font-size:10px;font-weight:900;color:#60a5fa;margin-bottom:2px;';
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

  // Hover events — enlarge dot + show tooltip
  wrapper.addEventListener('mouseenter', () => {
    dot.style.transform = 'scale(1.5)';
    dot.style.boxShadow = '0 0 12px rgba(59,130,246,0.8), 0 1px 3px rgba(0,0,0,0.4)';
    tooltip.style.opacity = '1';
  });
  wrapper.addEventListener('mouseleave', () => {
    dot.style.transform = 'scale(1)';
    dot.style.boxShadow = '0 0 6px rgba(59,130,246,0.6), 0 1px 3px rgba(0,0,0,0.4)';
    tooltip.style.opacity = '0';
  });

  wrapper.appendChild(tooltip);
  wrapper.appendChild(dot);
  return wrapper;
}

// ── Self-Position Marker (pulsing "you are here") ────────────
// NOTE: Uses innerHTML with developer-controlled template strings only (no user input).

export function buildSelfPositionMarker(accuracy: number | null, heading: number | null): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = 'position:relative;display:flex;align-items:center;justify-content:center;cursor:default;';
  const acc = accuracy != null ? Math.min(Math.max(accuracy, 4), 40) : 12;

  // Accuracy ring
  const ring = document.createElement('div');
  ring.style.cssText = `width:${acc}px;height:${acc}px;border-radius:50%;background:rgba(59,130,246,0.15);border:2px solid rgba(59,130,246,0.4);position:absolute;animation:pulse-gps 2s ease-in-out infinite;`;
  el.appendChild(ring);

  // Center dot
  const dot = document.createElement('div');
  dot.style.cssText = 'width:14px;height:14px;border-radius:50%;background:radial-gradient(circle at 40% 35%,#60a5fa,#2563eb);border:2.5px solid #fff;box-shadow:0 0 10px rgba(59,130,246,0.8),0 0 20px rgba(59,130,246,0.3);z-index:1;';
  el.appendChild(dot);

  // Heading arrow
  if (heading != null) {
    const arrow = document.createElement('div');
    arrow.style.cssText = `position:absolute;top:-10px;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:10px solid #3b82f6;transform:rotate(${heading}deg);transform-origin:center 17px;filter:drop-shadow(0 0 3px rgba(59,130,246,0.6));z-index:2;`;
    el.appendChild(arrow);
  }

  return el;
}

// ── Custom Overlay Marker (fallback when AdvancedMarkerElement unavailable) ──

export interface OverlayMarker {
  updatePosition(lat: number, lng: number): void;
  updateContent(newContent: HTMLElement): void;
  remove(): void;
}

let _OverlayMarkerClass: (new (opts: {
  map: google.maps.Map;
  position: google.maps.LatLngLiteral;
  content: HTMLElement;
  zIndex?: number;
  title?: string;
  onClick?: () => void;
}) => OverlayMarker) | null = null;

export function getOverlayMarkerClass() {
  if (_OverlayMarkerClass) return _OverlayMarkerClass;

  _OverlayMarkerClass = class extends google.maps.OverlayView implements OverlayMarker {
    private position: google.maps.LatLng;
    private container: HTMLDivElement | null = null;
    private content: HTMLElement;
    private zIdx: number;
    private clickCallback?: () => void;

    constructor(opts: { map: google.maps.Map; position: google.maps.LatLngLiteral; content: HTMLElement; zIndex?: number; title?: string; onClick?: () => void }) {
      super();
      this.position = new google.maps.LatLng(opts.position.lat, opts.position.lng);
      this.content = opts.content;
      this.zIdx = opts.zIndex ?? 0;
      this.clickCallback = opts.onClick;
      if (opts.title) this.content.title = opts.title;
      this.setMap(opts.map);
    }

    onAdd() {
      this.container = document.createElement('div');
      this.container.style.position = 'absolute';
      this.container.style.zIndex = String(this.zIdx);
      this.container.style.cursor = 'pointer';
      this.container.appendChild(this.content);
      if (this.clickCallback) {
        this.container.addEventListener('click', this.clickCallback);
      }
      const panes = this.getPanes();
      panes?.overlayMouseTarget.appendChild(this.container);
    }

    draw() {
      if (!this.container) return;
      const projection = this.getProjection();
      if (!projection) return;
      const point = projection.fromLatLngToDivPixel(this.position);
      if (point) {
        this.container.style.left = `${point.x}px`;
        this.container.style.top = `${point.y}px`;
        this.container.style.transform = 'translate(-50%, -100%)';
      }
    }

    onRemove() {
      if (this.container) {
        if (this.clickCallback) {
          this.container.removeEventListener('click', this.clickCallback);
        }
        if (this.container.parentElement) {
          this.container.parentElement.removeChild(this.container);
        }
      }
      this.container = null;
    }

    updatePosition(lat: number, lng: number) {
      this.position = new google.maps.LatLng(lat, lng);
      this.draw();
    }

    updateContent(newContent: HTMLElement) {
      if (this.container) {
        while (this.container.firstChild) {
          this.container.removeChild(this.container.firstChild);
        }
        this.container.appendChild(newContent);
      }
      this.content = newContent;
    }

    remove() {
      this.setMap(null);
    }
  };

  return _OverlayMarkerClass;
}

// ── CSS Keyframes (injected once) ────────────────────────────

const STYLE_ID = 'rmpg-map-keyframes';
export function injectKeyframes() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes pulse-led { 0%,100% { opacity:1; } 50% { opacity:0.3; } }
    @keyframes pulse-incident { 0%,100% { box-shadow:0 0 4px rgba(220,38,38,0.3); transform:scale(1); } 50% { box-shadow:0 0 14px rgba(220,38,38,0.7); transform:scale(1.05); } }
    @keyframes pulse-gps { 0%,100% { transform:scale(1); opacity:0.7; } 50% { transform:scale(2.5); opacity:0; } }
    .gm-style-iw { background:#0d1520 !important; border:1px solid #1e3048 !important; border-radius:4px !important; color:#e5e7eb !important; }
    .gm-style-iw-d { overflow:auto !important; }
    .gm-style-iw button[aria-label="Close"] { filter: invert(1) !important; }
    .gm-style .gm-style-iw-tc::after { background:#0d1520 !important; }
  `;
  document.head.appendChild(style);
}
