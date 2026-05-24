// ============================================================
// Map Page — Marker Content Builders
// DOM-based marker builders for Mapbox GL JS markers.
// Each function returns an HTMLElement suitable for use with
// `new mapboxgl.Marker({ element }).setLngLat(lngLat).addTo(map)`.
// ============================================================

import type { UnitStatus } from '../../../types';
import { UNIT_STATUS_COLORS, UNIT_STATUS_LABELS, PRIORITY_COLORS, getIncidentCategory } from './mapConstants';

// ── AdvancedMarkerElement Content Builders ────────────────────

export function buildUnitMarkerContent(callSign: string, status: UnitStatus, _gpsSource?: string, heading?: number | null): HTMLElement {
  const color = UNIT_STATUS_COLORS[status];
  const label = UNIT_STATUS_LABELS[status];

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;flex-direction:column;align-items:center;cursor:pointer;filter:drop-shadow(0 1px 3px rgba(0,0,0,0.7)) drop-shadow(0 0 1px rgba(0,0,0,0.5));transition:all 0.2s ease;will-change:transform;position:relative;';
  wrapper.setAttribute('aria-label', callSign + ' - ' + label);
  wrapper.title = callSign + ' \u2014 ' + label;

  // Hover scale interactions
  wrapper.addEventListener('mouseenter', () => { wrapper.style.transform = 'scale(1.08)'; });
  wrapper.addEventListener('mouseleave', () => { wrapper.style.transform = 'scale(1)'; });

  // Heading direction arrow — shows travel direction above the marker
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

  // Priority-based glow
  const glowShadow = priority === 'P1' ? `0 0 12px ${color}50` : priority === 'P2' ? `0 0 8px ${color}40` : `0 0 6px ${color}30`;

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;flex-direction:column;align-items:center;cursor:pointer;filter:drop-shadow(0 1px 4px rgba(0,0,0,0.8)) drop-shadow(0 0 2px rgba(0,0,0,0.5));transition:transform 0.2s ease;';
  wrapper.setAttribute('aria-label', (callNumber || '') + ' ' + category);

  // Priority pulse animations: P1 = red fast (1s), P2 = orange medium (2s)
  if (priority === 'P1') {
    wrapper.style.animation = 'pulse-p1 1s ease-in-out infinite';
  } else if (priority === 'P2') {
    wrapper.style.animation = 'pulse-p2 2s ease-in-out infinite';
  }

  // Hover scale interactions
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

  // Call age indicator — show elapsed time with color coding
  if (createdAt) {
    const ageMs = Date.now() - new Date(createdAt).getTime();
    const ageMin = Math.floor(ageMs / 60000);
    if (ageMin >= 0) {
      let ageColor: string;
      let ageGlow = '';
      if (ageMin < 5) {
        ageColor = '#ffffff'; // bright white
      } else if (ageMin < 15) {
        ageColor = '#fbbf24'; // yellow
      } else if (ageMin < 30) {
        ageColor = '#f97316'; // orange
      } else {
        ageColor = '#ef4444'; // red with glow
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

  // Small dot marker — visible on any map style (dark, satellite, streets, terrain)
  const dot = document.createElement('div');
  dot.style.cssText =
    'width:12px;height:12px;border-radius:50%;' +
    'background:radial-gradient(circle at 30% 30%, #bfbfbf, #363636);' +
    'border:2px solid rgba(255,255,255,0.95);' +
    'box-shadow:0 0 8px rgba(136, 136, 136,0.7), 0 1px 4px rgba(0,0,0,0.5);' +
    'transition:transform 0.2s ease, box-shadow 0.2s ease;will-change:transform, box-shadow;';

  // Hover tooltip — shows name, address, client on mouseover
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

  // Tooltip caret arrow pointing down
  const tooltipCaret = document.createElement('div');
  tooltipCaret.style.cssText =
    'position:absolute;bottom:-5px;left:50%;transform:translateX(-50%);' +
    'width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:5px solid #0c0c0c;';
  tooltip.appendChild(tooltipCaret);

  // Hover events — enlarge dot + show tooltip
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

  // Hover interactions
  wrapper.addEventListener('mouseenter', () => { wrapper.style.opacity = '0.9'; wrapper.style.transform = 'scale(1.05)'; });
  wrapper.addEventListener('mouseleave', () => { wrapper.style.opacity = '0.55'; wrapper.style.transform = 'scale(1)'; });

  const tag = document.createElement('div');
  tag.style.cssText =
    `background:${color};color:#fff;font-size:7px;font-weight:900;` +
    "padding:1px 4px;border:1px solid rgba(255,255,255,0.7);white-space:nowrap;font-family:'JetBrains Mono',monospace;letter-spacing:0.05em;" +
    'display:flex;align-items:center;gap:2px;border-radius:1px;position:relative;';

  // Clock badge (top-right corner)
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

  // Hover scale interactions
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
// NOTE: Uses createElement DOM API only (no innerHTML). All values are developer-controlled.

export function buildSelfPositionMarker(accuracy: number | null, heading: number | null): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = 'position:relative;display:flex;align-items:center;justify-content:center;cursor:default;';
  const acc = accuracy != null ? Math.min(Math.max(accuracy, 4), 40) : 12;

  // Accuracy ring
  const ring = document.createElement('div');
  ring.style.cssText = `width:${acc}px;height:${acc}px;border-radius:50%;background:radial-gradient(circle, rgba(136, 136, 136,0.2), rgba(136, 136, 136,0.05));border:2px solid rgba(136, 136, 136,0.4);position:absolute;animation:pulse-gps 2s ease-in-out infinite;will-change:transform;`;
  el.appendChild(ring);

  // Center dot
  const dot = document.createElement('div');
  dot.style.cssText = 'width:14px;height:14px;border-radius:50%;background:radial-gradient(circle at 35% 30%, #bfbfbf, #3a3a3a);border:3px solid #fff;box-shadow:0 0 10px rgba(136, 136, 136,0.8),0 0 20px rgba(136, 136, 136,0.3),0 0 30px rgba(136, 136, 136,0.2);z-index:1;';
  el.appendChild(dot);

  // Heading arrow
  if (heading != null) {
    const arrow = document.createElement('div');
    arrow.style.cssText = `position:absolute;top:-10px;width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:12px solid #888888;transform:rotate(${heading}deg);transform-origin:center 17px;filter:drop-shadow(0 0 3px rgba(136, 136, 136,0.6));z-index:2;transition:transform 0.3s ease;will-change:transform;`;
    el.appendChild(arrow);
  }

  return el;
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
    .mapboxgl-popup-content { background:#0a0a0a !important; border:1px solid #222222 !important; border-radius:2px !important; box-shadow:0 4px 20px rgba(0,0,0,0.5) !important; padding:0 !important; }
    .mapboxgl-popup-tip { border-top-color:#222222 !important; }
    .mapboxgl-popup-close-button { color:#666666 !important; font-size:16px !important; padding:4px 8px !important; }
    @media (prefers-reduced-motion: reduce) { .rmpg-marker-enter, .rmpg-marker-selected, [style*=animation] { animation:none !important; } }
  `;
  document.head.appendChild(style);
}
