import mapboxgl from 'mapbox-gl';
import { hasLayer, hasSource, safeRemoveLayer, safeRemoveSource } from './mapboxSafeLayer';
import { escapeHtml } from './sanitize';
import { parseTimestamp } from './dateUtils';

// Priority colors use hex literals for DOM markers (HTMLElement inline styles).
// CSS custom properties resolve via the browser cascade, but test environments
// (jsdom) have no cascade — var() stays as a literal string and breaks assertions.
// These are operational severity indicators that must render correctly in all themes.
export const SERVE_PRIORITY_COLOR: Record<string, string> = {
  urgent: '#ef4444',
  rush: '#f97316',
  normal: '#3b82f6',
  routine: '#6b7280',
};

export interface ServeMapEntry {
  id: number;
  status: string;
  priority: string;
  recipient_name: string | null;
  recipient_address: string | null;
  recipient_lat: number | null;
  recipient_lng: number | null;
  case_number: string | null;
  client_name: string | null;
  document_type: string | null;
  deadline: string | null;
  location_note_id?: number | null;
}

export function buildServeJobMarkerEl(job: ServeMapEntry, opts?: { selected?: boolean }): HTMLElement {
  const color = SERVE_PRIORITY_COLOR[job.priority] ?? SERVE_PRIORITY_COLOR.routine;
  const hoursLeft = job.deadline
    ? (parseTimestamp(job.deadline).getTime() - Date.now()) / 3_600_000
    : null;
  const hasUrgencyRing = hoursLeft !== null && hoursLeft < 72;
  const ringColor = hoursLeft !== null && hoursLeft < 24 ? '#ef4444' : '#f59e0b';
  const isBusiness = job.document_type === 'eviction' || job.document_type === 'order_to_show_cause';

  const el = document.createElement('div');
  el.style.cssText = [
    'position:relative', 'width:28px', 'height:28px', 'border-radius:50%',
    'border:2px solid rgba(255,255,255,0.8)',
    'display:flex', 'align-items:center', 'justify-content:center',
    'font-size:13px', 'box-shadow:0 2px 6px rgba(0 0 0 / 0.4)', 'cursor:pointer',
  ].join(';');
  el.style.background = color;
  el.textContent = isBusiness ? '🏢' : '👤';
  el.title = `${job.recipient_name ?? 'Unknown'} — ${job.priority}`;

  if (opts?.selected) {
    el.style.border = '3px solid #22c55e';
    el.style.boxShadow = '0 0 0 3px rgba(34,197,94,0.4), 0 2px 6px rgba(0 0 0 / 0.4)';
  }

  if (hasUrgencyRing) {
    const ring = document.createElement('div');
    ring.style.cssText = [
      'position:absolute', 'inset:-4px', 'border-radius:50%',
      `border:2px solid ${ringColor}`,
      'animation:ping 1.5s cubic-bezier(0,0,0.2,1) infinite',
      'pointer-events:none',
    ].join(';');
    el.appendChild(ring);
  }

  if (job.location_note_id) {
    const dot = document.createElement('div');
    dot.style.cssText = [
      'position:absolute', 'top:-2px', 'right:-2px',
      'width:8px', 'height:8px', 'border-radius:50%',
      'background:#f59e0b', 'border:1px solid #0d1520',
    ].join(';');
    el.appendChild(dot);
  }

  return el;
}

export function buildServeClusterEl(count: number, dominantPriority: string): HTMLElement {
  const color = SERVE_PRIORITY_COLOR[dominantPriority] ?? SERVE_PRIORITY_COLOR.routine;
  const el = document.createElement('div');
  el.style.cssText = [
    'width:36px', 'height:36px', 'border-radius:50%',
    'border:2px solid rgba(255,255,255,0.6)',
    'display:flex', 'align-items:center', 'justify-content:center',
    'color:#fff', 'font-weight:700', 'font-size:12px', "font-family:'Arial, sans-serif'",
    'box-shadow:0 2px 8px rgba(0 0 0 / 0.5)', 'cursor:pointer',
  ].join(';');
  el.style.background = color;
  el.textContent = count > 99 ? '99+' : String(count);
  return el;
}

export function serveJobPopupHTML(job: ServeMapEntry, opts?: { showAddToRoute?: boolean }): string {
  const esc = (s: string | null | undefined) => escapeHtml(s ?? '');
  const isOverdue = job.deadline ? parseTimestamp(job.deadline) < new Date() : false;
  const deadlineStr = job.deadline
    ? new Date(job.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) // new-date-ok — ISO from server
    : null;

  const rows = [
    job.case_number && `<tr><td style="color:#9ca3af;padding:1px 6px 1px 0;font-size:9px">CASE #</td><td style="font-size:10px">${esc(job.case_number)}</td></tr>`,
    job.client_name && `<tr><td style="color:#9ca3af;padding:1px 6px 1px 0;font-size:9px">CLIENT</td><td style="font-size:10px">${esc(job.client_name)}</td></tr>`,
    job.document_type && `<tr><td style="color:#9ca3af;padding:1px 6px 1px 0;font-size:9px">DOC</td><td style="font-size:10px">${esc(job.document_type.replace(/_/g, ' '))}</td></tr>`,
    job.recipient_address && `<tr><td style="color:#9ca3af;padding:1px 6px 1px 0;font-size:9px">ADDR</td><td style="font-size:10px">${esc(job.recipient_address)}</td></tr>`,
    `<tr><td style="color:#9ca3af;padding:1px 6px 1px 0;font-size:9px">STATUS</td><td style="font-size:10px;text-transform:uppercase;font-weight:600">${esc(job.status)}</td></tr>`,
    deadlineStr && `<tr><td style="color:#9ca3af;padding:1px 6px 1px 0;font-size:9px">DEADLINE</td><td style="font-size:10px;${isOverdue ? 'color:#ef4444;font-weight:700' : ''}">${esc(deadlineStr)}${isOverdue ? ' ⚠' : ''}</td></tr>`,
  ].filter(Boolean).join('');

  const addToRouteBtn = opts?.showAddToRoute
    ? `<button data-action="add-to-route" data-job-id="${job.id}" style="margin-top:6px;margin-left:4px;font:10px monospace;font-weight:700;color:#3b82f6;background:transparent;border:1px solid #3b82f6;padding:3px 8px;border-radius:2px;cursor:pointer;">ADD TO ROUTE</button>`
    : '';

  return `<div style="font-family:'Arial, sans-serif';min-width:180px">
    <div style="font-weight:700;font-size:11px;margin-bottom:6px;border-bottom:1px solid #374151;padding-bottom:4px">${esc(job.recipient_name) || 'Unknown'}</div>
    <table style="border-collapse:collapse;width:100%">${rows}</table>
    <div style="margin-top:2px">
      <a href="/serve?job_id=${job.id}" target="_blank" rel="noopener" style="display:inline-block;font:10px monospace;font-weight:700;color:#f59e0b;background:transparent;border:1px solid #f59e0b;padding:3px 8px;border-radius:2px;text-decoration:none;cursor:pointer;">OPEN JOB</a>${addToRouteBtn}
    </div>
  </div>`;
}

export function removeServeJobLayer(map: mapboxgl.Map, sourceId: string): void {
  const circleId = `${sourceId}-circle`;
  const labelId = `${sourceId}-label`;
  if (hasLayer(map, labelId)) safeRemoveLayer(map, labelId);
  if (hasLayer(map, circleId)) safeRemoveLayer(map, circleId);
  if (hasSource(map, sourceId)) safeRemoveSource(map, sourceId);
}

export function addServeJobLayer(map: mapboxgl.Map, jobs: ServeMapEntry[], sourceId: string): void {
  removeServeJobLayer(map, sourceId);

  const features: GeoJSON.Feature[] = jobs
    .filter(j => j.recipient_lat != null && j.recipient_lng != null)
    .map(j => ({
      type: 'Feature' as const,
      properties: {
        id: j.id,
        color: SERVE_PRIORITY_COLOR[j.priority] ?? SERVE_PRIORITY_COLOR.routine,
        case_number: j.case_number,
      },
      geometry: { type: 'Point' as const, coordinates: [j.recipient_lng!, j.recipient_lat!] },
    }));

  map.addSource(sourceId, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features },
  });

  map.addLayer({
    id: `${sourceId}-circle`,
    type: 'circle',
    source: sourceId,
    paint: {
      'circle-radius': 7,
      'circle-color': ['get', 'color'],
      'circle-opacity': 0.85,
      'circle-stroke-color': '#0d1520',
      'circle-stroke-width': 2,
    },
  });

  map.addLayer({
    id: `${sourceId}-label`,
    type: 'symbol',
    source: sourceId,
    minzoom: 12,
    layout: {
      'text-field': ['coalesce', ['get', 'case_number'], ''],
      'text-size': 9,
      'text-offset': [0, 1.3],
      'text-anchor': 'top',
      'text-font': ['DIN Pro Medium', 'Arial Unicode MS Bold'],
    },
    paint: {
      'text-color': '#f0f4f9',
      'text-halo-color': '#0a0a0a',
      'text-halo-width': 1.5,
    },
  });
}
