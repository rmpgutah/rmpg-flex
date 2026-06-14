// ALPR capture gallery — image-first grid of recent plate captures with an
// ALPR-formatted overlay (bounding box when geometry exists, else a plate chip)
// drawn over each still, plus a visual filter bar (source / confidence / hits /
// plate / event type). Captures come from /alpr/captures?gallery=1 (dashcam +
// field-camera + manual), images served auth-gated via authedImageUrl().
import { useEffect, useMemo, useState } from 'react';
import { ScanSearch, RefreshCw, AlertTriangle } from 'lucide-react';
import { apiFetch, authedImageUrl } from '../hooks/useApi';
import {
  captureSource, sourceLabel, confidenceBand, detectionBoxes, filterCaptures, eventTypeOptions,
  type GalleryCapture, type CaptureFilter, type CaptureSource, type ConfidenceBand,
} from '../utils/alprOverlay';

const GOLD = '#d4a017';

function pct(n: number) { return `${(n * 100).toFixed(2)}%`; }

/** One capture tile: image + overlay (box or plate chip) + meta footer. */
function CaptureTile({ cap, onPlate }: { cap: GalleryCapture; onPlate?: (p: string) => void }) {
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const src = cap.image_url || cap.annotated_image_url;
  const boxes = useMemo(() => detectionBoxes(cap.detections, nat?.w, nat?.h), [cap.detections, nat]);
  const band = confidenceBand(cap.confidence, cap.accepted);
  const source = captureSource(cap);
  const conf = cap.confidence != null ? Math.round(cap.confidence * 100) : null;
  const boxColor = cap.alerted ? '#ef4444' : band === 'high' ? GOLD : '#9ca3af';

  return (
    <div className="border border-[#232323] bg-[#0b0b0b] hover:border-[#3a3a3a] transition-colors">
      <button
        type="button"
        onClick={() => cap.plate && onPlate?.(cap.plate)}
        className="relative w-full block aspect-[4/3] bg-black overflow-hidden"
        title={cap.plate || 'capture'}>
        {src ? (
          <img
            src={authedImageUrl(src)} alt={cap.plate || 'ALPR capture'}
            loading="lazy"
            onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[#444]">
            <ScanSearch className="w-8 h-8" />
          </div>
        )}

        {/* Detection boxes (Roboflow geometry) drawn as a fractional SVG overlay. */}
        {boxes.length > 0 && (
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none">
            {boxes.map((b, i) => (
              <rect key={i} x={b.left * 100} y={b.top * 100} width={b.width * 100} height={b.height * 100}
                fill="none" stroke={boxColor} strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
        )}

        {/* Top badges: source + hit. */}
        <div className="absolute top-1 left-1 flex items-center gap-1">
          <span className="text-[8px] font-bold tracking-wider px-1 py-[1px] bg-black/75 text-[#bbb] border border-[#333]">
            {sourceLabel(source)}
          </span>
          {cap.event_type && (
            <span className="text-[8px] px-1 py-[1px] bg-black/75 text-[#888] border border-[#333]">
              {String(cap.event_type).replace(/_/g, ' ')}
            </span>
          )}
        </div>
        {cap.alerted && (
          <span className="absolute top-1 right-1 text-[8px] font-bold tracking-wider px-1 py-[1px] bg-red-950 text-red-300 border border-red-600 flex items-center gap-0.5">
            <AlertTriangle className="w-2.5 h-2.5" /> HIT
          </span>
        )}

        {/* ALPR plate chip overlay — always present (the headline read). */}
        <div className="absolute bottom-0 left-0 right-0 px-1.5 py-1 bg-gradient-to-t from-black/90 to-transparent">
          <div className="flex items-end justify-between gap-1">
            <span
              className="text-base leading-none tracking-[0.18em] font-semibold"
              style={{ color: cap.alerted ? '#fca5a5' : band === 'high' ? '#fff' : '#cbd5e1' }}>
              {cap.plate || '—'}
            </span>
            {conf != null && (
              <span className="text-[9px] font-mono px-1 border"
                style={{ color: boxColor, borderColor: boxColor }}>
                {conf}%
              </span>
            )}
          </div>
        </div>
      </button>
      <div className="px-1.5 py-1 text-[9px] text-[#777] flex items-center justify-between gap-1">
        <span className="truncate">{cap.state ? `${cap.state} · ` : ''}{cap.device_name || cap.location_text || '—'}</span>
        <span className="shrink-0">{cap.created_at ? new Date(cap.created_at.replace(' ', 'T') + 'Z').toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</span>
      </div>
    </div>
  );
}

const SOURCE_TABS: Array<{ key: CaptureSource | 'all'; label: string }> = [
  { key: 'all', label: 'ALL' }, { key: 'dashcam', label: 'DASHCAM' },
  { key: 'field', label: 'FIELD' }, { key: 'manual', label: 'MANUAL' },
];
const BAND_TABS: Array<{ key: ConfidenceBand | 'all'; label: string }> = [
  { key: 'all', label: 'ANY' }, { key: 'high', label: '≥85%' }, { key: 'low', label: 'REVIEW' },
];

export default function AlprCaptureGallery({ onPlate }: { onPlate?: (plate: string) => void }) {
  const [caps, setCaps] = useState<GalleryCapture[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<CaptureFilter>({ source: 'all', band: 'all', hits: 'all' });

  const load = () => {
    setLoading(true); setErr(null);
    apiFetch<GalleryCapture[]>('/alpr/captures?gallery=1&limit=120')
      .then((r) => setCaps(Array.isArray(r) ? r : []))
      .catch((e) => setErr(e?.message || 'Failed to load captures'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const eventTypes = useMemo(() => eventTypeOptions(caps), [caps]);
  const shown = useMemo(() => filterCaptures(caps, filter), [caps, filter]);
  const hitCount = useMemo(() => caps.filter((c) => c.alerted).length, [caps]);

  return (
    <div className="space-y-2">
      {/* Filter bar */}
      <div className="border border-[#232323] bg-[#0b0b0b] p-2 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[9px] font-semibold text-[#d4a017] tracking-wider">CAPTURE GALLERY</span>
          <button onClick={load} className="text-[9px] text-[#888] hover:text-white flex items-center gap-1">
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> {shown.length}/{caps.length}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {SOURCE_TABS.map((t) => (
            <button key={t.key} onClick={() => setFilter((f) => ({ ...f, source: t.key }))}
              className={`text-[9px] px-2 py-1 border ${filter.source === t.key ? 'border-[#d4a017] text-[#d4a017] bg-[#1a1400]' : 'border-[#2a2a2a] text-[#888]'}`}>
              {t.label}
            </button>
          ))}
          <span className="w-px h-4 bg-[#2a2a2a] mx-0.5" />
          {BAND_TABS.map((t) => (
            <button key={t.key} onClick={() => setFilter((f) => ({ ...f, band: t.key }))}
              className={`text-[9px] px-2 py-1 border ${filter.band === t.key ? 'border-[#d4a017] text-[#d4a017] bg-[#1a1400]' : 'border-[#2a2a2a] text-[#888]'}`}>
              {t.label}
            </button>
          ))}
          <span className="w-px h-4 bg-[#2a2a2a] mx-0.5" />
          <button onClick={() => setFilter((f) => ({ ...f, hits: f.hits === 'hits' ? 'all' : 'hits' }))}
            className={`text-[9px] px-2 py-1 border flex items-center gap-1 ${filter.hits === 'hits' ? 'border-red-600 text-red-300 bg-red-950/50' : 'border-[#2a2a2a] text-[#888]'}`}>
            <AlertTriangle className="w-2.5 h-2.5" /> HITS{hitCount ? ` (${hitCount})` : ''}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <input
            value={filter.plate || ''} onChange={(e) => setFilter((f) => ({ ...f, plate: e.target.value }))}
            placeholder="Plate…"
            className="text-[10px] bg-black border border-[#2a2a2a] text-[#ccc] px-2 py-1 w-24 focus:border-[#d4a017] focus:outline-none font-mono uppercase" />
          {eventTypes.length > 0 && (
            <select value={filter.eventType || ''} onChange={(e) => setFilter((f) => ({ ...f, eventType: e.target.value || undefined }))}
              className="text-[10px] bg-black border border-[#2a2a2a] text-[#ccc] px-1 py-1 focus:border-[#d4a017] focus:outline-none">
              <option value="">All events</option>
              {eventTypes.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
            </select>
          )}
          {(filter.plate || filter.eventType || filter.source !== 'all' || filter.band !== 'all' || filter.hits === 'hits') && (
            <button onClick={() => setFilter({ source: 'all', band: 'all', hits: 'all' })}
              className="text-[9px] px-2 py-1 border border-[#2a2a2a] text-[#888] hover:text-white">CLEAR</button>
          )}
        </div>
      </div>

      {err && <div className="border border-red-600 text-red-300 text-[11px] px-3 py-2 bg-red-950/40">{err}</div>}
      {!loading && !err && shown.length === 0 && (
        <div className="border border-[#232323] text-[11px] text-[#888] px-3 py-6 text-center">
          {caps.length === 0
            ? 'No captures yet. Dashcam reads appear here once media sync runs; field/manual scans land here too.'
            : 'No captures match the current filters.'}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
        {shown.map((cap) => <CaptureTile key={cap.id} cap={cap} onPlate={onPlate} />)}
      </div>
    </div>
  );
}
