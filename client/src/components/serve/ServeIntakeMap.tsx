// ============================================================
// RMPG Flex — Serve Intake Map
// Plots all active serve queue items with business/individual
// differentiation and location notation badges. Constraint-
// aware markers show when a notation has shaped the schedule.
// ============================================================

import { useEffect, useRef, useState, useCallback } from 'react';
import { MapPin, Building2, User, AlertTriangle, RefreshCw, Plus } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { mapboxgl, MAPBOX_STYLE_DARK, registerMapInstance, unregisterMapInstance } from '../../utils/mapboxLoader';
import { applyRmpgBasemap } from '../../utils/mapboxBasemap';
import LocationNoteModal from './LocationNoteModal';

interface QueueMapItem {
  id: number;
  status: string;
  priority: string;
  recipient_name: string | null;
  recipient_address: string | null;
  recipient_city: string | null;
  recipient_state: string | null;
  document_type: string | null;
  case_number: string | null;
  deadline: string | null;
  attempt_count: number;
  recipient_type: string | null;
  recipient_lat: number | null;
  recipient_lng: number | null;
  location_note_id: number | null;
  location_note_text: string | null;
  next_attempt_date: string | null;
  next_attempt_window: string | null;
}

interface LocationNote {
  id: number;
  entity_type: string;
  entity_name: string | null;
  address_norm: string | null;
  note_text: string;
  note_type: string;
  days_available: number[] | null;
  hours_start: string | null;
  hours_end: string | null;
  cutoff_time: string | null;
  active: number;
}

const PRIORITY_COLORS: Record<string, string> = {
  urgent: '#ef4444',
  rush:   '#f97316',
  normal: '#3b82f6',
  routine:'#6b7280',
};
const PRIORITY_GLOW: Record<string, string> = {
  urgent: 'rgba(239,68,68,0.5)',
  rush:   'rgba(249,115,22,0.4)',
  normal: 'rgba(59,130,246,0.3)',
  routine:'rgba(107,114,128,0.2)',
};

function buildServeMarker(item: QueueMapItem): HTMLElement {
  const isBusiness = (item.recipient_type || '').toLowerCase() === 'business';
  const color = PRIORITY_COLORS[item.priority] ?? PRIORITY_COLORS.routine;
  const glow  = PRIORITY_GLOW[item.priority]  ?? PRIORITY_GLOW.routine;
  const hasNote = !!item.location_note_id;

  const el = document.createElement('div');
  el.style.cssText = `
    position:relative;
    width:28px;height:28px;
    border-radius:50%;
    background:${color};
    border:2px solid rgba(255,255,255,0.7);
    box-shadow:0 0 8px ${glow};
    display:flex;align-items:center;justify-content:center;
    cursor:pointer;
    transition:transform 0.15s;
  `;
  el.title = item.recipient_name || 'serve target';

  // Icon — building for business, person pin for individual
  const icon = document.createElement('div');
  icon.style.cssText = 'color:#fff;font-size:12px;line-height:1;font-weight:700;';
  icon.textContent = isBusiness ? '🏢' : '👤';
  el.appendChild(icon);

  // Notation badge — yellow dot in corner when a system constraint exists
  if (hasNote) {
    const badge = document.createElement('div');
    badge.style.cssText = `
      position:absolute;top:-3px;right:-3px;
      width:9px;height:9px;
      border-radius:50%;
      background:#d4a017;
      border:1px solid #000;
      box-shadow:0 0 4px rgba(212,160,23,0.8);
    `;
    badge.title = 'Recorded service notation — see popup';
    el.appendChild(badge);
  }

  el.addEventListener('mouseenter', () => { el.style.transform = 'scale(1.2)'; });
  el.addEventListener('mouseleave', () => { el.style.transform = 'scale(1)'; });

  return el;
}

interface Props {
  onSelectQueue?: (queueId: number) => void;
}

export default function ServeIntakeMap({ onSelectQueue }: Props) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const popupRef = useRef<mapboxgl.Popup | null>(null);

  const [items, setItems] = useState<QueueMapItem[]>([]);
  const [notes, setNotes] = useState<LocationNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [geocoding, setGeocoding] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [noteModal, setNoteModal] = useState<{ open: boolean; noteId?: number; queueItem?: QueueMapItem }>({ open: false });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [queueRes, notesRes] = await Promise.all([
        apiFetch<QueueMapItem[]>('/serve-intake/map-items'),
        apiFetch<LocationNote[]>('/serve-intake/location-notes'),
      ]);
      setItems(queueRes);
      setNotes(notesRes);
    } catch {
      // non-fatal — map stays empty
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Init map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: MAPBOX_STYLE_DARK,
      center: [-111.891, 40.76],  // Salt Lake City
      zoom: 10,
      attributionControl: false,
    });
    mapRef.current = map;
    registerMapInstance(map, MAPBOX_STYLE_DARK);
    map.on('load', () => {
      applyRmpgBasemap(map, { variant: 'dark' });
      setMapReady(true);
    });
    return () => {
      unregisterMapInstance(map);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Plot markers when map + items are ready
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    // Clear old markers
    for (const m of markersRef.current) m.remove();
    markersRef.current = [];
    popupRef.current?.remove();

    const mappable = items.filter(
      (it) => it.recipient_lat != null && it.recipient_lng != null,
    );

    for (const item of mappable) {
      const el = buildServeMarker(item);
      const popup = new mapboxgl.Popup({ offset: 18, closeButton: true, maxWidth: '280px' })
        .setHTML(buildPopupHtml(item));

      el.addEventListener('click', () => {
        popupRef.current?.remove();
        popup.addTo(map);
        popupRef.current = popup;
        // Wire "Open record" button inside popup
        setTimeout(() => {
          const btn = document.getElementById(`srv-popup-open-${item.id}`);
          if (btn) btn.addEventListener('click', () => onSelectQueue?.(item.id));
          const noteBtn = document.getElementById(`srv-popup-note-${item.id}`);
          if (noteBtn) noteBtn.addEventListener('click', () =>
            setNoteModal({ open: true, queueItem: item }),
          );
        }, 50);
      });

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([item.recipient_lng!, item.recipient_lat!])
        .addTo(map);
      markersRef.current.push(marker);
    }

    // Auto-fit bounds
    if (mappable.length > 0) {
      const bounds = new mapboxgl.LngLatBounds();
      for (const it of mappable) bounds.extend([it.recipient_lng!, it.recipient_lat!]);
      map.fitBounds(bounds, { padding: 60, maxZoom: 14 });
    }
  }, [mapReady, items, onSelectQueue]);

  const notMapped = items.filter((it) => it.recipient_lat == null || it.recipient_lng == null);

  return (
    <div className="flex flex-col h-full gap-2">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-3 text-[11px] text-brand-400">
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-full bg-red-500" /> Urgent
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-full bg-orange-500" /> Rush
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-full bg-blue-500" /> Normal
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-full bg-gray-500" /> Routine
          </span>
          <span className="flex items-center gap-1 ml-2">
            <span className="inline-block w-3 h-3 rounded-full bg-[#d4a017]" /> Has notation
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setNoteModal({ open: true })}
            className="flex items-center gap-1 px-2 py-1 text-[11px] bg-surface-raised border border-border-subtle rounded text-brand-300 hover:text-brand-100"
          >
            <Plus size={11} /> Add Notation
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1 px-2 py-1 text-[11px] bg-surface-raised border border-border-subtle rounded text-brand-300 hover:text-brand-100 disabled:opacity-50"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {/* Map canvas */}
      <div className="relative flex-1 min-h-0 rounded overflow-hidden border border-border-subtle">
        <div ref={mapContainerRef} className="absolute inset-0" />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface-base/70 z-10">
            <span className="text-[11px] text-brand-400">Loading serve queue…</span>
          </div>
        )}
        {!loading && items.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <span className="text-[11px] text-brand-500">No active serve orders</span>
          </div>
        )}
      </div>

      {/* Unmapped items */}
      {notMapped.length > 0 && (
        <div className="rounded border border-border-subtle bg-surface-raised p-2">
          <div className="flex items-center gap-1 mb-1 text-[10px] text-brand-400 font-semibold uppercase tracking-wide">
            <MapPin size={10} />
            {notMapped.length} address{notMapped.length !== 1 ? 'es' : ''} not geocoded
          </div>
          <div className="flex flex-col gap-[2px] max-h-24 overflow-y-auto">
            {notMapped.map((it) => (
              <div key={it.id} className="flex items-center gap-2 text-[10px] text-brand-400">
                {(it.recipient_type || '').toLowerCase() === 'business'
                  ? <Building2 size={9} className="shrink-0 text-blue-400" />
                  : <User size={9} className="shrink-0 text-brand-400" />
                }
                <span className="truncate">
                  {it.recipient_name || '(no name)'} — {it.recipient_address || '(no address)'}
                </span>
                <span className={`ml-auto text-[9px] font-semibold uppercase px-1 rounded shrink-0 ${
                  it.priority === 'urgent' ? 'bg-red-900 text-red-300' :
                  it.priority === 'rush'   ? 'bg-orange-900 text-orange-300' :
                  it.priority === 'normal' ? 'bg-blue-900 text-blue-300' :
                  'bg-surface-muted text-brand-500'
                }`}>
                  {(it.priority || '').toUpperCase()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Location notes panel */}
      <div className="rounded border border-border-subtle bg-surface-raised p-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-brand-400 font-semibold uppercase tracking-wide">
            System Notations ({notes.filter((n) => n.active).length})
          </span>
        </div>
        {notes.length === 0 ? (
          <p className="text-[10px] text-brand-500">No recorded notations. Add one to constrain scheduling for a specific business, person, or address.</p>
        ) : (
          <div className="flex flex-col gap-[2px] max-h-28 overflow-y-auto">
            {notes.filter((n) => n.active).map((note) => (
              <div key={note.id} className="flex items-start gap-2 text-[10px] text-brand-300 py-[2px] border-b border-border-subtle/40 last:border-0">
                {note.entity_type === 'business'
                  ? <Building2 size={9} className="shrink-0 mt-[1px] text-blue-400" />
                  : note.entity_type === 'person'
                  ? <User size={9} className="shrink-0 mt-[1px] text-brand-400" />
                  : <MapPin size={9} className="shrink-0 mt-[1px] text-brand-500" />
                }
                <div className="flex-1 min-w-0">
                  <span className="font-semibold text-brand-200">{note.entity_name || note.address_norm || '(address)'}</span>
                  <span className="text-brand-500 mx-1">—</span>
                  <span className="text-brand-400">{note.note_text}</span>
                </div>
                <button
                  onClick={() => setNoteModal({ open: true, noteId: note.id })}
                  className="shrink-0 text-[9px] text-brand-500 hover:text-brand-300 px-1 py-0.5 border border-border-subtle rounded"
                >
                  Edit
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create/edit notation modal */}
      {noteModal.open && (
        <LocationNoteModal
          noteId={noteModal.noteId}
          prefill={noteModal.queueItem ? {
            entity_type: (noteModal.queueItem.recipient_type || 'address').toLowerCase() as 'business' | 'person' | 'address',
            entity_name: noteModal.queueItem.recipient_name || undefined,
            address: noteModal.queueItem.recipient_address || undefined,
          } : undefined}
          onClose={() => setNoteModal({ open: false })}
          onSaved={() => { setNoteModal({ open: false }); load(); }}
        />
      )}
    </div>
  );
}

function buildPopupHtml(item: QueueMapItem): string {
  const isBusiness = (item.recipient_type || '').toLowerCase() === 'business';
  const priorityColor = { urgent: '#ef4444', rush: '#f97316', normal: '#3b82f6', routine: '#6b7280' }[item.priority] ?? '#6b7280';
  const priorityLabel = (item.priority || 'routine').toUpperCase();

  const daysLeft = item.deadline
    ? Math.ceil((new Date(item.deadline).getTime() - Date.now()) / 86400000)
    : null;
  const deadlineStr = item.deadline
    ? `${item.deadline}${daysLeft != null ? ` (${daysLeft > 0 ? daysLeft + 'd left' : daysLeft === 0 ? 'DUE TODAY' : 'PAST DUE'})` : ''}`
    : '—';

  const noteBlock = item.location_note_id
    ? `<div style="margin-top:6px;padding:4px 6px;background:rgba(212,160,23,0.12);border:1px solid rgba(212,160,23,0.4);border-radius:2px;font-size:10px;color:#d4a017;">
        ⚠ RECORDED NOTATION: ${item.location_note_text || 'See system record'}
       </div>`
    : '';

  const nextStr = item.next_attempt_date
    ? `${item.next_attempt_date}  ${item.next_attempt_window || ''}`
    : '—';

  return `
    <div style="font-family:monospace;font-size:11px;color:#c9d6e3;min-width:200px;">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
        <span style="font-size:14px;">${isBusiness ? '🏢' : '👤'}</span>
        <div>
          <div style="font-weight:700;color:#e2e8f0;font-size:12px;">${item.recipient_name || '(no name)'}</div>
          <div style="color:#94a3b8;font-size:10px;">${isBusiness ? 'Business Service' : 'Individual Service'}</div>
        </div>
        <span style="margin-left:auto;padding:1px 5px;background:${priorityColor}22;border:1px solid ${priorityColor};border-radius:2px;color:${priorityColor};font-size:9px;font-weight:700;">${priorityLabel}</span>
      </div>
      <div style="color:#94a3b8;font-size:10px;margin-bottom:2px;">${item.recipient_address || ''}${item.recipient_city ? ', ' + item.recipient_city : ''}${item.recipient_state ? ' ' + item.recipient_state : ''}</div>
      <div style="color:#64748b;font-size:10px;">Case: ${item.case_number || '—'} · Doc: ${item.document_type || '—'}</div>
      <div style="color:#64748b;font-size:10px;">Deadline: ${deadlineStr}</div>
      <div style="color:#64748b;font-size:10px;">Attempts: ${item.attempt_count}</div>
      <div style="color:#64748b;font-size:10px;">Next window: ${nextStr}</div>
      ${noteBlock}
      <div style="margin-top:8px;display:flex;gap:6px;">
        <button id="srv-popup-open-${item.id}" style="flex:1;padding:3px 6px;background:rgba(59,130,246,0.2);border:1px solid rgba(59,130,246,0.5);border-radius:2px;color:#93c5fd;font-size:10px;cursor:pointer;font-family:monospace;">
          Open Record
        </button>
        <button id="srv-popup-note-${item.id}" style="flex:1;padding:3px 6px;background:rgba(212,160,23,0.15);border:1px solid rgba(212,160,23,0.4);border-radius:2px;color:#d4a017;font-size:10px;cursor:pointer;font-family:monospace;">
          ${item.location_note_id ? 'View Notation' : 'Add Notation'}
        </button>
      </div>
    </div>
  `;
}
